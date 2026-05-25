#!/usr/bin/env bash
# webapp must not call internal services directly unless certPolicy marks webapp mtlsRequired=true.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACT="$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json"
WEBAPP="$REPO_ROOT/webapp"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

_webapp_mtls_required() {
  python3 - "$CONTRACT" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
for row in doc.get("certPolicy", {}).get("nonMtls", []):
    if row.get("serviceName") == "webapp":
        sys.exit(0 if row.get("mtlsRequired") else 1)
for row in doc.get("certPolicy", {}).get("mtlsServices", []):
    if row.get("serviceName") == "webapp" and row.get("mtlsRequired"):
        sys.exit(0)
sys.exit(1)
PY
}

_patterns=(
  '*.record-platform.svc.cluster.local'
  'auth-service:'
  'records-service:'
  'listings-service:'
  'shopping-service:'
  'messaging-service:'
  'trust-service:'
  'notification-service:'
  'analytics-service:'
  'media-service:'
  'python-ai-service:'
  'auction-monitor:'
)

echo "audit-rp-webapp-internal-calls"

if _webapp_mtls_required; then
  ok "webapp certPolicy.mtlsRequired=true — direct internal calls allowed (must mount service-tls-webapp)"
  exit 0
fi

ok "webapp policy: edge TLS via Caddy/nginx only; route server-side calls through api-gateway"

_hits=()
for pat in "${_patterns[@]}"; do
  while IFS= read -r f; do
    [[ -n "$f" ]] && _hits+=("$f:$pat")
  done < <(grep -Rsl "$pat" "$WEBAPP/app" "$WEBAPP/components" "$WEBAPP/lib" "$WEBAPP/middleware.ts" 2>/dev/null \
    | grep -vE '__tests__|\.test\.|\.spec\.' || true)
done

if [[ ${#_hits[@]} -gt 0 ]]; then
  bad "webapp contains direct internal service targets (use api-gateway or set webapp mtlsRequired=true):"
  printf '  %s\n' "${_hits[@]}" | head -20 >&2
  [[ ${#_hits[@]} -gt 20 ]] && echo "  … and more" >&2
else
  ok "no direct internal *.svc.cluster.local / service:port targets in webapp"
fi

[[ "$FAIL" -eq 0 ]] && exit 0
exit 1
