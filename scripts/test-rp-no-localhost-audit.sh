#!/usr/bin/env bash
# Regression tests for rp-audit-no-localhost-nodeport.sh allowlists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/rp-localhost-allowlist.sh
source "$SCRIPT_DIR/lib/rp-localhost-allowlist.sh"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

# 1) Repo audit must pass (includes narrow api-gateway sidecar exception).
bash "$SCRIPT_DIR/rp-audit-no-localhost-nodeport.sh"
ok "rp-audit-no-localhost-nodeport.sh passes on active manifests"

# 2) Exact same-pod sidecar line is allowlisted.
gw_deploy="$REPO_ROOT/infra/k8s/base/api-gateway/deploy.yaml"
line='              value: "http://127.0.0.1:4000/readyz"'
rp_allow_api_gateway_sidecar_watchdog_gateway_url "$gw_deploy" "$line" \
  || fail "api-gateway transport-watchdog sidecar URL must be allowlisted"
ok "api-gateway same-pod sidecar 127.0.0.1:4000/readyz is allowlisted"

# 3) Unrelated 127.0.0.1 on another manifest must not be allowlisted.
other="$REPO_ROOT/infra/k8s/base/trust-service/deploy.yaml"
bad_line='              value: "http://127.0.0.1:4000/readyz"'
if rp_allow_api_gateway_sidecar_watchdog_gateway_url "$other" "$bad_line"; then
  fail "127.0.0.1 on trust-service deploy must not match api-gateway-only allowlist"
fi
ok "unrelated 127.0.0.1 on trust-service is not allowlisted"

# 4) Forbidden fixture under audit test dir must fail the audit.
fixture_dir="$REPO_ROOT/bench_logs/_audit_test_fixtures"
mkdir -p "$fixture_dir"
trap 'rm -f "$fixture_dir/forbidden-localhost.yaml"' EXIT
cat >"$fixture_dir/forbidden-localhost.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
data:
  BAD_URL: "http://127.0.0.1:5999/forbidden"
YAML

if RP_AUDIT_TEST_FIXTURES=1 bash "$SCRIPT_DIR/rp-audit-no-localhost-nodeport.sh" >/dev/null 2>&1; then
  fail "forbidden 127.0.0.1 fixture must fail audit when RP_AUDIT_TEST_FIXTURES=1"
fi
ok "forbidden localhost fixture fails audit"

echo ""
ok "test-rp-no-localhost-audit.sh: all checks passed"
