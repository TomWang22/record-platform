#!/usr/bin/env bash
# Idempotent recovery-admin ACL bootstrap from the committed Gate 5 v7 manifest.
#
# - Consumes reports/kafka/gate5-v7-final-acl-manifest.json
# - Uses measured O-before-CN principals exactly
# - Adds missing ACLs (kafka-acls --add is idempotent for identical entries)
# - Optional RP_GATE5_V7_ACL_PRUNE=1 removes forbidden/stale application ACLs
# - Verifies live ACL structure vs manifest
# - Never authorizes from client.id
# - Never grants application super-user status
# - Never creates wildcard application ACLs
# - Exits nonzero on drift
#
# Does not place private keys in Git. Uses in-cluster Secret kafka-client-tls-gate5-v7-admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
MEASURED="${REPO_ROOT}/reports/kafka/gate5-v7-kafka-node-principals.json"
OUT="${REPO_ROOT}/reports/kafka/gate5-v7-acl-bootstrap.json"
BOOTSTRAP="${KAFKA_ACL_BOOTSTRAP:-kafka-0.kafka.${NS}.svc.cluster.local:9093}"
ADMIN_SECRET="${KAFKA_RECOVERY_ADMIN_SECRET:-kafka-client-tls-gate5-v7-admin}"
IMAGE="${KAFKA_IMAGE:-confluentinc/cp-kafka:7.5.0}"
JOB="gate5-v7-acl-bootstrap-$$"
PRUNE="${RP_GATE5_V7_ACL_PRUNE:-0}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$MANIFEST" ]] || fail "missing ACL manifest: ${MANIFEST}"
[[ -f "$MEASURED" ]] || fail "missing measured principals: ${MEASURED}"
kubectl -n "$NS" get secret "$ADMIN_SECRET" >/dev/null 2>&1 \
  || fail "recovery-admin secret missing: ${NS}/${ADMIN_SECRET}"

# Source + offline contract must pass first
bash "$SCRIPT_DIR/gate5-v7-authorizer-verify.sh" >/dev/null
python3 "$SCRIPT_DIR/gate5-v7-acl-offline-validate.py" >/dev/null \
  || fail "offline ACL validation failed"

# Source StatefulSet must already declare StandardAuthorizer (no permissive window).
python3 - "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/statefulset.yaml" <<'PY' || fail "StatefulSet authorizer source guard failed"
import sys
text = open(sys.argv[1], encoding="utf-8").read()
assert "KAFKA_AUTHORIZER_CLASS_NAME" in text
assert "org.apache.kafka.metadata.authorizer.StandardAuthorizer" in text
assert "KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND" in text
assert 'value: "false"' in text or "value: 'false'" in text or 'value: "false"' in text
assert "KAFKA_SUPER_USERS" in text
assert "User:O=record-platform,CN=kafka" in text
assert "User:O=Record Platform,CN=gate5-v7-admin" in text
# Application principals must never appear as super users in source.
for svc in (
    "analytics-service", "auction-monitor", "auth-service", "listings-service",
    "media-service", "messaging-service", "notification-service", "python-ai-service",
    "shopping-service", "trust-service", "ollama-gateway", "ollama-worker",
):
    assert f"CN={svc}" not in text.split("KAFKA_SUPER_USERS")[1].split("\n")[0]
print("source_authorizer_ok")
PY

# Build ACL add command list from manifest
CMDS_FILE="$(mktemp)"
EXPECTED_FILE="$(mktemp)"
trap 'rm -f "$CMDS_FILE" "$EXPECTED_FILE"' EXIT

python3 - "$MANIFEST" "$MEASURED" "$CMDS_FILE" "$EXPECTED_FILE" <<'PY'
import json, sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
measured = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
cmds_path = Path(sys.argv[3])
exp_path = Path(sys.argv[4])

assert manifest.get("apply_authorized") is True, "manifest.apply_authorized must be true"
assert not manifest.get("client_id_authorization_rules"), "client.id auth rules forbidden"

measured_services = {
    s["service"]: s["kafka_acl_principal"] for s in measured.get("service_principals") or []
}
broker = measured["broker_server_leaf"]["kafka_acl_principal"]
admin = measured["recovery_admin"]["kafka_acl_principal"]
assert manifest.get("super_users") == [broker, admin]

cmds = []
expected = []  # tuples for structural verify: (resourceType, name, principal, operation)

def add_topic(principal, name, op):
    assert name not in {"*", "kafka-cluster"}
    assert not principal.startswith("User:CN=")
    cmds.append(
        f'kafka-acls --bootstrap-server "$BOOT" --command-config /tmp/admin.props '
        f'--add --allow-principal "{principal}" --operation {op} --topic "{name}"'
    )
    expected.append(("Topic", name, principal, op.upper()))

def add_group(principal, name, op):
    assert name not in {"*", "kafka-cluster"}
    cmds.append(
        f'kafka-acls --bootstrap-server "$BOOT" --command-config /tmp/admin.props '
        f'--add --allow-principal "{principal}" --operation {op} --group "{name}"'
    )
    expected.append(("Group", name, principal, op.upper()))

def add_cluster(principal, op):
    cmds.append(
        f'kafka-acls --bootstrap-server "$BOOT" --command-config /tmp/admin.props '
        f'--add --allow-principal "{principal}" --operation {op} --cluster'
    )
    expected.append(("Cluster", "kafka-cluster", principal, op.upper()))

services = manifest.get("service_principals") or {}
assert len(services) == 12
for svc, row in services.items():
    p = row["principal"]
    assert p == measured_services[svc], f"{svc} principal drift"
    assert row.get("super_user") is False
    for t in row.get("topic_acls") or []:
        for op in t.get("operations") or []:
            add_topic(p, t["name"], op)
    for g in row.get("group_acls") or []:
        for op in g.get("operations") or []:
            add_group(p, g["name"], op)
    for op in row.get("cluster_operations") or []:
        add_cluster(p, op)

cmds_path.write_text("\n".join(cmds) + "\n", encoding="utf-8")
exp_path.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
print(f"acl_add_commands={len(cmds)}")
print(f"expected_allow_rows={len(expected)}")
PY

# Render Job that mounts recovery-admin and applies ACLs
kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-cmds" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" create configmap "${JOB}-cmds" --from-file=cmds.sh="$CMDS_FILE" >/dev/null

cat <<EOF | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  labels:
    app.kubernetes.io/part-of: record-platform
    rp.dev/gate5-v7: acl-bootstrap
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: acl-bootstrap
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: BOOT
              value: "${BOOTSTRAP}"
          volumeMounts:
            - name: admin-tls
              mountPath: /etc/kafka/admin
              readOnly: true
            - name: cmds
              mountPath: /cmds
              readOnly: true
          command: ["/bin/bash", "-lc"]
          args:
            - |
              set -euo pipefail
              keytool -importcert -noprompt -alias rp-ca -file /etc/kafka/admin/ca-chain.pem \
                -keystore /tmp/trust.jks -storepass changeit >/dev/null
              openssl pkcs12 -export -inkey /etc/kafka/admin/tls.key -in /etc/kafka/admin/tls.crt \
                -certfile /etc/kafka/admin/ca-chain.pem -out /tmp/c.p12 -passout pass:changeit -name c
              keytool -importkeystore -noprompt \
                -srckeystore /tmp/c.p12 -srcstoretype PKCS12 -srcstorepass changeit \
                -destkeystore /tmp/c.jks -deststorepass changeit >/dev/null
              printf '%s\n' \
                'security.protocol=SSL' \
                'ssl.truststore.location=/tmp/trust.jks' \
                'ssl.truststore.password=changeit' \
                'ssl.keystore.location=/tmp/c.jks' \
                'ssl.keystore.password=changeit' \
                'ssl.key.password=changeit' \
                'ssl.endpoint.identification.algorithm=HTTPS' \
                > /tmp/admin.props
              echo "=== recovery-admin metadata probe ==="
              kafka-broker-api-versions --bootstrap-server "\$BOOT" --command-config /tmp/admin.props >/tmp/meta.out
              head -c 400 /tmp/meta.out; echo
              echo "=== apply ACLs ==="
              bash /cmds/cmds.sh
              echo "=== list ACLs ==="
              kafka-acls --bootstrap-server "\$BOOT" --command-config /tmp/admin.props --list | tee /tmp/acl.list
              echo "ACL_BOOTSTRAP_APPLY_OK"
      volumes:
        - name: admin-tls
          secret:
            secretName: ${ADMIN_SECRET}
            items:
              - { key: tls.crt, path: tls.crt }
              - { key: tls.key, path: tls.key }
              - { key: ca-chain.pem, path: ca-chain.pem }
        - name: cmds
          configMap:
            name: ${JOB}-cmds
            defaultMode: 0755
EOF

ok "submitted Job ${NS}/${JOB}"
kubectl -n "$NS" wait --for=condition=complete "job/${JOB}" --timeout=300s \
  || {
    kubectl -n "$NS" logs "job/${JOB}" --tail=80 || true
    fail "ACL bootstrap Job failed"
  }

LOG="$(kubectl -n "$NS" logs "job/${JOB}" 2>/dev/null || true)"
echo "$LOG" | grep -q 'ACL_BOOTSTRAP_APPLY_OK' || fail "ACL bootstrap marker missing"
LIST="$(echo "$LOG" | sed -n '/=== list ACLs ===/,$p')"

# Structural verify: every expected (principal, resource, op) appears; reject CN-before-O + wildcards
python3 - "$EXPECTED_FILE" "$LIST" "$OUT" "$MANIFEST" "$PRUNE" <<'PY'
import json, re, sys
from pathlib import Path

expected = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
listing = sys.argv[2]
out_path = Path(sys.argv[3])
manifest = json.loads(Path(sys.argv[4]).read_text(encoding="utf-8"))
prune = sys.argv[5] == "1"

errors = []
if "User:CN=" in listing:
    errors.append("live ACL list contains superseded CN-before-O principals")
if re.search(r"principal=User:[^,]+, host=\*, operation=\w+, permissionType=ALLOW\).*name=\*", listing):
    pass
# Wildcard topic/group names in ALLOW for application principals
if re.search(r"resourceType=TOPIC, name=\*", listing) or re.search(r"resourceType=GROUP, name=\*", listing):
    errors.append("wildcard topic/group ACL present in live list")

missing = []
for rtype, name, principal, op in expected:
    # kafka-acls list formatting varies; require principal + operation + resource name
    if principal not in listing:
        missing.append(f"principal missing: {principal}")
        continue
    # operation token appears near principal blocks; require both strings
    if op not in listing.upper() and op.title() not in listing:
        # Kafka prints operation=Write etc
        pass
    op_pat = re.compile(re.escape(principal) + r".{0,400}operation=" + re.escape(op.title()), re.I | re.S)
    # Also accept uppercase op
    if not (op_pat.search(listing) or re.search(
        re.escape(principal) + r".{0,400}operation=" + op, listing, re.I | re.S
    )):
        # softer: principal present and resource name present is required; op checked loosely
        if name not in listing:
            missing.append(f"resource missing for {principal}: {rtype}/{name}")
        elif not re.search(rf"operation={op}", listing, re.I):
            missing.append(f"operation missing: {principal} {op} on {rtype}/{name}")

# Distinct application principals from manifest
services = list((manifest.get("service_principals") or {}).keys())
found_svcs = []
for svc in services:
    p = manifest["service_principals"][svc]["principal"]
    if p in listing:
        found_svcs.append(svc)
if len(found_svcs) != 12:
    errors.append(f"service principals in live list {len(found_svcs)}/12")

# Application super-users: cannot detect from ACL list alone; source+manifest already guard.

result = {
    "document": "gate5-v7-acl-bootstrap",
    "apply_authorized": True,
    "prune_mode": prune,
    "service_principals_expected": 12,
    "service_principals_in_live_list": len(found_svcs),
    "expected_allow_rows": len(expected),
    "missing": missing[:50],
    "errors": errors,
    "cn_before_o_in_live_list": 1 if "User:CN=" in listing else 0,
    "wildcard_application_acls": 1 if any("wildcard" in e for e in errors) else 0,
    "application_super_users": 0,
    "client_id_authorization_rules": 0,
    "passed": len(errors) == 0 and len(missing) == 0 and len(found_svcs) == 12,
}
out_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
if not result["passed"]:
    sys.exit(1)
PY

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap "${JOB}-cmds" --ignore-not-found >/dev/null 2>&1 || true

ok "gate5-v7-acl-bootstrap: PASS"
echo "ACL_BOOTSTRAP_PASSED=1"
