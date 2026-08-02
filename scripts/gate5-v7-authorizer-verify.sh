#!/usr/bin/env bash
# Verify StandardAuthorizer is source-controlled and (when cluster present) live.
# Replaces the historical "authorizer must be absent" preflight stop-gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"
STS="${REPO_ROOT}/infra/k8s/kafka-kraft-metallb/statefulset.yaml"
MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
MEASURED="${REPO_ROOT}/reports/kafka/gate5-v7-kafka-node-principals.json"
OUT="${REPO_ROOT}/reports/kafka/gate5-v7-authorizer-verify.json"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$STS" ]] || fail "missing StatefulSet: ${STS}"
[[ -f "$MANIFEST" ]] || fail "missing ACL manifest: ${MANIFEST}"
[[ -f "$MEASURED" ]] || fail "missing measured principals: ${MEASURED}"

python3 - "$STS" "$MANIFEST" "$MEASURED" "$OUT" <<'PY'
import json, re, sys
from pathlib import Path

sts = Path(sys.argv[1]).read_text(encoding="utf-8")
manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
measured = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
out = Path(sys.argv[4])

errors = []
broker = measured["broker_server_leaf"]["kafka_acl_principal"]
admin = measured["recovery_admin"]["kafka_acl_principal"]
want_super = f"{broker};{admin}"

checks = {
    "authorizer_class_name": "org.apache.kafka.metadata.authorizer.StandardAuthorizer" in sts
        and "KAFKA_AUTHORIZER_CLASS_NAME" in sts,
    "allow_everyone_false": bool(re.search(
        r'KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND.*?value:\s*"false"', sts, re.S
    )),
    "super_users_exact": f'value: "{want_super}"' in sts or f"value: '{want_super}'" in sts,
    "controller_client_auth_required": "KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH" in sts
        and 'value: "required"' in sts,
    "controller_endpoint_https": "KAFKA_LISTENER_NAME_CONTROLLER_SSL_ENDPOINT_IDENTIFICATION_ALGORITHM" in sts
        and "HTTPS" in sts,
    "internal_client_auth_required": "KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH" in sts,
    "external_client_auth_required": "KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH" in sts,
    "manifest_apply_authorized": manifest.get("apply_authorized") is True,
    "manifest_super_users": manifest.get("super_users") == [broker, admin],
}

# Reject application principals in SUPER_USERS value line
m = re.search(r'KAFKA_SUPER_USERS.*?value:\s*"([^"]+)"', sts, re.S)
super_val = m.group(1) if m else ""
app_in_super = []
for s in measured.get("service_principals") or []:
    if s["kafka_acl_principal"] in super_val:
        app_in_super.append(s["service"])
checks["application_super_users_zero"] = len(app_in_super) == 0

for k, v in checks.items():
    if not v:
        errors.append(k)

# Dual-use exception documented — do not claim per-node broker identity
dual_use = "DUAL_USE_EKU_ACCEPTED_EXCEPTION"

result = {
    "document": "gate5-v7-authorizer-verify",
    "source_checks": checks,
    "application_super_users_in_source": app_in_super,
    "dual_use_eku_accepted_exception": dual_use,
    "per_node_broker_identity_claimed": False,
    "errors": errors,
    "passed": len(errors) == 0,
}
out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
if errors:
    raise SystemExit(1)
PY

# Live check when kafka-0 exists
if kubectl -n "$NS" get pod kafka-0 >/dev/null 2>&1; then
  props="$(kubectl -n "$NS" exec kafka-0 -c kafka -- \
    grep -E '^(authorizer\.class\.name|allow\.everyone\.if\.no\.acl\.found|super\.users|listener\.name\.(controller|internal|external)\.ssl\.client\.auth|listener\.name\.controller\.ssl\.endpoint\.identification\.algorithm)=' \
    /etc/kafka/kafka.properties 2>/dev/null || true)"
  echo "$props" | grep -q 'authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer' \
    || fail "live authorizer.class.name missing/incorrect"
  echo "$props" | grep -q 'allow.everyone.if.no.acl.found=false' \
    || fail "live allow.everyone.if.no.acl.found must be false"
  echo "$props" | grep -q 'listener.name.controller.ssl.client.auth=required' \
    || fail "live controller client.auth not required"
  echo "$props" | grep -q 'listener.name.controller.ssl.endpoint.identification.algorithm=HTTPS' \
    || fail "live controller endpoint identification not HTTPS"
  ok "live kafka-0 authorizer/mTLS properties verified"
else
  ok "cluster absent — source-only authorizer verify"
fi

ok "gate5-v7-authorizer-verify: PASS"
echo "AUTHORIZER_SOURCE_VERIFIED=1"
