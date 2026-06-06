#!/usr/bin/env bash
# Trace buyer message → messaging DB → Kafka MessageSent → notification row → seller /api/notifications.
# Documents both direct Kafka produce (HTTP path) and optional mesh push fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/event-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/message-notification-event-chain.md}"
REPORT_JSON="${REPORT_JSON:-$REPORT_DIR/message-notification-event-chain.json}"

CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "${RP_PUBLIC_ORIGIN:-https://record-platform.test}")"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${RP_SELLER_EMAIL:-seller-contract@record-platform.local}"
NS="${K8S_NAMESPACE:-record-platform}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
MESSAGING_TOPIC="${MESSAGING_EVENTS_TOPIC:-messaging.events.v1}"
KAFKA_GROUP="${NOTIFICATION_KAFKA_GROUP:-notification-service-group}"

mkdir -p "$REPORT_DIR"
FAIL=0
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
info() { echo "ℹ️  $*"; }

LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
CURL_EDGE=()
[[ -n "$LB_IP" ]] && CURL_EDGE=(--resolve "${HOST}:443:${LB_IP}")

login_token() {
  local email="$1"
  curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true
}

jq_step() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1:], indent=2))' "$@"
}

echo "=== Message notification event chain audit ==="

STEPS=()
CHAIN_STATUS="pass"
MSG_BODY="event-chain-$(date +%s)"
MESSAGE_ID=""
THREAD_ID=""
EVENT_ID=""
SELLER_USER_ID=""

buyer_t="$(login_token "$BUYER_EMAIL")"
seller_t="$(login_token "$SELLER_EMAIL")"
if [[ -z "$buyer_t" || -z "$seller_t" ]]; then
  fail "contract buyer/seller login failed (edge down?)"
  CHAIN_STATUS="fail"
else
  pass "buyer and seller auth tokens obtained"
  STEPS+=("{\"step\":\"auth\",\"status\":\"pass\"}")
fi

if [[ -n "$seller_t" ]]; then
  seller_profile="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/auth/me" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
  SELLER_USER_ID="$(printf '%s' "$seller_profile" | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("user") or d; print(str(u.get("sub") or u.get("id") or u.get("user_id") or "").strip())' 2>/dev/null || true)"
  if [[ -z "$SELLER_USER_ID" ]]; then
    search_json="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/listings/search?limit=1" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
    SELLER_USER_ID="$(printf '%s' "$search_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); i=(d.get("items") or [{}])[0]; print(str(i.get("seller_id") or "").strip())' 2>/dev/null || true)"
  fi
  if [[ -n "$SELLER_USER_ID" ]]; then
    pass "seller user id resolved: $SELLER_USER_ID"
    STEPS+=("{\"step\":\"seller_id\",\"status\":\"pass\",\"seller_id\":\"$SELLER_USER_ID\"}")
  else
    fail "could not resolve seller user id"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"seller_id\",\"status\":\"fail\"}")
  fi
fi

if [[ -n "$buyer_t" && -n "$SELLER_USER_ID" ]]; then
  send_tmp="$(mktemp)"
  send_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/messages/send" \
    -H "Authorization: Bearer $buyer_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"recipient_id\":\"$SELLER_USER_ID\",\"message_type\":\"DirectMessage\",\"content\":\"$MSG_BODY\"}" \
    -o "$send_tmp" -w '%{http_code}' 2>/dev/null || echo 000)"
  send_json="$(cat "$send_tmp" 2>/dev/null || echo '{}')"
  rm -f "$send_tmp"
  if [[ "$send_code" == "201" ]]; then
    pass "POST /api/messages/send → 201"
    MESSAGE_ID="$(printf '%s' "$send_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d.get("message") or d; print(str(m.get("id") or d.get("id") or "").strip())' 2>/dev/null || true)"
    THREAD_ID="$(printf '%s' "$send_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d.get("message") or d; print(str(m.get("thread_id") or d.get("thread_id") or "").strip())' 2>/dev/null || true)"
    STEPS+=("{\"step\":\"api_send\",\"status\":\"pass\",\"http\":201,\"message_id\":\"$MESSAGE_ID\",\"thread_id\":\"$THREAD_ID\",\"body\":\"$MSG_BODY\"}")
  else
    fail "POST /api/messages/send → HTTP $send_code"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"api_send\",\"status\":\"fail\",\"http\":$send_code}")
  fi
fi

# --- DB: messaging.messages ---
if [[ -n "$MESSAGE_ID" ]] && command -v psql >/dev/null 2>&1; then
  msg_row="$(psql -h "$PGHOST" -p 5434 -U "$PGUSER" -d messaging -At -F '|' -c \
    "SELECT id::text, sender_id::text, recipient_id::text, left(content,80), created_at::text FROM messages.messages WHERE id = '$MESSAGE_ID'::uuid LIMIT 1" 2>/dev/null || true)"
  if [[ -n "$msg_row" ]]; then
    pass "messaging.messages row exists ($MESSAGE_ID)"
    STEPS+=("{\"step\":\"db_message\",\"status\":\"pass\",\"row\":\"${msg_row//\"/\\\"}\"}")
  else
    fail "messaging.messages row missing for $MESSAGE_ID"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"db_message\",\"status\":\"fail\"}")
  fi
else
  info "DB message row check skipped (no message id or psql)"
  STEPS+=("{\"step\":\"db_message\",\"status\":\"skip\"}")
fi

# HTTP path uses direct Kafka (not outbox) — note in report
info "HTTP send path: direct produce to $MESSAGING_TOPIC (see messaging-service kafkaMessagingEvents.ts)"
STEPS+=("{\"step\":\"kafka_produce_mode\",\"status\":\"info\",\"mode\":\"direct_kafka_not_outbox_on_http\"}")

# Optional outbox rows (gRPC path may still write)
if command -v psql >/dev/null 2>&1; then
  ob_count="$(psql -h "$PGHOST" -p 5434 -U "$PGUSER" -d messaging -At -c \
    "SELECT COUNT(*) FROM messaging.outbox_events WHERE created_at > NOW() - INTERVAL '15 minutes'" 2>/dev/null || echo "")"
  STEPS+=("{\"step\":\"messaging_outbox_recent\",\"count\":\"${ob_count:-skip}\"}")
fi

# Mesh push secret (fallback)
mesh_secret_set="false"
if kubectl -n "$NS" exec deploy/messaging-service -- printenv BOOKING_LISTINGS_INTERNAL_SECRET 2>/dev/null | grep -q .; then
  mesh_secret_set="true"
  pass "BOOKING_LISTINGS_INTERNAL_SECRET set in messaging-service"
else
  info "BOOKING_LISTINGS_INTERNAL_SECRET unset — pushMessageReceivedNotification HTTP fallback disabled"
fi
STEPS+=("{\"step\":\"mesh_push_secret\",\"configured\":$mesh_secret_set}")

sleep "${CHAIN_SETTLE_SEC:-8}"

# --- notification DB ---
if [[ -n "$SELLER_USER_ID" ]] && command -v psql >/dev/null 2>&1; then
  notif_row="$(psql -h "$PGHOST" -p 5441 -U "$PGUSER" -d notification -At -F '|' -c \
    "SELECT id::text, event_type, read_at IS NULL AS unread, left(payload::text,120), created_at::text
     FROM notification.notifications
     WHERE user_id = '$SELLER_USER_ID'::uuid
       AND created_at > NOW() - INTERVAL '15 minutes'
       AND (payload::text ILIKE '%$MSG_BODY%' OR event_type ILIKE '%message%')
     ORDER BY created_at DESC LIMIT 1" 2>/dev/null || true)"
  if [[ -n "$notif_row" ]]; then
    pass "notification.notifications row for seller (recent message)"
    STEPS+=("{\"step\":\"db_notification\",\"status\":\"pass\",\"row\":\"${notif_row//\"/\\\"}\"}")
  else
    fail "no recent notification.notifications row for seller"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"db_notification\",\"status\":\"fail\"}")
  fi
fi

# --- /api/notifications ---
if [[ -n "$seller_t" ]]; then
  notif_api="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/notifications" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
  unread_n="$(printf '%s' "$notif_api" | python3 -c '
import json,sys
d=json.load(sys.stdin)
items=d.get("items") or []
body=sys.argv[1]
n=0
for i in items:
  if i.get("read_at"): continue
  t=json.dumps(i).lower()
  if "message" in t or body.lower()[:20] in t:
    n+=1
print(n)
' "$MSG_BODY" 2>/dev/null || echo 0)"
  if [[ "${unread_n:-0}" -ge 1 ]]; then
    pass "seller /api/notifications has unread message notification"
    STEPS+=("{\"step\":\"api_notifications\",\"status\":\"pass\",\"unread_matching\":$unread_n}")
  else
    fail "seller /api/notifications missing unread message for probe"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"api_notifications\",\"status\":\"fail\",\"unread_matching\":0}")
  fi
fi

# --- consumer log hint ---
if command -v kubectl >/dev/null 2>&1; then
  cons_log="$(kubectl -n "$NS" logs deploy/notification-service --since=10m 2>/dev/null | grep -iE 'MessageSent|message_received|kafka.messaging' | tail -3 || true)"
  if [[ -n "$cons_log" ]]; then
    pass "notification-service log shows MessageSent handling"
    STEPS+=("{\"step\":\"consumer_log\",\"status\":\"pass\"}")
  else
    info "no recent MessageSent lines in notification-service logs (may still be OK if DB row exists)"
    STEPS+=("{\"step\":\"consumer_log\",\"status\":\"inconclusive\"}")
  fi
  sub_line="$(kubectl -n "$NS" logs deploy/notification-service --since=48h 2>/dev/null | grep 'subscribed:' | tail -1 || true)"
  STEPS+=("{\"step\":\"consumer_subscribe\",\"line\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${sub_line:-}")}")
fi

# --- read-all persistence ---
if [[ -n "$seller_t" ]]; then
  ra_code="$(curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/notifications/read-all" \
    -H "Authorization: Bearer $seller_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{}' -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
  sleep 2
  unread_after="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/notifications" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for i in (d.get("items") or []) if not i.get("read_at")))' 2>/dev/null || echo -1)"
  if [[ "$ra_code" == "200" || "$ra_code" == "204" ]] && [[ "${unread_after:-1}" == "0" ]]; then
    pass "read-all persisted (unread=0 after POST)"
    STEPS+=("{\"step\":\"read_all\",\"status\":\"pass\"}")
  else
    fail "read-all failed (http=$ra_code unread_after=$unread_after)"
    CHAIN_STATUS="fail"
    STEPS+=("{\"step\":\"read_all\",\"status\":\"fail\",\"http\":$ra_code,\"unread_after\":$unread_after}")
  fi
fi

{
  echo "# Message notification event chain"
  echo ""
  echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Overall: **$CHAIN_STATUS**"
  echo "- Probe body: \`$MSG_BODY\`"
  echo "- Seller: \`$SELLER_USER_ID\`"
  echo "- Message id: \`$MESSAGE_ID\`"
  echo "- Topic: \`$MESSAGING_TOPIC\`"
  echo "- Consumer group: \`$KAFKA_GROUP\`"
  echo ""
  echo "## Chain"
  echo ""
  echo "1. Buyer \`POST /api/messages/send\` → messaging-service persists \`messages.messages\`"
  echo "2. messaging-service \`sendMessagingEvent\` → Kafka \`$MESSAGING_TOPIC\` (event_type MessageSent)"
  echo "3. Optional: \`pushMessageReceivedNotification\` → notification \`/internal/push-notification\` when mesh secret set"
  echo "4. notification-service consumer → \`notification.notifications\` + realtime"
  echo "5. Seller \`GET /api/notifications\` unread + UI bell"
  echo "6. \`POST /api/notifications/read-all\` persists read state"
  echo ""
  echo "## Steps (JSON)"
  echo ""
  echo '```json'
  printf '%s\n' "${STEPS[@]}" | python3 -c 'import json,sys; print(json.dumps([json.loads(l) for l in sys.stdin if l.strip()], indent=2))'
  echo '```'
} >"$REPORT_MD"

STEPS_JSON_FILE="$(mktemp)"
printf '%s\n' "${STEPS[@]}" >"$STEPS_JSON_FILE"
python3 - "$STEPS_JSON_FILE" "$REPORT_JSON" "$CHAIN_STATUS" "$MSG_BODY" "$MESSAGE_ID" "$SELLER_USER_ID" "$MESSAGING_TOPIC" "$mesh_secret_set" <<'PY'
import json, sys
steps_path, out_path, status, body, msg_id, seller_id, topic, mesh = sys.argv[1:9]
steps = []
with open(steps_path) as f:
    for line in f:
        line = line.strip()
        if line:
            steps.append(json.loads(line))
with open(out_path, "w") as out:
    json.dump(
        {
            "status": status,
            "message_body": body,
            "message_id": msg_id,
            "seller_user_id": seller_id,
            "topic": topic,
            "mesh_push_secret_configured": mesh == "true",
            "steps": steps,
        },
        out,
        indent=2,
    )
PY
rm -f "$STEPS_JSON_FILE"

echo ""
echo "Report: $REPORT_MD"
echo "JSON:   $REPORT_JSON"

if [[ "$CHAIN_STATUS" != "pass" ]]; then
  exit 1
fi
pass "message notification event chain complete"
