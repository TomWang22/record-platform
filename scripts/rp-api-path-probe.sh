#!/usr/bin/env bash
# Live edge API path probe (record-platform.test, dev-chain.pem).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/rp-dev-ca.sh
source "$ROOT/scripts/lib/rp-dev-ca.sh"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
REPORT="${REPORT:-$ROOT/bench_logs/frontend-contract/api-path-probe-report.md}"
mkdir -p "$(dirname "$REPORT")"

# Redact JWTs and password fields before writing reports or stdout.
redact_probe_note() {
  python3 -c '
import re, sys
s = sys.stdin.read()
s = re.sub(r"\"token\"\s*:\s*\"[^\"]+\"", "\"token\":\"[REDACTED]\"", s)
s = re.sub(r"\"password\"\s*:\s*\"[^\"]+\"", "\"password\":\"[REDACTED]\"", s)
s = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED_JWT]", s)
print(s[:80])
' <<<"${1:-}"
}

token=""
token="$(curl -sfS --max-time 15 --cacert "$CA" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"

paths=(
  "/healthz"
  "/api/readyz"
  "/api/auth/login"
  "/api/listings/search?limit=5"
  "/api/listings/mine"
  "/api/records"
  "/api/profile/feedback"
  "/api/notifications"
  "/api/messages/conversations"
  "/api/messages/start"
  "/api/shopping/watchlist"
  "/api/webapp-version"
)

{
  echo "# API path probe"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Base: \`$BASE\`"
  echo "CA: \`$CA\`"
  echo "Auth token: $([ -n "$token" ] && echo obtained || echo MISSING)"
  echo ""
  echo "| path | method | http | note |"
  echo "|------|--------|------|------|"
} >"$REPORT"

for p in "${paths[@]}"; do
  meth=GET
  extra=()
  if [[ "$p" == "/api/auth/login" ]]; then meth=POST; extra=(-X POST -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"); fi
  if [[ "$p" == "/api/messages/start" ]]; then meth=POST; extra=(-X POST -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' -d '{"listing_id":"00000000-0000-0000-0000-000000000001","initial_message":"probe"}'); fi
  auth=()
  [[ -n "$token" && "$p" != "/api/auth/login" && "$p" != "/healthz" && "$p" != "/api/webapp-version" ]] && auth=(-H "Authorization: Bearer $token")
  code=$(curl -sS -o /tmp/rp-probe-body.json -w '%{http_code}' --max-time 15 --cacert "$CA" "${extra[@]}" "${auth[@]}" "$BASE$p" 2>/dev/null || echo "000")
  note=""
  if [[ -f /tmp/rp-probe-body.json ]]; then
    note="$(tr '\n' ' ' </tmp/rp-probe-body.json | redact_probe_note)"
  fi
  if [[ "$p" == "/api/auth/login" ]]; then
    note='{"token":"[REDACTED]"}'
  fi
  echo "| \`$p\` | $meth | $code | ${note:-—} |" >>"$REPORT"
  printf '%-45s %s %s\n' "$p" "$code" "${note:0:60}"
done

echo ""
echo "Report: $REPORT"
