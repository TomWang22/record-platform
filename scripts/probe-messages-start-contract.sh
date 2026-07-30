#!/usr/bin/env bash
# Messaging start contract probes — strict TLS, jq hard-fail assertions.
# Usage:
#   API_BASE=https://record-platform.test ./scripts/probe-messages-start-contract.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/rp-http3-edge-lib.sh
source "$ROOT/scripts/lib/rp-http3-edge-lib.sh"
# shellcheck source=lib/edge-test-url.sh
source "$ROOT/scripts/lib/edge-test-url.sh"

API_BASE="${API_BASE:-${E2E_API_BASE:-https://record-platform.test}}"
API_BASE="${API_BASE%/}"
PASSWORD="${CONTRACT_PASSWORD:-ContractPass123!}"
BUYER_EMAIL="${BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${SELLER_EMAIL:-seller-contract@record-platform.local}"
REPORT_DIR="${REPORT_DIR:-$ROOT/bench_logs/messaging-contract}"
REPORT="${REPORT:-$REPORT_DIR/messages-start-probe.md}"
NS="${K8S_NAMESPACE:-record-platform}"

HOST="$(edge_hostname_from_https_url "$API_BASE")"
CA="$(rp_http3_ca_cert)"
EDGE_LB_IP="${EDGE_LB_IP:-$(rp_http3_lb_ip)}"
if [[ -z "$EDGE_LB_IP" || ! "$EDGE_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  EDGE_LB_IP="$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
fi
if [[ -z "$EDGE_LB_IP" || ! "$EDGE_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  EDGE_LB_IP="$(edge_hint_lb_ip_for_och || true)"
fi
[[ -n "$EDGE_LB_IP" && "$EDGE_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "FAIL: EDGE_LB_IP missing — set EDGE_LB_IP or ensure caddy-h3 LoadBalancer IP" >&2
  exit 1
}
[[ -f "$CA" ]] || { echo "FAIL: CA cert missing at $CA" >&2; exit 1; }

CURL_TLS=(--cacert "$CA" --resolve "${HOST}:443:${EDGE_LB_IP}")

mkdir -p "$REPORT_DIR"
PROBE_LOG="$(mktemp)"
trap 'rm -f "$PROBE_LOG"' EXIT

fail() { echo "FAIL: $*" | tee -a "$PROBE_LOG" >&2; exit 1; }

jq_assert_no_forbidden() {
  local label="$1" json="$2"
  if echo "$json" | jq -e '.. | strings | test("landlord|tenant|booking|housing|RP|record\\.local"; "i")' >/dev/null 2>&1; then
    fail "$label contains forbidden RP/housing terms"
  fi
  if echo "$json" | jq -e 'has("landlord_id") or has("landlordId")' >/dev/null 2>&1; then
    fail "$label contains landlord_id"
  fi
}

login() {
  local email="$1"
  curl -sS "${CURL_TLS[@]}" -X POST "${API_BASE}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"${email}\",\"password\":\"${PASSWORD}\"}" \
    | jq -r '.token // empty'
}

echo "== TLS verify health =="
HEALTH_META=""
for path in /api/healthz /api/readyz /api/health /healthz; do
  HEALTH_META="$(curl -sS "${CURL_TLS[@]}" -o /dev/null -w 'path='"$path"' code=%{http_code} ssl=%{ssl_verify_result}' "${API_BASE}${path}" || true)"
  echo "$HEALTH_META" | tee -a "$PROBE_LOG"
  echo "$HEALTH_META" | grep -q 'ssl=0' || fail "TLS verification failed on $path (expected ssl=0)"
  code="$(echo "$HEALTH_META" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
  [[ "$code" =~ ^(200|204|401)$ ]] && break
done
code="$(echo "$HEALTH_META" | sed -n 's/.*code=\([0-9]*\).*/\1/p')"
[[ "$code" =~ ^(200|204|401)$ ]] || fail "health check failed: $HEALTH_META"

BUYER_TOKEN="$(login "${BUYER_EMAIL}")"
SELLER_TOKEN="$(login "${SELLER_EMAIL}")"
[[ -n "${BUYER_TOKEN}" && -n "${SELLER_TOKEN}" ]] || fail "login failed"

SELLER_ID="$(curl -sS "${CURL_TLS[@]}" "${API_BASE}/api/auth/me" -H "Authorization: Bearer ${SELLER_TOKEN}" \
  | jq -r '.id // .user_id // .sub // empty')"
[[ -n "${SELLER_ID}" ]] || fail "seller id missing"

echo "== DB schema: listings.price_cents vs price =="
_run_listings_psql() {
  local sql="$1"
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${PGHOST:-127.0.0.1}" -p "${LISTINGS_PGPORT:-5435}" -U "${PGUSER:-postgres}" -d listings -At -c "$sql" 2>/dev/null
  else
    docker run --rm -e PGPASSWORD="${PGPASSWORD:-postgres}" postgres:16-alpine \
      psql -h host.docker.internal -p "${LISTINGS_PGPORT:-5435}" -U "${PGUSER:-postgres}" -d listings -At -c "$sql" 2>/dev/null
  fi
}
SCHEMA_COLS="$(_run_listings_psql "select column_name from information_schema.columns where table_schema='listings' and table_name='listings' and column_name in ('price','price_cents') order by column_name;" || true)"
SCHEMA_JSON="$(printf '%s\n' "$SCHEMA_COLS" | jq -R -s -c 'split("\n") | map(select(length>0))')"
echo "columns: $SCHEMA_JSON" | tee -a "$PROBE_LOG"
echo "$SCHEMA_JSON" | jq -e 'index("price_cents") != null' >/dev/null || fail "price_cents column missing"
echo "$SCHEMA_JSON" | jq -e 'index("price") == null' >/dev/null || fail "legacy price column still present"

echo "== Probe 1: direct thread (recipient_id only) =="
P1_BODY="$(curl -sS "${CURL_TLS[@]}" -X POST "${API_BASE}/api/messages/start" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -w '\n%{http_code}' \
  -d "{\"recipient_id\":\"${SELLER_ID}\"}")"
P1_CODE="$(echo "$P1_BODY" | tail -n1)"
P1_JSON="$(echo "$P1_BODY" | sed '$d')"
echo "$P1_JSON" | jq . | tee -a "$PROBE_LOG"
[[ "$P1_CODE" =~ ^20 ]] || fail "probe 1 HTTP $P1_CODE"
jq_assert_no_forbidden "probe1" "$P1_JSON"
echo "$P1_JSON" | jq -e '.thread_id and .recipient_id' >/dev/null || fail "probe 1 missing thread_id/recipient_id"
echo "$P1_JSON" | jq -e --arg sid "$SELLER_ID" '.recipient_id == $sid' >/dev/null || fail "probe 1 recipient mismatch"
THREAD_DIRECT="$(echo "$P1_JSON" | jq -r '.thread_id')"

echo "== Probe 2: create listing for seller =="
LISTING_JSON="$(curl -sS "${CURL_TLS[@]}" -X POST "${API_BASE}/api/listings/create" \
  -H "Authorization: Bearer ${SELLER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Probe listing","description":"messaging probe","price_cents":1999,"effective_from":"2026-05-01","effective_until":"2027-05-01","format":"LP","media_condition":"VG+","sleeve_condition":"VG","pricing_mode":"fixed","initial_status":"active","images":["https://picsum.photos/seed/rp-probe/400/400"],"domestic_shipping_cents":500,"international_shipping_cents":1500,"shipping_service":"Media Mail","package_type":"LP mailer","domestic_shipping":true,"international_shipping":true,"local_pickup":false,"combined_shipping":true,"city":"Brooklyn","state_or_province":"NY","country":"US"}')"
LISTING_ID="$(echo "$LISTING_JSON" | jq -r '.id // .listing_id // empty')"
[[ -n "${LISTING_ID}" ]] || fail "listing create failed: $LISTING_JSON"

echo "== Probe 2: listing contact without message =="
P2_BODY="$(curl -sS "${CURL_TLS[@]}" -w '\n%{http_code}' -X POST "${API_BASE}/api/messages/start" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"listing_id\":\"${LISTING_ID}\"}")"
P2_CODE="$(echo "$P2_BODY" | tail -n1)"
P2_JSON="$(echo "$P2_BODY" | sed '$d')"
echo "$P2_JSON" | jq . | tee -a "$PROBE_LOG"
[[ "$P2_CODE" =~ ^20 ]] || fail "probe 2 HTTP $P2_CODE"
jq_assert_no_forbidden "probe2" "$P2_JSON"
echo "$P2_JSON" | jq -e '.seller_id and .recipient_id and .listing_id' >/dev/null || fail "probe 2 missing seller_id/recipient_id/listing_id"
echo "$P2_JSON" | jq -e --arg sid "$SELLER_ID" '.seller_id == $sid' >/dev/null || fail "probe 2 seller_id mismatch"
echo "$P2_JSON" | jq -e '.listing.price_cents != null and (.listing.price_cents | type) == "number"' >/dev/null || fail "probe 2 listing.price_cents null"
echo "$P2_JSON" | jq -e '.listing.pricing_mode == "fixed"' >/dev/null || fail "probe 2 pricing_mode wrong"
echo "$P2_JSON" | jq -e '.listing.title == "Probe listing"' >/dev/null || fail "probe 2 listing title wrong"
THREAD_LISTING="$(echo "$P2_JSON" | jq -r '.thread_id')"

echo "== Probe 3: listing contact with initial_message =="
PROBE_MSG="probe msg $(date +%s)"
P3_BODY="$(curl -sS "${CURL_TLS[@]}" -w '\n%{http_code}' -X POST "${API_BASE}/api/messages/start" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"listing_id\":\"${LISTING_ID}\",\"initial_message\":\"${PROBE_MSG}\"}")"
P3_CODE="$(echo "$P3_BODY" | tail -n1)"
P3_JSON="$(echo "$P3_BODY" | sed '$d')"
echo "$P3_JSON" | jq . | tee -a "$PROBE_LOG"
[[ "$P3_CODE" =~ ^20 ]] || fail "probe 3 HTTP $P3_CODE"
jq_assert_no_forbidden "probe3" "$P3_JSON"
MSG_ID="$(echo "$P3_JSON" | jq -r '.message_id // .message.id // empty')"
[[ -n "${MSG_ID}" ]] || fail "probe 3 missing message_id"

echo "== Probe 4: buyer conversations =="
P4_JSON="$(curl -sS "${CURL_TLS[@]}" "${API_BASE}/api/messages/threads" -H "Authorization: Bearer ${BUYER_TOKEN}")"
echo "$P4_JSON" | jq '.threads[:3]' | tee -a "$PROBE_LOG"
jq_assert_no_forbidden "probe4-buyer-threads" "$P4_JSON"
BUYER_THREAD="$(echo "$P4_JSON" | jq -r --arg lid "$LISTING_ID" '.threads[] | select(.listingId == $lid) | .participantDisplay' | head -1)"
[[ -n "$BUYER_THREAD" ]] || fail "buyer thread missing listing row"
echo "$BUYER_THREAD" | grep -qiE 'seller-contract|Seller Contract' || fail "buyer should see seller display"
LIST_CTX="$(echo "$P4_JSON" | jq -r --arg lid "$LISTING_ID" '.threads[] | select(.listingId == $lid) | .listingContextTitle' | head -1)"
[[ "$LIST_CTX" == "Probe listing" ]] || fail "buyer listingContextTitle wrong: $LIST_CTX"
echo "$P4_JSON" | jq -e --arg lid "$LISTING_ID" '
  .threads[] | select(.listingId == $lid) | (.listingTitle // null) as $lt |
  ($lt == null or $lt == "Probe listing")
' >/dev/null || fail "buyer listingTitle participant-name mismatch"

echo "== Probe 5: seller conversations =="
P5_JSON="$(curl -sS "${CURL_TLS[@]}" "${API_BASE}/api/messages/threads" -H "Authorization: Bearer ${SELLER_TOKEN}")"
echo "$P5_JSON" | jq '.threads[:3]' | tee -a "$PROBE_LOG"
jq_assert_no_forbidden "probe5-seller-threads" "$P5_JSON"
echo "$P5_JSON" | grep -q "${PROBE_MSG}" || fail "seller missing message preview"
SELLER_THREAD="$(echo "$P5_JSON" | jq -r --arg msg "$PROBE_MSG" '.threads[] | select(.lastMessagePreview | contains($msg)) | .participantDisplay' | head -1)"
[[ -n "$SELLER_THREAD" ]] || fail "seller thread row missing"
echo "$SELLER_THREAD" | grep -qiE 'buyer-contract|Buyer Contract' || fail "seller should see buyer display"

{
  echo "# Messages start probe (strict TLS)"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "API_BASE: $API_BASE"
  echo "EDGE_LB_IP: $EDGE_LB_IP"
  echo "CA: $CA"
  echo "TLS: verified (ssl=0, no -k)"
  echo ""
  echo "## Schema"
  echo '```json'
  echo "$SCHEMA_JSON"
  echo '```'
  echo ""
  echo "## Samples"
  echo "### Direct start"
  echo '```json'
  echo "$P1_JSON" | jq .
  echo '```'
  echo "### Listing start"
  echo '```json'
  echo "$P2_JSON" | jq .
  echo '```'
  echo "### Buyer thread"
  echo '```json'
  echo "$P4_JSON" | jq --arg lid "$LISTING_ID" '.threads[] | select(.listingId == $lid)'
  echo '```'
  echo "### Seller thread"
  echo '```json'
  echo "$P5_JSON" | jq --arg msg "$PROBE_MSG" '.threads[] | select(.lastMessagePreview | contains($msg))'
  echo '```'
  echo ""
  echo "**PASS** — no landlord_id; price_cents present; TLS verified."
} >"$REPORT"

echo "All messaging start probes passed. Report: $REPORT"
