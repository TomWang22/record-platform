#!/usr/bin/env bash
# Verify StandardAuthorizer is source-controlled and (when cluster present) live.
# Uses structural StatefulSet env parsing — not line-split heuristics.
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

sts_text = Path(sys.argv[1]).read_text(encoding="utf-8")
manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
measured = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
out = Path(sys.argv[4])

env = {}
for m in re.finditer(r"\{\s*name:\s*([A-Z0-9_]+)\s*,\s*value:\s*\"([^\"]*)\"\s*\}", sts_text):
    env[m.group(1)] = m.group(2)
for m in re.finditer(r"-\s*name:\s*([A-Z0-9_]+)\n\s*value:\s*\"([^\"]*)\"", sts_text):
    env.setdefault(m.group(1), m.group(2))

broker = measured["broker_server_leaf"]["kafka_acl_principal"]
admin = measured["recovery_admin"]["kafka_acl_principal"]
want_super = f"{broker};{admin}"
errors = []

def need(cond, name):
    if not cond:
        errors.append(name)

need(env.get("KAFKA_AUTHORIZER_CLASS_NAME") == "org.apache.kafka.metadata.authorizer.StandardAuthorizer", "authorizer_class_name")
need(sum(1 for v in env.values() if v == "org.apache.kafka.metadata.authorizer.StandardAuthorizer") == 1, "authorizer_exactly_once")
need(env.get("KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND") == "false", "allow_everyone_false")
need(env.get("KAFKA_SUPER_USERS") == want_super, "super_users_exact")
need(env.get("KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH") == "required", "controller_client_auth_required")
need(env.get("KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH") == "required", "internal_client_auth_required")
need(env.get("KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH") == "required", "external_client_auth_required")
need(env.get("KAFKA_LISTENER_NAME_CONTROLLER_SSL_ENDPOINT_IDENTIFICATION_ALGORITHM") == "HTTPS", "controller_endpoint_https")
need(manifest.get("apply_authorized") is True, "manifest_apply_authorized")
need(manifest.get("super_users") == [broker, admin], "manifest_super_users")

app_in_super = []
super_val = env.get("KAFKA_SUPER_USERS") or ""
for s in measured.get("service_principals") or []:
    if s["kafka_acl_principal"] in super_val:
        app_in_super.append(s["service"])
need(len(app_in_super) == 0, "application_super_users_zero")

result = {
    "document": "gate5-v7-authorizer-verify",
    "source_checks": {
        "authorizer_class_name": "authorizer_class_name" not in errors,
        "authorizer_exactly_once": "authorizer_exactly_once" not in errors,
        "allow_everyone_false": "allow_everyone_false" not in errors,
        "super_users_exact": "super_users_exact" not in errors,
        "controller_client_auth_required": "controller_client_auth_required" not in errors,
        "controller_endpoint_https": "controller_endpoint_https" not in errors,
        "internal_client_auth_required": "internal_client_auth_required" not in errors,
        "external_client_auth_required": "external_client_auth_required" not in errors,
        "manifest_apply_authorized": "manifest_apply_authorized" not in errors,
        "manifest_super_users": "manifest_super_users" not in errors,
        "application_super_users_zero": "application_super_users_zero" not in errors,
    },
    "application_super_users_in_source": app_in_super,
    "dual_use_eku_accepted_exception": "DUAL_USE_EKU_ACCEPTED_EXCEPTION",
    "per_node_broker_identity_claimed": False,
    "errors": errors,
    "passed": len(errors) == 0,
}
out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
if errors:
    raise SystemExit(1)
PY

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
