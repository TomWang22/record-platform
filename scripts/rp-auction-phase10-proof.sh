#!/usr/bin/env bash
# Phase 10 auction API/cart/notification proof — writes bench_logs/auction-phase10-proof.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT="${REPORT:-$REPO_ROOT/bench_logs/auction-phase10-proof.md}"
BASE="${E2E_API_BASE:-https://record-platform.test}"
PASS="${RP_COMB_PASS:-ContractPass123!}"

mkdir -p "$(dirname "$REPORT")"

say() { printf '%s\n' "$*"; }

login() {
  local email="$1"
  curl -sk "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
}

api() {
  local method="$1" url="$2" token="$3" data="${4:-}"
  if [[ -n "$data" ]]; then
    curl -sk -X "$method" "$BASE$url" \
      -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
      -d "$data"
  else
    curl -sk -X "$method" "$BASE$url" \
      -H "Authorization: Bearer $token" -H 'X-RP-E2E-Contract: 1'
  fi
}

SELLER_TOKEN="$(login seller-contract@record-platform.local)"
BUYER_A="$(login buyer-contract@record-platform.local)"
BUYER_B="$(login bidder2-contract@record-platform.local)"
BUYER_C="$(login bidder3-contract@record-platform.local)"

TS="$(date -u +%Y%m%d%H%M%S)"
ENDS_AT="$(python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
CREATE_BODY="$(api POST /api/listings/create "$SELLER_TOKEN" "{\"title\":\"Proof Auction $TS\",\"description\":\"Phase 10 proof\",\"price_cents\":2500,\"effective_from\":\"2026-05-01\",\"effective_until\":\"2027-05-01\",\"format\":\"LP\",\"media_condition\":\"VG+\",\"sleeve_condition\":\"VG\",\"pricing_mode\":\"fixed\",\"initial_status\":\"active\",\"images\":[\"https://picsum.photos/seed/rp-proof/400/400\"],\"domestic_shipping_cents\":500,\"international_shipping_cents\":1200,\"shipping_service\":\"USPS Media Mail\",\"package_type\":\"record_mail\",\"domestic_shipping\":true,\"international_shipping\":false,\"local_pickup\":false,\"combined_shipping\":true,\"shipping_notes\":\"\",\"city\":\"Portland\",\"state_or_province\":\"OR\",\"country\":\"US\"}")"
LISTING_ID="$(printf '%s' "$CREATE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d.get('listing_id') or '')")"
[[ -n "$LISTING_ID" ]] || { say "create failed: $CREATE_BODY"; exit 1; }

PATCH_BODY="$(ENDS_AT="$ENDS_AT" python3 -c 'import json,os; ends=os.environ["ENDS_AT"]; print(json.dumps({"pricing_mode":"auction","amenities":["sale_type:auction","starting_bid_cents:1500","bid_increment_cents:100","reserve_price_cents:1800","auction_ends_at:"+ends]}))')"
PATCH_RESP="$(api PATCH "/api/listings/$LISTING_ID" "$SELLER_TOKEN" "$PATCH_BODY")"
if ! printf '%s' "$PATCH_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" >/dev/null 2>&1; then
  say "auction patch failed: $PATCH_RESP"
  exit 1
fi

STATE_BEFORE="$(api GET "/api/listings/$LISTING_ID/auction/state" "$BUYER_A")"
if ! printf '%s' "$STATE_BEFORE" | python3 -c "import sys,json; d=json.load(sys.stdin); raise SystemExit(0 if d.get('auctionEnabled') else 1)" 2>/dev/null; then
  say "auction state not ready after patch: $STATE_BEFORE"
  exit 1
fi
BID_A="$(api POST "/api/listings/$LISTING_ID/auction/bids" "$BUYER_A" '{"useProxy":true,"maxBidCents":5000}')"
BID_B="$(api POST "/api/listings/$LISTING_ID/auction/bids" "$BUYER_B" '{"useProxy":true,"maxBidCents":3500}')"
BID_C="$(api POST "/api/listings/$LISTING_ID/auction/bids" "$BUYER_C" '{"useProxy":true,"maxBidCents":6000}')"
HISTORY="$(api GET "/api/listings/$LISTING_ID/auction/bids" "$BUYER_A")"
CLOSE="$(api POST "/api/listings/$LISTING_ID/auction/close?force=1" "$SELLER_TOKEN" '{"force":true}')"
WINNER_CART="$(api GET /api/cart "$BUYER_C")"
LOSER_CART="$(api GET /api/cart "$BUYER_A")"
SELLER_NOTIFS="$(api GET '/api/notifications?limit=20' "$SELLER_TOKEN")"
WINNER_NOTIFS="$(api GET '/api/notifications?limit=20' "$BUYER_C")"
LOSER_NOTIFS="$(api GET '/api/notifications?limit=20' "$BUYER_A")"

OUTBOX_AUCTION="$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings -tAc \
  "SELECT type, published FROM listings.outbox_events WHERE type LIKE 'Auction%' OR type='BidPlaced' ORDER BY created_at DESC LIMIT 12" 2>/dev/null || echo 'n/a')"

{
  say "# Phase 10 auction proof"
  say ""
  say "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  say "Listing: \`$LISTING_ID\`"
  say ""
  say "## Auction state before bid"
  say '```json'
  say "$STATE_BEFORE" | python3 -m json.tool 2>/dev/null || say "$STATE_BEFORE"
  say '```'
  say ""
  say "## Bidder A proxy max \$50"
  say '```json'
  say "$BID_A" | python3 -m json.tool 2>/dev/null || say "$BID_A"
  say '```'
  say ""
  say "## Bidder B proxy max \$35"
  say '```json'
  say "$BID_B" | python3 -m json.tool 2>/dev/null || say "$BID_B"
  say '```'
  say ""
  say "## Bidder C proxy max \$60 (wins)"
  say '```json'
  say "$BID_C" | python3 -m json.tool 2>/dev/null || say "$BID_C"
  say '```'
  say ""
  say "## Bid history (manual + proxy_auto)"
  say '```json'
  say "$HISTORY" | python3 -m json.tool 2>/dev/null || say "$HISTORY"
  say '```'
  say ""
  say "## Close auction"
  say '```json'
  say "$CLOSE" | python3 -m json.tool 2>/dev/null || say "$CLOSE"
  say '```'
  say ""
  say "## Winner cart (bidder C)"
  say '```json'
  say "$WINNER_CART" | python3 -m json.tool 2>/dev/null || say "$WINNER_CART"
  say '```'
  say ""
  say "## Loser cart (bidder A) — expect no auction_win row"
  say '```json'
  say "$LOSER_CART" | python3 -m json.tool 2>/dev/null || say "$LOSER_CART"
  say '```'
  say ""
  say "## Seller notifications (sample)"
  say '```json'
  say "$SELLER_NOTIFS" | python3 -m json.tool 2>/dev/null | head -80 || say "$SELLER_NOTIFS"
  say '```'
  say ""
  say "## Winner notifications (sample)"
  say '```json'
  say "$WINNER_NOTIFS" | python3 -m json.tool 2>/dev/null | head -80 || say "$WINNER_NOTIFS"
  say '```'
  say ""
  say "## Loser notifications (sample)"
  say '```json'
  say "$LOSER_NOTIFS" | python3 -m json.tool 2>/dev/null | head -80 || say "$LOSER_NOTIFS"
  say '```'
  say ""
  say "## Outbox rows (listings DB)"
  say '```'
  say "$OUTBOX_AUCTION"
  say '```'
} >"$REPORT"

say "Wrote $REPORT"
