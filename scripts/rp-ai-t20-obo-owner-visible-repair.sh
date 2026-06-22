#!/usr/bin/env bash
# T20.10D — Repair owner-visible OBO corpus depth for contract seller (source + reindex + embed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t20-10d-obo-owner-visible-repair.md}"
TARGET_SELLER_OFFERS="${TARGET_SELLER_OFFERS:-10}"
MAX_NEW_FLOWS="${MAX_NEW_FLOWS:-12}"
mkdir -p "$(dirname "$REPORT_MD")"

CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "https://record-platform.test")"
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
E2E_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"

LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
CURL_EDGE=()
[[ -n "$LB_IP" ]] && CURL_EDGE=(--resolve "${HOST}:443:${LB_IP}")

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { echo "$*"; }
fail() { echo "❌ $*" >&2; exit 1; }

login_token() {
  curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")'
}

user_id_for() {
  curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/auth/me" \
    -H "Authorization: Bearer $1" -H 'X-RP-E2E-Contract: 1' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("user") or d; print(str(u.get("sub") or u.get("id") or u.get("user_id") or "").strip())'
}

psql_listings() {
  psql -h "$PGHOST" -p 5435 -U "$PGUSER" -d listings -v ON_ERROR_STOP=1 -At -c "$1"
}

count_seller_offers() {
  psql_listings "SELECT count(*) FROM listings.offers WHERE seller_user_id='$1';"
}

count_obo_docs() {
  rp_python_ai_psql "SELECT count(*) FROM ai.ai_documents WHERE source_type='obo_offer_summary' AND owner_user_id='$1';"
}

count_embedded_obo() {
  rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='$1' AND c.embedding_vec IS NOT NULL;"
}

create_obo_flow() {
  local idx="$1"
  local price=$((4500 + idx * 11))
  local offer_amt=$((4000 + idx * 17))
  local counter_amt=$((4300 + idx * 17))
  local listing_body
  listing_body="$(jq -n \
    --arg title "T20.10D OBO repair listing ${idx}" \
    --argjson price "$price" \
    '{
      title: $title,
      description: "Targeted owner-visible OBO corpus repair for e2e-contract seller",
      price_cents: $price,
      effective_from: "2026-05-01",
      effective_until: "2027-05-01",
      format: "LP",
      media_condition: "VG+",
      sleeve_condition: "VG",
      pricing_mode: "fixed",
      initial_status: "active",
      images: ["https://picsum.photos/seed/rp-t20dobo/400/400"],
      domestic_shipping_cents: 500,
      international_shipping_cents: 1200,
      shipping_service: "USPS Media Mail",
      package_type: "record_mail",
      domestic_shipping: true,
      international_shipping: false,
      local_pickup: false,
      combined_shipping: true,
      shipping_notes: "",
      city: "Portland",
      state_or_province: "OR",
      country: "US"
    }')"

  local tmp listing_id code err_body
  tmp="$(mktemp)"
  code="$(curl -sS --max-time 35 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/create" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "$listing_body" -o "$tmp" -w '%{http_code}')"
  listing_id="$(jq -r '.id // .listing.id // empty' "$tmp" 2>/dev/null || true)"
  err_body="$(head -c 400 "$tmp" 2>/dev/null || true)"
  rm -f "$tmp"
  [[ "$code" == "201" || "$code" == "200" ]] && [[ -n "$listing_id" ]] || fail "listing create failed idx=$idx http=$code body=$err_body"

  local patch_code
  patch_code="$(curl -sS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X PATCH "$BASE/api/listings/$listing_id" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"pricing_mode":"obo","amenities":["sale_type:obo","max_offer_attempts:5","allow_offers:true","offer_expiration_hours:48","allow_counteroffers:true"]}' \
    -o /dev/null -w '%{http_code}')"
  [[ "$patch_code" == "200" || "$patch_code" == "201" ]] || fail "OBO patch failed listing=$listing_id http=$patch_code"

  local offer_tmp offer_code offer_id
  offer_tmp="$(mktemp)"
  offer_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/$listing_id/offers" \
    -H "Authorization: Bearer $buyer_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"amountCents\":${offer_amt},\"message\":\"T20.10D repair offer ${idx}\"}" -o "$offer_tmp" -w '%{http_code}')"
  offer_id="$(jq -r '.id // .offer.id // empty' "$offer_tmp" 2>/dev/null || true)"
  rm -f "$offer_tmp"
  [[ "$offer_code" == "201" ]] && [[ -n "$offer_id" ]] || fail "offer create failed listing=$listing_id http=$offer_code"

  local counter_code
  counter_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/$listing_id/offers/$offer_id/counter" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"amountCents\":${counter_amt}}" -o /dev/null -w '%{http_code}')"
  [[ "$counter_code" == "200" || "$counter_code" == "201" ]] || fail "seller counter failed offer=$offer_id http=$counter_code"
  say "  ✅ flow $idx listing=$listing_id offer=$offer_id"
}

echo "=== T20.10D owner-visible OBO corpus repair ==="

rp_python_ai_psql_connect_check || fail "python_ai DB unreachable"

e2e_t="$(login_token "$E2E_EMAIL")" || fail "e2e-contract login failed"
buyer_t="$(login_token "$BUYER_EMAIL")" || fail "buyer-contract login failed"
E2E_UID="$(user_id_for "$e2e_t")"
BUYER_UID="$(user_id_for "$buyer_t")"
[[ -n "$E2E_UID" && -n "$BUYER_UID" ]] || fail "could not resolve contract user IDs"

OFFERS_BEFORE="$(count_seller_offers "$E2E_UID")"
DOCS_BEFORE="$(count_obo_docs "$E2E_UID")"
EMBEDDED_BEFORE="$(count_embedded_obo "$E2E_UID")"
PRE_TOTAL_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"

NEED=$((TARGET_SELLER_OFFERS - OFFERS_BEFORE))
CREATED=0
if [[ "$NEED" -gt 0 ]]; then
  say "Seeding $NEED seller OBO flow(s) for e2e-contract (have $OFFERS_BEFORE, target $TARGET_SELLER_OFFERS)..."
  for ((i = 1; i <= NEED && i <= MAX_NEW_FLOWS; i++)); do
    create_obo_flow "$i"
    CREATED=$((CREATED + 1))
  done
else
  say "Seller offers already at target ($OFFERS_BEFORE >= $TARGET_SELLER_OFFERS); skipping API seed"
fi

OFFERS_AFTER="$(count_seller_offers "$E2E_UID")"

say "Running targeted RAG reindex: --source offers --user $E2E_UID"
bash "$SCRIPT_DIR/rp-ai-rag-reindex.sh" --source offers --user "$E2E_UID"

UNEMBEDDED="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='$E2E_UID' AND c.embedding_vec IS NULL;")"

if [[ "$UNEMBEDDED" -gt 0 ]]; then
  say "Embedding $UNEMBEDDED owner-visible OBO chunk(s) for e2e-contract..."
  OBO_EMBED_ALL_CONTRACT_USERS=0 bash "$SCRIPT_DIR/rp-ai-embed-obo-owner-visible.sh"
fi

DOCS_AFTER="$(count_obo_docs "$E2E_UID")"
EMBEDDED_AFTER="$(count_embedded_obo "$E2E_UID")"
POST_TOTAL_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
LEAK="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='$E2E_UID'
  AND (c.content ~* 'message_body|thread_text|private obo|max_bid_cents|proxy_bids');")"

[[ "$DOCS_AFTER" -gt 0 ]] || fail "no obo_offer_summary ai_documents for e2e-contract after repair"
[[ "$LEAK" == "0" ]] || fail "forbidden/private content in OBO chunks"

cat > "$REPORT_MD" <<EOF
# T20.10D — Owner-visible OBO corpus repair

## Root cause

Insufficient seller-side source offers for e2e-contract, not privacy filtering.

## Counts (e2e-contract seller)

| Metric | Before | After |
|--------|-------:|------:|
| seller offers | $OFFERS_BEFORE | $OFFERS_AFTER |
| obo ai_documents | $DOCS_BEFORE | $DOCS_AFTER |
| embedded obo chunks | $EMBEDDED_BEFORE | $EMBEDDED_AFTER |
| global embedded total | $PRE_TOTAL_EMBEDDED | $POST_TOTAL_EMBEDDED |

- flows created: $CREATED
- unembedded pre-embed: $UNEMBEDDED
- leak chunks: $LEAK

## User IDs

- e2e-contract: \`$E2E_UID\`
- buyer-contract: \`$BUYER_UID\`
EOF

say "Report: $REPORT_MD"
say "✅ T20.10D repair complete (seller offers ${OFFERS_BEFORE}->${OFFERS_AFTER}, embedded obo ${EMBEDDED_BEFORE}->${EMBEDDED_AFTER})"
