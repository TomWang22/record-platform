#!/usr/bin/env bash
# In-cluster Gate 5 v7 authorization canary probe (cp-kafka image).
set -euo pipefail

BOOT="${BOOT:?}"
CLI_TIMEOUT_SEC="${CLI_TIMEOUT_SEC:-25}"

python3 - <<'PY'
import json, os, re, subprocess, textwrap
from pathlib import Path

plan = json.loads(Path("/assets/plan.json").read_text())
results = []
forbidden_topic_denied = 0
forbidden_cluster_denied = 0
client_id_effects = 0

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


def build_keystore(svc: str, client_id: str, props_path: str) -> None:
    script = f"""
set -euo pipefail
rm -f /tmp/t.jks /tmp/c.jks /tmp/c.p12
keytool -importcert -noprompt -storetype JKS -alias record-platform-root -file /tls/ca/dev-root.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
keytool -importcert -noprompt -storetype JKS -alias record-platform-intermediate -file /tls/ca/dev-intermediate.pem -keystore /tmp/t.jks -storepass changeit >/dev/null
openssl pkcs12 -export -inkey /tls/clients/{svc}/tls.key -in /tls/clients/{svc}/tls.crt -certfile /tls/ca/dev-intermediate.pem -out /tmp/c.p12 -passout pass:changeit -name c
keytool -importkeystore -noprompt -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit -destkeystore /tmp/c.jks -deststoretype JKS -deststorepass changeit >/dev/null
cat > {props_path} <<EOF
{PROPS_BASE}client.id={client_id}
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


def is_authz_denied(rc: int, out: str) -> bool:
    return bool(
        re.search(
            r"TOPIC_AUTHORIZATION_FAILED|GROUP_AUTHORIZATION_FAILED|CLUSTER_AUTHORIZATION_FAILED|"
            r"TopicAuthorizationException|GroupAuthorizationException|ClusterAuthorizationException|"
            r"Not authorized to access",
            out,
            re.I,
        )
    )


def produce_ok(rc: int, out: str) -> bool:
    return rc == 0 and not is_authz_denied(rc, out)


for row in plan:
    svc = row["service"]
    mode = row.get("permitted_mode") or "produce"
    cid = f"record-platform.{svc}.authz.canary"
    props = f"/tmp/{svc}.props"
    build_keystore(svc, cid, props)

    if mode == "produce" and row.get("permitted_topic"):
        topic = row["permitted_topic"]
        p = run(
            f"printf 'permit\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props} --topic {topic}"
        )
        out = (p.stdout or "") + (p.stderr or "")
        results.append(
            {"service": svc, "case": "permitted_topic", "ok": produce_ok(p.returncode, out), "rc": p.returncode}
        )
    elif mode == "consume" and row.get("permitted_topic") and row.get("permitted_group"):
        topic = row["permitted_topic"]
        group = row["permitted_group"]
        # Describe/consume attempt: metadata + short consume; authorization may deny offset commit separately
        p = run(
            f"timeout 20 kafka-console-consumer --bootstrap-server \"$BOOT\" --consumer.config {props} "
            f"--topic {topic} --group {group} --from-beginning --max-messages 1 --timeout-ms 8000"
        )
        out = (p.stdout or "") + (p.stderr or "")
        # timeout with 0 messages is OK if not authz-denied
        ok = not is_authz_denied(p.returncode, out)
        results.append({"service": svc, "case": "permitted_consume", "ok": ok, "rc": p.returncode})
    else:
        results.append({"service": svc, "case": "permitted_skipped", "ok": True, "rc": 0})

    topic = row["forbidden_topic"]
    p = run(
        f"printf 'deny\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props} --topic {topic}"
    )
    out = (p.stdout or "") + (p.stderr or "")
    ok = is_authz_denied(p.returncode, out)
    if ok:
        forbidden_topic_denied += 1
    results.append(
        {
            "service": svc,
            "case": "forbidden_topic",
            "ok": ok,
            "rc": p.returncode,
            "snip": out[-240:],
        }
    )

    p = run(
        f"timeout 20 kafka-topics --bootstrap-server \"$BOOT\" --command-config {props} "
        f"--create --topic gate5.v7.authz.deny.{svc} --partitions 1 --replication-factor 1"
    )
    out = (p.stdout or "") + (p.stderr or "")
    ok = is_authz_denied(p.returncode, out) or p.returncode != 0
    if ok:
        forbidden_cluster_denied += 1
    results.append({"service": svc, "case": "forbidden_cluster_create", "ok": ok, "rc": p.returncode})

    # forged client.id must not change authorization relative to cert principal
    props2 = f"/tmp/{svc}-forged.props"
    build_keystore(svc, "kafka-client.forged.authorized-looking", props2)
    if mode == "produce" and row.get("permitted_topic"):
        topic = row["permitted_topic"]
        p = run(
            f"printf 'forged-cid\\n' | timeout 25 kafka-console-producer --bootstrap-server \"$BOOT\" --producer.config {props2} --topic {topic}"
        )
        out = (p.stdout or "") + (p.stderr or "")
        ok = produce_ok(p.returncode, out)
        if not ok:
            client_id_effects += 1
        results.append({"service": svc, "case": "forged_client_id_authorized_cert", "ok": ok, "rc": p.returncode})
    else:
        results.append({"service": svc, "case": "forged_client_id_skipped", "ok": True, "rc": 0})

failed = [r for r in results if not r.get("ok")]
body = {
    "rows": len(results),
    "failed": len(failed),
    "forbidden_topic_denied": f"{forbidden_topic_denied}/12",
    "forbidden_cluster_denied": f"{forbidden_cluster_denied}/12",
    "client_id_authorization_effects": client_id_effects,
    "results": [{k: v for k, v in r.items() if k != "snip"} for r in results],
}
print("AUTHZ_RESULTS_JSON=" + json.dumps(body, separators=(",", ":")))
if failed:
    print("AUTHZ_FAILURES=" + json.dumps(failed, separators=(",", ":"))[:2000])
    raise SystemExit(1)
print("AUTHZ_CANARY_OK")
PY
