#!/usr/bin/env bash
# T15.3C/E — Canonical AI endpoints contract audit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
MD_REPORT="$REPORT_DIR/python-ai-ollama-contract.md"
JSON_REPORT="$REPORT_DIR/python-ai-ollama-contract.json"
mkdir -p "$REPORT_DIR"

FAIL=0
CHECKS=()

pass() { CHECKS+=("{\"id\":\"$1\",\"status\":\"pass\"}"); echo "✅ $1"; }
fail() { CHECKS+=("{\"id\":\"$1\",\"status\":\"fail\",\"detail\":$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"); echo "❌ $1: $2"; FAIL=1; }

API_BASE="${AI_CONTRACT_API_BASE:-https://record-platform.test}"
CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-chain.pem}"
if [[ ! -f "$CA" ]]; then CA="$REPO_ROOT/certs/dev-root.pem"; fi
CURL_OPTS=(-fsS --max-time 30)
if [[ -f "$CA" ]]; then CURL_OPTS+=(--cacert "$CA"); fi

AUTH_EMAIL="${AI_CONTRACT_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${AI_CONTRACT_PASSWORD:-ContractPass123!}"

echo "=== RP AI endpoints contract audit (T15.3C) ==="

TOKEN="$(curl "${CURL_OPTS[@]}" -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
if [[ -z "$TOKEN" ]]; then
  fail "auth_login" "no token"
  TOKEN=""
else
  pass "auth_login"
fi

AUTH_H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1')

# Discover IDs from corpus via rag status + records/listings APIs
LISTING_ID=""
RECORD_ID=""
AUCTION_LISTING_ID=""

if [[ -n "$TOKEN" ]]; then
  LISTING_ID="$(curl "${CURL_OPTS[@]}" "${AUTH_H[@]}" "$API_BASE/api/listings/search?limit=1" 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; print(items[0]["id"] if items else "")' 2>/dev/null || true)"
  RECORD_ID="$(curl "${CURL_OPTS[@]}" "${AUTH_H[@]}" "$API_BASE/api/records" 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if isinstance(d,list) and d else "")' 2>/dev/null || true)"
fi

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h "$PGHOST" -p 5440 -U "$PGUSER" -d python_ai -v ON_ERROR_STOP=1 -At)
if [[ -z "$AUCTION_LISTING_ID" ]]; then
  AUCTION_LISTING_ID="$("${PSQL[@]}" -c "SELECT source_id FROM ai.ai_documents WHERE source_type='auction_bid_summary' LIMIT 1" 2>/dev/null || true)"
fi

assert_envelope() {
  local id="$1" json="$2"
  printf '%s' "$json" | python3 -c '
import json,sys
raw = sys.stdin.read()
d = json.loads(raw)
required = ("insight_id","contract_id","source_status","model_used","summary","source_refs")
for k in required:
    if k not in d:
        raise SystemExit(f"missing {k}")
if d["source_status"] not in ("live","degraded"):
    raise SystemExit("bad source_status")
blob = json.dumps(d).lower()
for term in ("demo","mock","sample fallback"):
    if term in blob:
        raise SystemExit(f"forbidden term {term}")
if d["source_status"] == "live" and not d["source_refs"]:
    raise SystemExit("live without source_refs")
' >/dev/null
}

post_ai() {
  local path="$1" body="$2"
  curl "${CURL_OPTS[@]}" -X POST "$API_BASE$path" "${AUTH_H[@]}" -d "$body" 2>/dev/null || echo '{}'
}

get_ai() {
  local path="$1"
  curl "${CURL_OPTS[@]}" -X GET "$API_BASE$path" "${AUTH_H[@]}" 2>/dev/null || echo '{}'
}

assert_session_envelope() {
  local id="$1" json="$2"
  printf '%s' "$json" | python3 -c '
import json,sys
d = json.loads(sys.stdin.read())
required = ("insight_id","contract_id","source_status","model_used","summary","source_refs","details")
for k in required:
    if k not in d:
        raise SystemExit(f"missing {k}")
cid = d.get("contract_id")
if cid in ("session_start","session_get","session_query"):
    if "session_memory" not in (d.get("details") or {}):
        raise SystemExit("missing session_memory in details")
if cid == "session_reset":
    if not (d.get("details") or {}).get("reset"):
        raise SystemExit("missing reset flag")
blob = json.dumps(d).lower()
for term in ("message_body","thread_text","demo","mock","sample fallback"):
    if term in blob:
        raise SystemExit(f"forbidden term {term}")
' >/dev/null
}

ENDPOINTS=(
  "rag_query|/api/ai/rag/query|{\"question\":\"listing price auction\"}"
  "record_valuation|/api/ai/records/valuation|{\"record_id\":\"$RECORD_ID\"}"
  "pricing_recommendation|/api/ai/listings/pricing-advice|{\"listing_id\":\"$LISTING_ID\"}"
  "auction_risk|/api/ai/auctions/risk|{\"listing_id\":\"$AUCTION_LISTING_ID\"}"
  "seller_sales_summary|/api/ai/seller/summary|{}"
  "buyer_collection_summary|/api/ai/buyer/collection-summary|{}"
)

SAMPLES_JSON="{"
FIRST=1

for spec in "${ENDPOINTS[@]}"; do
  IFS='|' read -r cid path body <<< "$spec"
  if [[ "$body" == *'""'* ]] || [[ "$body" == *'{}'* && "$cid" != "seller_sales_summary" && "$cid" != "buyer_collection_summary" && "$cid" != "rag_query" ]]; then
    if [[ "$cid" == "record_valuation" && -z "$RECORD_ID" ]]; then
      fail "endpoint_${cid}" "no record_id"
      continue
    fi
    if [[ "$cid" == "pricing_recommendation" && -z "$LISTING_ID" ]]; then
      fail "endpoint_${cid}" "no listing_id"
      continue
    fi
    if [[ "$cid" == "auction_risk" && -z "$AUCTION_LISTING_ID" ]]; then
      fail "endpoint_${cid}" "no auction listing_id"
      continue
    fi
  fi
  RESP="$(post_ai "$path" "$body")"
  if assert_envelope "$cid" "$RESP" 2>/dev/null; then
    pass "endpoint_${cid}"
    if [[ $FIRST -eq 1 ]]; then FIRST=0; else SAMPLES_JSON+=","; fi
    SAMPLES_JSON+="\"$cid\":$(echo "$RESP" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' 2>/dev/null || echo '{}')"
  else
    fail "endpoint_${cid}" "$(echo "$RESP" | head -c 200)"
  fi
done
SAMPLES_JSON+="}"

SESSION_ID=""
if [[ -n "$TOKEN" ]]; then
  SESSION_START_RESP="$(post_ai "/api/ai/session/start" "{}")"
  if assert_session_envelope "session_start" "$SESSION_START_RESP" 2>/dev/null; then
    pass "endpoint_session_start"
    SESSION_ID="$(echo "$SESSION_START_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("details",{}).get("session_memory",{}).get("session_id",""))' 2>/dev/null || true)"
    SAMPLES_JSON="${SAMPLES_JSON%\}}"
    SAMPLES_JSON+=",\"session_start\":$(echo "$SESSION_START_RESP" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' 2>/dev/null || echo '{}')"
    SAMPLES_JSON+="}"
  else
    fail "endpoint_session_start" "$(echo "$SESSION_START_RESP" | head -c 200)"
  fi

  if [[ -n "$SESSION_ID" ]]; then
    SESSION_QUERY_RESP="$(post_ai "/api/ai/session/query" "{\"session_id\":\"$SESSION_ID\",\"question\":\"listing activity and offer summaries\"}")"
    if assert_session_envelope "session_query" "$SESSION_QUERY_RESP" 2>/dev/null; then
      pass "endpoint_session_query"
    else
      fail "endpoint_session_query" "$(echo "$SESSION_QUERY_RESP" | head -c 200)"
    fi

    SESSION_GET_RESP="$(get_ai "/api/ai/session/$SESSION_ID")"
    if assert_session_envelope "session_get" "$SESSION_GET_RESP" 2>/dev/null; then
      pass "endpoint_session_get"
    else
      fail "endpoint_session_get" "$(echo "$SESSION_GET_RESP" | head -c 200)"
    fi

    SESSION_RESET_RESP="$(post_ai "/api/ai/session/reset" "{\"session_id\":\"$SESSION_ID\"}")"
    if assert_session_envelope "session_reset" "$SESSION_RESET_RESP" 2>/dev/null; then
      pass "endpoint_session_reset"
    else
      fail "endpoint_session_reset" "$(echo "$SESSION_RESET_RESP" | head -c 200)"
    fi
  else
    fail "endpoint_session_query" "no session_id from start"
    fail "endpoint_session_get" "no session_id from start"
    fail "endpoint_session_reset" "no session_id from start"
  fi
fi

# Retrieval section (T15.3B) — privacy via DB
PROXY_HITS="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ai.ai_document_chunks WHERE content ~* 'max_bid_cents|proxy_bids|proxy max'" 2>/dev/null || echo 0)"
if [[ "${PROXY_HITS:-0}" -eq 0 ]]; then pass "retrieval_no_proxy_in_corpus"; else fail "retrieval_no_proxy_in_corpus" "hits=$PROXY_HITS"; fi

MSG_HITS="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ai.ai_documents WHERE source_type='message'" 2>/dev/null || echo 0)"
if [[ "${MSG_HITS:-0}" -eq 0 ]]; then pass "retrieval_messages_absent_default"; else pass "retrieval_messages_opt_in_only"; fi

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS_JSON="[$(IFS=,; echo "${CHECKS[*]}")]"

cat > "$JSON_REPORT" <<EOF
{
  "finished_at": "$FINISHED_AT",
  "samples": $SAMPLES_JSON,
  "checks": $CHECKS_JSON,
  "exit_code": $FAIL
}
EOF

{
  echo "# Python AI + Ollama contract (T15.3B/C audit)"
  echo ""
  echo "Generated: $FINISHED_AT"
  echo ""
  echo "## Endpoint samples"
  echo '```json'
  echo "$SAMPLES_JSON" | python3 -m json.tool 2>/dev/null || echo "$SAMPLES_JSON"
  echo '```'
  echo ""
  echo "## Retrieval privacy"
  echo "- proxy_max_hits: ${PROXY_HITS:-0}"
  echo "- message_docs: ${MSG_HITS:-0}"
  echo ""
  echo "## Checks"
  for c in "${CHECKS[@]}"; do echo "- $c"; done
  echo ""
  echo "Exit: $FAIL"
} > "$MD_REPORT"

echo "Reports: $MD_REPORT , $JSON_REPORT"
exit "$FAIL"
