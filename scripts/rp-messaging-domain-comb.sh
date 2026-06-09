#!/usr/bin/env bash
# Runtime messaging domain comb — API JSON must not leak OCH/housing fields.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

API_BASE="${API_BASE:-${E2E_API_BASE:-https://record-platform.test}}"
API_BASE="${API_BASE%/}"
PASSWORD="${CONTRACT_PASSWORD:-ContractPass123!}"
BUYER_EMAIL="${BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${SELLER_EMAIL:-seller-contract@record-platform.local}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/messaging-contract}"
REPORT="${REPORT:-$REPORT_DIR/messaging-domain-comb.md}"
NS="${K8S_NAMESPACE:-record-platform}"

HOST="$(edge_hostname_from_https_url "$API_BASE")"
CA="$(rp_http3_ca_cert)"
EDGE_LB_IP="${EDGE_LB_IP:-$(rp_http3_lb_ip)}"
[[ -z "$EDGE_LB_IP" || ! "$EDGE_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && \
  EDGE_LB_IP="$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
[[ -n "$EDGE_LB_IP" && "$EDGE_LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "FAIL: EDGE_LB_IP missing" >&2; exit 1
}
CURL_TLS=(--cacert "$CA" --resolve "${HOST}:443:${EDGE_LB_IP}")

FORBIDDEN_RE='landlord|tenant|booking|housing|OCH|record\.local'
mkdir -p "$REPORT_DIR"
FAILS=()
SAMPLES=()

curl_json() {
  local method="$1" url="$2" token="${3:-}" body="${4:-}"
  local args=(-sS "${CURL_TLS[@]}" -X "$method" "$url" -H 'Content-Type: application/json')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

scan_json() {
  local label="$1" json="$2"
  SAMPLES+=("### $label\n\`\`\`json\n$(echo "$json" | jq -c . 2>/dev/null || echo "$json")\n\`\`\`")
  if echo "$json" | jq -e 'has("landlord_id") or has("landlordId")' >/dev/null 2>&1; then
    FAILS+=("$label: landlord_id key present")
  fi
  if echo "$json" | jq -r '.. | strings' 2>/dev/null | grep -qiE "$FORBIDDEN_RE"; then
    FAILS+=("$label: forbidden term in JSON strings")
  fi
  if echo "$json" | jq -r '
    .. | objects |
    select(has("participantDisplay") or has("listingContextTitle") or has("listingTitle")) |
    (.participantDisplay // ""), (.listingContextTitle // ""), (.listingTitle // "")
  ' 2>/dev/null | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
    FAILS+=("$label: UUID in display field")
  fi
}

login() {
  curl_json POST "${API_BASE}/api/auth/login" "" "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" \
    | jq -r '.token // empty'
}

BUYER_TOKEN="$(login "$BUYER_EMAIL")"
SELLER_TOKEN="$(login "$SELLER_EMAIL")"
[[ -n "$BUYER_TOKEN" && -n "$SELLER_TOKEN" ]] || { echo "login failed" >&2; exit 1; }

SELLER_ID="$(curl_json GET "${API_BASE}/api/auth/me" "$SELLER_TOKEN" | jq -r '.id // .user_id // .sub // empty')"
[[ -n "$SELLER_ID" ]] || { echo "seller id missing" >&2; exit 1; }

LISTING_JSON="$(curl_json POST "${API_BASE}/api/listings/create" "$SELLER_TOKEN" \
  '{"title":"Comb listing","description":"domain comb","price_cents":2499,"effective_from":"2026-05-01","effective_until":"2027-05-01","format":"LP","media_condition":"VG+","sleeve_condition":"VG","pricing_mode":"fixed","initial_status":"active","images":["https://picsum.photos/seed/rp-comb/400/400"],"domestic_shipping_cents":500,"international_shipping_cents":1500,"shipping_service":"Media Mail","package_type":"LP mailer","domestic_shipping":true,"international_shipping":true,"local_pickup":false,"combined_shipping":true,"city":"Brooklyn","state_or_province":"NY","country":"US"}')"
LISTING_ID="$(echo "$LISTING_JSON" | jq -r '.id // .listing_id // empty')"
[[ -n "$LISTING_ID" ]] || { echo "listing create failed: $LISTING_JSON" >&2; exit 1; }

R1="$(curl_json POST "${API_BASE}/api/messages/start" "$BUYER_TOKEN" "{\"recipient_id\":\"${SELLER_ID}\"}")"
scan_json "POST /messages/start direct" "$R1"

R2="$(curl_json POST "${API_BASE}/api/messages/start" "$BUYER_TOKEN" "{\"listing_id\":\"${LISTING_ID}\"}")"
scan_json "POST /messages/start listing only" "$R2"
echo "$R2" | jq -e '.listing.price_cents != null' >/dev/null || FAILS+=("listing only: price_cents null")
echo "$R2" | jq -e '.seller_id' >/dev/null || FAILS+=("listing only: seller_id missing")

R3="$(curl_json POST "${API_BASE}/api/messages/start" "$BUYER_TOKEN" "{\"listing_id\":\"${LISTING_ID}\",\"initial_message\":\"comb probe $(date +%s)\"}")"
scan_json "POST /messages/start listing+message" "$R3"

R4="$(curl_json GET "${API_BASE}/api/messages/threads" "$BUYER_TOKEN")"
scan_json "GET buyer threads" "$R4"

R5="$(curl_json GET "${API_BASE}/api/messages/threads" "$SELLER_TOKEN")"
scan_json "GET seller threads" "$R5"

THREAD_ID="$(echo "$R3" | jq -r '.thread_id // empty')"
if [[ -n "$THREAD_ID" ]]; then
  R6="$(curl_json GET "${API_BASE}/api/messages/thread/${THREAD_ID}" "$BUYER_TOKEN" 2>/dev/null || echo '{}')"
  if echo "$R6" | jq -e '.error' >/dev/null 2>&1; then
    SAMPLES+=("### GET thread detail\n_not available (${R6})_")
  else
    scan_json "GET thread detail" "$R6"
  fi
fi

{
  echo "# Messaging domain comb"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "API_BASE: $API_BASE (TLS verified via dev-chain.pem + --resolve)"
  echo ""
  if [[ ${#FAILS[@]} -eq 0 ]]; then
    echo "**PASS** — messaging API responses clean."
  else
    echo "**FAIL** — ${#FAILS[@]} issue(s):"
    for f in "${FAILS[@]}"; do echo "- $f"; done
  fi
  echo ""
  printf '%b\n' "${SAMPLES[@]}"
} >"$REPORT"

if [[ ${#FAILS[@]} -gt 0 ]]; then
  echo "Messaging domain comb FAILED — $REPORT" >&2
  exit 1
fi
echo "Messaging domain comb PASS — $REPORT"
