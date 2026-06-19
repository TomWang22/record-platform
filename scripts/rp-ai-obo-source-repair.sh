#!/usr/bin/env bash
# T19.7B — Repair owner-visible OBO source data via real API offers + targeted reindex only.
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

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-7-obo-source-repair.md}"
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

echo "=== T19.7B OBO source repair ==="

e2e_t="$(login_token "$E2E_EMAIL")" || fail "e2e-contract login failed"
buyer_t="$(login_token "$BUYER_EMAIL")" || fail "buyer-contract login failed"
E2E_UID="$(user_id_for "$e2e_t")"
BUYER_UID="$(user_id_for "$buyer_t")"
[[ -n "$E2E_UID" && -n "$BUYER_UID" ]] || fail "could not resolve contract user IDs"

OFFERS_BEFORE="$(psql_listings "SELECT count(*) FROM listings.offers WHERE buyer_user_id='$E2E_UID' OR seller_user_id='$E2E_UID';")"
DOCS_BEFORE="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_documents WHERE source_type='obo_offer_summary' AND owner_user_id='$E2E_UID';")"

CREATED_FLOW=no
LISTING_ID=""
OFFER_ID=""
EVENTS_BEFORE="$(psql_listings "SELECT count(*) FROM listings.offer_events WHERE actor_user_id IN ('$E2E_UID','$BUYER_UID');")"

if [[ "$OFFERS_BEFORE" == "0" ]]; then
  say "Creating minimal real OBO flow for e2e-contract (seller) + buyer-contract (buyer)..."
  LISTING_BODY='{
    "title":"T19.7 OBO repair listing",
    "description":"Targeted OBO corpus repair for contract user shadow diagnostics",
    "price_cents":4999,
    "effective_from":"2026-05-01",
    "effective_until":"2027-05-01",
    "format":"LP",
    "media_condition":"VG+",
    "sleeve_condition":"VG",
    "pricing_mode":"fixed",
    "initial_status":"active",
    "images":["https://picsum.photos/seed/rp-t197obo/400/400"],
    "domestic_shipping_cents":500,
    "international_shipping_cents":1200,
    "shipping_service":"USPS Media Mail",
    "package_type":"record_mail",
    "domestic_shipping":true,
    "international_shipping":false,
    "local_pickup":false,
    "combined_shipping":true,
    "shipping_notes":"",
    "city":"Portland",
    "state_or_province":"OR",
    "country":"US"
  }'
  tmp="$(mktemp)"
  code="$(curl -sS --max-time 35 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/create" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "$LISTING_BODY" -o "$tmp" -w '%{http_code}')"
  LISTING_ID="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("id") or (d.get("listing") or {}).get("id") or "")' "$tmp" 2>/dev/null || true)"
  err_body="$(cat "$tmp" 2>/dev/null | head -c 400)"
  rm -f "$tmp"
  [[ "$code" == "201" || "$code" == "200" ]] && [[ -n "$LISTING_ID" ]] || fail "listing create failed http=$code body=$err_body"

  patch_code="$(curl -sS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X PATCH "$BASE/api/listings/$LISTING_ID" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"pricing_mode":"obo","amenities":["sale_type:obo","max_offer_attempts:5","allow_offers:true","offer_expiration_hours:48","allow_counteroffers:true"]}' \
    -o /dev/null -w '%{http_code}')"
  [[ "$patch_code" == "200" || "$patch_code" == "201" ]] || fail "OBO patch failed http=$patch_code"

  offer_tmp="$(mktemp)"
  offer_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/$LISTING_ID/offers" \
    -H "Authorization: Bearer $buyer_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"amountCents":4200,"message":"T19.7 contract repair offer"}' -o "$offer_tmp" -w '%{http_code}')"
  OFFER_ID="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("id") or (d.get("offer") or {}).get("id") or "")' "$offer_tmp" 2>/dev/null || true)"
  rm -f "$offer_tmp"
  [[ "$offer_code" == "201" ]] && [[ -n "$OFFER_ID" ]] || fail "offer create failed http=$offer_code"

  counter_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/$LISTING_ID/offers/$OFFER_ID/counter" \
    -H "Authorization: Bearer $e2e_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"amountCents":4500}' -o /dev/null -w '%{http_code}')"
  [[ "$counter_code" == "200" || "$counter_code" == "201" ]] || fail "seller counter failed http=$counter_code"
  CREATED_FLOW=yes
  say "✅ OBO flow created listing=$LISTING_ID offer=$OFFER_ID (countered)"
else
  say "Real offers already exist for e2e-contract ($OFFERS_BEFORE); skipping API flow"
fi

OFFERS_AFTER="$(psql_listings "SELECT count(*) FROM listings.offers WHERE buyer_user_id='$E2E_UID' OR seller_user_id='$E2E_UID';")"
EVENTS_AFTER="$(psql_listings "SELECT count(*) FROM listings.offer_events WHERE actor_user_id IN ('$E2E_UID','$BUYER_UID');")"
[[ "$OFFERS_AFTER" -gt 0 ]] || fail "no offers for e2e-contract after repair"

say "Running targeted RAG reindex: obo_offer_summary via --source offers --user $E2E_UID"
bash "$SCRIPT_DIR/rp-ai-rag-reindex.sh" --source offers --user "$E2E_UID"

DOCS_AFTER="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_documents WHERE source_type='obo_offer_summary' AND owner_user_id='$E2E_UID';")"
UNEMBEDDED="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='$E2E_UID' AND c.embedding_vec IS NULL;")"
LEAK="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='obo_offer_summary' AND d.owner_user_id='$E2E_UID'
  AND (c.content ~* 'message_body|thread_text|private obo|max_bid_cents|proxy_bids');")"

[[ "$DOCS_AFTER" -gt 0 ]] || fail "no obo_offer_summary ai_documents for e2e-contract after reindex"
[[ "$LEAK" == "0" ]] || fail "forbidden/private content in OBO chunks"

cat > "$REPORT_MD" <<EOF
# T19.7B — OBO source repair

- e2e-contract user_id: \`$E2E_UID\`
- buyer-contract user_id: \`$BUYER_UID\`
- real OBO flow created: **$CREATED_FLOW**
- listing_id: \`${LISTING_ID:-existing}\`
- offer_id: \`${OFFER_ID:-existing}\`
- offers for e2e before/after: $OFFERS_BEFORE → $OFFERS_AFTER
- offer_events (e2e+buyer) before/after: $EVENTS_BEFORE → $EVENTS_AFTER
- ai_documents obo before/after: $DOCS_BEFORE → $DOCS_AFTER
- unembedded OBO chunks for e2e: $UNEMBEDDED
- private/proxy leak chunks: $LEAK (must be 0)
- ingestion: **pipeline reindex only** (\`rp-ai-rag-reindex.sh --source offers --user\`)
EOF

say "Report: $REPORT_MD"
say "✅ T19.7B complete (docs=$DOCS_AFTER unembedded=$UNEMBEDDED)"
