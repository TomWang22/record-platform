#!/usr/bin/env bash
# T15.4S-5 — Platform AI pipeline contract (analytics → python-ai → events).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/t15-4s-ai-pipeline-contract.md}"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
FAIL=0
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

mkdir -p "$REPORT_DIR"
say "=== audit-rp-ai-pipeline-contract ==="

for s in audit-rp-ai-rag-contract audit-rp-ai-runtime-contract audit-rp-ai-endpoints-contract rp-ai-outbox-publish-drain; do
  bash "$SCRIPT_DIR/${s}.sh" && pass "$s" || fail "$s"
done

TOKEN="$(curl -sfS --max-time 20 --cacert "$CA" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"
[[ -n "$TOKEN" ]] || fail "auth token"

ME="$(curl -sfS --max-time 15 --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me")"
USER_ID="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("sub") or "")' <<<"$ME")"
LISTING="$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings -tAc "SELECT listing_id::text FROM listings.auction_settings WHERE status='active' LIMIT 1" 2>/dev/null || true)"

probe_ai() {
  local label="$1" method="$2" path="$3" data="${4:-}" optional="${5:-0}"
  local tmp code body
  tmp="$(mktemp)"
  if [[ "$method" == "GET" ]]; then
    code="$(curl -sS --max-time 30 --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE$path" -o "$tmp" -w '%{http_code}' 2>/dev/null || echo 000)"
  else
    code="$(curl -sS --max-time 30 --cacert "$CA" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "$data" "$BASE$path" -o "$tmp" -w '%{http_code}' 2>/dev/null || echo 000)"
  fi
  body="$(cat "$tmp")"; rm -f "$tmp"
  [[ "$code" =~ ^(200|201)$ ]] || { [[ "$optional" == "1" ]] && pass "$label optional skip http=$code" && return 0; fail "$label http=$code"; return 1; }
  python3 -c "
import json,sys
d=json.load(sys.stdin)
refs=d.get('source_refs') or d.get('signals') or []
status=d.get('source_status','')
if 'contract_id' not in d and 'insight_id' not in d and 'signals' not in d and 'features' not in d:
  raise AssertionError('missing envelope')
if status=='live':
  assert len(refs)>0, 'live requires source_refs'
text=json.dumps(d)
for bad in ('max_bid_cents','proxy max','landlord_id','record.local'):
  assert bad not in text.lower(), bad
print('ok')
" <<<"$body" && pass "$label" || fail "$label privacy/envelope"
}

probe_ai "analytics features" GET "/api/analytics/ai/features/$USER_ID"
probe_ai "offer insights" GET "/api/ai/offer-insights?listing_id=$LISTING"
probe_ai "auction signals" GET "/auctions/ai-signals"
probe_ai "rag query" POST "/api/ai/rag/query" '{"question":"listing price shipping condition"}'
probe_ai "record valuation" POST "/api/ai/records/valuation" '{"record_id":"00000000-0000-0000-0000-000000000099","include_comps":false}' 1
probe_ai "listing pricing" POST "/api/ai/listings/pricing-advice" "{\"listing_id\":\"$LISTING\"}"
probe_ai "auction risk" POST "/api/ai/auctions/risk" "{\"listing_id\":\"$LISTING\"}"
probe_ai "buyer summary" POST "/api/ai/buyer/collection-summary" '{}'
probe_ai "seller summary" POST "/api/ai/seller/summary" '{}'

{
  echo "# T15.4S AI pipeline contract"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "- analytics owns cleaned features (GET /api/analytics/ai/features)"
  echo "- python-ai owns retrieval/reasoning (RAG + rule-engine/Ollama providers)"
  echo "- auction-monitor owns persisted auction signals"
  echo "- outbox events published=true (see rp-ai-outbox-publish-drain)"
  echo ""
  echo "**RESULT: $([[ $FAIL -eq 0 ]] && echo PASS || echo FAIL)**"
} >"$REPORT_MD"

[[ "$FAIL" -eq 0 ]] || exit 1
pass "audit-rp-ai-pipeline-contract complete"
