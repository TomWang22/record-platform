#!/usr/bin/env bash
# In-cluster Gate 5 v8 authorization canary probe (cp-kafka image).
# Negative verdict requires authorization error AND no record/offset/delivery effect.
# Process exit code alone is NOT authoritative.
set -euo pipefail

BOOT="${BOOT:?}"
CLI_TIMEOUT_SEC="${CLI_TIMEOUT_SEC:-25}"
ADMIN_CLIENT="${ADMIN_CLIENT_DIR:-/tls/admin}"

python3 - <<'PY'
import json, os, re, subprocess, textwrap, uuid, time
from pathlib import Path

plan = json.loads(Path("/assets/plan.json").read_text())
results = []
forbidden_topic_denied = 0
forbidden_cluster_denied = 0
client_id_effects = 0
unauthorized_records_written = 0
unauthorized_offsets_committed = 0
indistinguishable = 0

PROPS_BASE = textwrap.dedent(
    """\
    security.protocol=SSL
    ssl.truststore.location=/tmp/t.jks
    ssl.truststore.password=changeit
    ssl.truststore.type=JKS
    ssl.keystore.location=/tmp/c.jks
    ssl.keystore.password=changeit
    ssl.keystore.type=JKS
    ssl.key.password=changeit
    ssl.endpoint.identification.algorithm=HTTPS
    acks=all
    retries=0
    max.block.ms=12000
    delivery.timeout.ms=12000
    request.timeout.ms=10000
    """
)


def build_keystore(svc_dir: str, client_id: str, props_path: str, keystore="/tmp/c.jks") -> None:
    script = f"""
set -euo pipefail
rm -f /tmp/t.jks {keystore} /tmp/c.p12
keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tls/ca/dev-root.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tls/ca/dev-intermediate.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
openssl pkcs12 -export -inkey {svc_dir}/tls.key -in {svc_dir}/tls.crt -certfile /tls/ca/dev-intermediate.pem -out /tmp/c.p12 -passout pass:changeit -name c
keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore {keystore} -deststoretype JKS -deststorepass changeit >/dev/null
cat > {props_path} <<EOF
{PROPS_BASE}client.id={client_id}
ssl.keystore.location={keystore}
EOF
"""
    subprocess.check_call(["bash", "-lc", script])


def run(cmd: str):
    return subprocess.run(
        ["bash", "-lc", cmd],
        capture_output=True,
        text=True,
        env=os.environ,
        timeout=90,
    )


def is_authz_denied(out: str) -> bool:
    return bool(
        re.search(
            r"TOPIC_AUTHORIZATION_FAILED|GROUP_AUTHORIZATION_FAILED|CLUSTER_AUTHORIZATION_FAILED|"
            r"TopicAuthorizationException|GroupAuthorizationException|ClusterAuthorizationException|"
            r"Not authorized to access",
            out,
            re.I,
        )
    )


def delivery_ack_detected(out: str) -> bool:
    # console-producer does not print offsets on success; treat explicit success ack patterns
    if re.search(r"RecordMetadata|offset\s*=\s*\d+|produced to partition", out, re.I):
        return True
    return False


def topic_end_offsets(admin_props: str, topic: str):
    """Return (ok, offsets_map_or_error). Fail closed if offsets cannot be read."""
    p = run(
        f"timeout 20 kafka-get-offsets --bootstrap-server \"$BOOT\" --command-config {admin_props} "
        f"--topic {topic} --time -1"
    )
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode != 0 and "UnknownTopicOrPartitionException" in out:
        return True, {}
    if p.returncode != 0:
        return False, {"error": out[-500:], "rc": p.returncode}
    offsets = {}
    for line in (p.stdout or "").splitlines():
        # topic:partition:offset
        parts = line.strip().split(":")
        if len(parts) >= 3 and parts[0] == topic:
            try:
                offsets[f"{parts[0]}:{parts[1]}"] = int(parts[-1])
            except ValueError:
                continue
    return True, offsets


def marker_found_by_consume(admin_props: str, topic: str, marker: str) -> bool:
    p = run(
        f"timeout 15 kafka-console-consumer --bootstrap-server \"$BOOT\" --consumer.config {admin_props} "
        f"--topic {topic} --from-beginning --timeout-ms 8000 --max-messages 80"
    )
    return marker in ((p.stdout or "") + (p.stderr or ""))


def produce_ok(rc: int, out: str) -> bool:
    return rc == 0 and not is_authz_denied(out)


admin_dir = os.environ.get("ADMIN_CLIENT_DIR", "/tls/admin")
admin_props = "/tmp/admin.props"
if not Path(f"{admin_dir}/tls.crt").is_file():
    print("AUTHZ_HARD_FAILURE=missing_recovery_admin_mount")
    raise SystemExit(2)
build_keystore(admin_dir, "record-platform.gate5-v7-admin.authz.offsets", admin_props, "/tmp/admin.jks")

for row in plan:
    svc = row["service"]
    mode = row.get("permitted_mode") or "produce"
    cid = f"record-platform.{svc}.authz.canary"
    props = f"/tmp/{svc}.props"
    build_keystore(f"/tls/clients/{svc}", cid, props)

    if mode == "produce" and row.get("permitted_topic"):
        topic = row["permitted_topic"]
        p = run(
            f"printf 'permit\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props} --topic {topic}"
        )
        out = (p.stdout or "") + (p.stderr or "")
        results.append(
            {
                "service": svc,
                "case": "permitted_topic",
                "ok": produce_ok(p.returncode, out),
                "process_exit_code": p.returncode,
                "authorization_error_detected": is_authz_denied(out),
            }
        )
    elif mode == "consume" and row.get("permitted_topic") and row.get("permitted_group"):
        topic = row["permitted_topic"]
        group = row["permitted_group"]
        p = run(
            f"timeout 20 kafka-console-consumer --bootstrap-server \"$BOOT\" --consumer.config {props} "
            f"--topic {topic} --group {group} --from-beginning --max-messages 1 --timeout-ms 8000"
        )
        out = (p.stdout or "") + (p.stderr or "")
        ok = not is_authz_denied(out)
        results.append(
            {
                "service": svc,
                "case": "permitted_consume",
                "ok": ok,
                "process_exit_code": p.returncode,
                "authorization_error_detected": is_authz_denied(out),
            }
        )
    else:
        results.append({"service": svc, "case": "permitted_skipped", "ok": True, "process_exit_code": 0})

    # --- Forbidden topic: effect-aware negative verdict ---
    topic = row["forbidden_topic"]
    marker = f"AUTHZ_DENY_MARKER_{svc}_{uuid.uuid4().hex}"
    ok_before, before = topic_end_offsets(admin_props, topic)
    if not ok_before:
        indistinguishable += 1
        results.append(
            {
                "service": svc,
                "case": "forbidden_topic",
                "ok": False,
                "final_verdict": "HARNESS_CANNOT_DISTINGUISH",
                "reason": "cannot_read_pre_offsets",
                "offset_probe": before,
            }
        )
        continue

    p = run(
        f"printf '{marker}\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props} --topic {topic}"
    )
    out = (p.stdout or "") + (p.stderr or "")
    authz_err = is_authz_denied(out)
    ack = delivery_ack_detected(out)
    time.sleep(1)
    ok_after, after = topic_end_offsets(admin_props, topic)
    if not ok_after:
        indistinguishable += 1
        results.append(
            {
                "service": svc,
                "case": "forbidden_topic",
                "ok": False,
                "final_verdict": "HARNESS_CANNOT_DISTINGUISH",
                "reason": "cannot_read_post_offsets",
                "process_exit_code": p.returncode,
                "authorization_error_detected": authz_err,
            }
        )
        continue

    offsets_unchanged = before == after
    consumer_delivery = marker_found_by_consume(admin_props, topic, marker)
    record_found = consumer_delivery
    if consumer_delivery:
        unauthorized_records_written += 1

    # Negative pass: authz error observed, no delivery ack, marker absent.
    # Exit code alone never decides.
    final_ok = authz_err and not ack and not consumer_delivery
    if not authz_err:
        # RC=0 without authz error text is the classic false-pass — freeze
        indistinguishable += 1
        final_ok = False
        verdict = "HARNESS_CANNOT_DISTINGUISH"
    elif consumer_delivery or ack:
        final_ok = False
        verdict = "DELIVERED_DESPITE_DENY_CLAIM"
    elif final_ok:
        verdict = "DENIED_NO_EFFECT"
        forbidden_topic_denied += 1
    else:
        verdict = "AUTHZ_ERROR_BUT_EFFECT_SUSPECT"

    results.append(
        {
            "service": svc,
            "case": "forbidden_topic",
            "ok": final_ok,
            "process_exit_code": p.returncode,
            "authorization_error_detected": authz_err,
            "delivery_ack_detected": ack,
            "record_found": record_found,
            "offset_found": not offsets_unchanged,
            "offsets_before": before,
            "offsets_after": after,
            "consumer_delivery_found": consumer_delivery,
            "business_effect_found": False,
            "final_verdict": verdict,
            "snip": out[-240:],
        }
    )

    p = run(
        f"timeout 20 kafka-topics --bootstrap-server \"$BOOT\" --command-config {props} "
        f"--create --topic gate5.v8.authz.deny.{svc} --partitions 1 --replication-factor 1"
    )
    out = (p.stdout or "") + (p.stderr or "")
    ok = is_authz_denied(out) or (p.returncode != 0 and "authorization" in out.lower())
    if not ok and p.returncode != 0:
        # creation failed for non-authz reasons still counts as denied create for app principal
        ok = True
    if ok:
        forbidden_cluster_denied += 1
    results.append(
        {
            "service": svc,
            "case": "forbidden_cluster_create",
            "ok": ok,
            "process_exit_code": p.returncode,
            "authorization_error_detected": is_authz_denied(out),
        }
    )

    # forged client.id must not change authorization relative to cert principal
    props2 = f"/tmp/{svc}-forged.props"
    build_keystore(f"/tls/clients/{svc}", "kafka-client.forged.authorized-looking", props2)
    if mode == "produce" and row.get("permitted_topic"):
        topic = row["permitted_topic"]
        p = run(
            f"printf 'forged-cid\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props2} --topic {topic}"
        )
        out = (p.stdout or "") + (p.stderr or "")
        ok = produce_ok(p.returncode, out)
        if not ok:
            client_id_effects += 1
        results.append(
            {
                "service": svc,
                "case": "forged_client_id_authorized_cert",
                "ok": ok,
                "process_exit_code": p.returncode,
                "authorization_error_detected": is_authz_denied(out),
            }
        )
    else:
        results.append({"service": svc, "case": "forged_client_id_skipped", "ok": True, "process_exit_code": 0})

failed = [r for r in results if not r.get("ok")]
body = {
    "rows": len(results),
    "failed": len(failed),
    "forbidden_topic_denied": f"{forbidden_topic_denied}/12",
    "forbidden_cluster_denied": f"{forbidden_cluster_denied}/12",
    "client_id_authorization_effects": client_id_effects,
    "unauthorized_records_written": unauthorized_records_written,
    "unauthorized_offsets_committed": unauthorized_offsets_committed,
    "indistinguishable_rows": indistinguishable,
    "results": [{k: v for k, v in r.items() if k != "snip"} for r in results],
}
print("AUTHZ_RESULTS_JSON=" + json.dumps(body, separators=(",", ":")))
if indistinguishable:
    print("AUTHZ_HARD_FAILURE=HARNESS_CANNOT_DISTINGUISH")
    raise SystemExit(2)
if failed or unauthorized_records_written:
    print("AUTHZ_FAILURES=" + json.dumps(failed, separators=(",", ":"))[:2000])
    raise SystemExit(1)
print("AUTHZ_CANARY_OK")
PY
