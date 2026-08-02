#!/usr/bin/env bash
# Lockout-safe authorizer + ACL preflight.
# DOES NOT enable StandardAuthorizer.
# DOES NOT apply ACLs.
# Exits non-zero if required preflight artifacts are missing or if authorizer is
# already fail-closed without a validated recovery principal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-record-platform}"

MANIFEST="${REPO_ROOT}/reports/kafka/gate5-v7-final-acl-manifest.json"
PREFLIGHT="${REPO_ROOT}/reports/kafka/gate5-v7-authorizer-preflight.json"
OBS="${REPO_ROOT}/reports/kafka/gate5-v7-observed-principals.json"
CTRL="${REPO_ROOT}/reports/kafka/gate5-v7-controller-mtls-design.json"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -f "$MANIFEST" ]] || fail "missing final ACL manifest: ${MANIFEST}"
[[ -f "$PREFLIGHT" ]] || fail "missing authorizer preflight report: ${PREFLIGHT}"
[[ -f "$OBS" ]] || fail "missing principal inventory: ${OBS}"
[[ -f "$CTRL" ]] || fail "missing controller mTLS design: ${CTRL}"

python3 - "$MANIFEST" "$PREFLIGHT" "$OBS" <<'PY'
import json, sys
manifest = json.loads(open(sys.argv[1], encoding="utf-8").read())
preflight = json.loads(open(sys.argv[2], encoding="utf-8").read())
obs = json.loads(open(sys.argv[3], encoding="utf-8").read())
assert preflight.get("authorizer_enablement_authorized") is False
assert preflight.get("final_acls_apply_authorized") is False
assert manifest.get("apply_authorized") is False
assert len(manifest.get("service_principals", {})) == 12
assert obs["summary"]["services_observed"] == 12
assert preflight.get("rollback_manifest_prepared") is True
assert preflight.get("admin_recovery_principal_defined") is True
print("preflight_invariants_ok")
PY

# Live: authorizer must still be absent (this stop gate)
if kubectl -n "$NS" get pod kafka-0 >/dev/null 2>&1; then
  props="$(kubectl -n "$NS" exec kafka-0 -c kafka -- sh -c 'grep -E "^(authorizer|allow.everyone|super.users)" /etc/kafka/kafka.properties || true' 2>/dev/null || true)"
  if echo "$props" | grep -q 'authorizer.class.name'; then
    fail "authorizer already configured — this stop gate expects authorizer still absent; do not proceed without explicit enablement run"
  fi
  ok "live authorizer still absent (expected at this stop gate)"
fi

ok "gate5-v7-authorizer-preflight: PASS (enablement deferred)"
echo "AUTHORIZER_ENABLEMENT_DEFERRED=1"
echo "FINAL_ACL_APPLY_DEFERRED=1"
