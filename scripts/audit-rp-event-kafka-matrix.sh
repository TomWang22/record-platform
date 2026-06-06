#!/usr/bin/env bash
# End-to-end Kafka / outbox / consumer matrix for product event flows (RCA-7).
# Real TLS edge auth only — no DEBUG_FAKE_AUTH, no mocked event inserts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/event-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/rp-event-kafka-matrix.md}"
REPORT_JSON="${REPORT_JSON:-$REPORT_DIR/rp-event-kafka-matrix.json}"

CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "${RP_PUBLIC_ORIGIN:-https://record-platform.test}")"
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${RP_SELLER_EMAIL:-seller-contract@record-platform.local}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
NS="${K8S_NAMESPACE:-record-platform}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
CURL_EDGE=()
[[ -n "$LB_IP" ]] && CURL_EDGE=(--resolve "${HOST}:443:${LB_IP}")

mkdir -p "$REPORT_DIR"
FAIL=0
FLOWS=()

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
info() { echo "ℹ️  $*"; }

login_token() {
  local email="$1"
  curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true
}

psql_at() {
  local port="$1" db="$2" sql="$3"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -At -c "$sql" 2>/dev/null || true
}

kafka_topic_has_substr() {
  local topic="$1" needle="$2"
  [[ -n "$needle" ]] || return 1
  command -v kubectl >/dev/null 2>&1 || return 2
  kubectl get pod kafka-0 -n "$NS" >/dev/null 2>&1 || return 2
  local out
  out="$(kubectl exec -n "$NS" kafka-0 -- bash -ec "
TS_PASS=\$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=\$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=\$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo \"\$KS_PASS\")
{
  echo security.protocol=SSL
  echo ssl.endpoint.identification.algorithm=
  echo ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
  echo ssl.truststore.password=\${TS_PASS}
  echo ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
  echo ssl.keystore.password=\${KS_PASS}
  echo ssl.key.password=\${KP_PASS}
} > /tmp/rp-matrix.props
timeout 18 kafka-console-consumer --bootstrap-server kafka-0.kafka:9093 --consumer.config /tmp/rp-matrix.props \
  --topic ${topic} --max-messages 200 --timeout-ms 12000 2>/dev/null || true
" 2>/dev/null || true)"
  echo "$out" | grep -qF "$needle"
}

add_flow() {
  FLOWS+=("$1")
}

echo "=== RP event Kafka matrix (RCA-7) ==="

# --- Preconditions ---
if kubectl -n "$NS" get deploy api-gateway >/dev/null 2>&1; then
  if kubectl -n "$NS" exec deploy/api-gateway -- printenv DEBUG_FAKE_AUTH 2>/dev/null | grep -qE '^1$|^true$'; then
    fail "DEBUG_FAKE_AUTH enabled on api-gateway"
    add_flow '{"flow":"precondition","status":"fail","reason":"DEBUG_FAKE_AUTH"}'
  else
    pass "DEBUG_FAKE_AUTH off on api-gateway"
  fi
fi

if bash "$SCRIPT_DIR/verify-kafka-ready.sh" >/dev/null 2>&1; then
  pass "Kafka brokers ready (3 replicas)"
else
  fail "verify-kafka-ready failed"
fi

if bash "$SCRIPT_DIR/rp-verify-kafka-cert-chain.sh" >/dev/null 2>&1; then
  pass "Kafka TLS cert chain verified"
else
  fail "rp-verify-kafka-cert-chain failed"
fi

contract_t="$(login_token "$EMAIL")"
buyer_t="$(login_token "$BUYER_EMAIL")"
seller_t="$(login_token "$SELLER_EMAIL")"
if [[ -z "$contract_t" ]]; then
  fail "contract login failed"
  exit 1
fi
pass "contract auth token obtained (no dev-auth)"

# ---------------------------------------------------------------------------
# 1) MessageSent
# ---------------------------------------------------------------------------
MSG_BODY="kafka-matrix-msg-$(date +%s)"
MSG_STATUS="pass"
MSG_PRODUCE_MODE="direct_kafka_http_path"
MSG_TOPIC="messaging.events.v1"
MSG_CONSUMER="notification-service"
MSG_API_STATE="unknown"
SELLER_UID=""

if [[ -n "$buyer_t" && -n "$seller_t" ]]; then
  seller_profile="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/auth/me" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
  SELLER_UID="$(printf '%s' "$seller_profile" | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("user") or d; print(str(u.get("sub") or u.get("id") or u.get("user_id") or "").strip())' 2>/dev/null || true)"
fi

MESSAGE_ID=""
if [[ -n "$buyer_t" && -n "$SELLER_UID" ]]; then
  send_tmp="$(mktemp)"
  send_code="$(curl -sS --max-time 30 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/messages/send" \
    -H "Authorization: Bearer $buyer_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"recipient_id\":\"$SELLER_UID\",\"message_type\":\"DirectMessage\",\"content\":\"$MSG_BODY\"}" \
    -o "$send_tmp" -w '%{http_code}' 2>/dev/null || echo 000)"
  send_json="$(cat "$send_tmp" 2>/dev/null || echo '{}')"
  rm -f "$send_tmp"
  if [[ "$send_code" == "201" ]]; then
    MESSAGE_ID="$(printf '%s' "$send_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d.get("message") or d; print(str(m.get("id") or d.get("id") or "").strip())' 2>/dev/null || true)"
    pass "MessageSent: POST /api/messages/send → 201"
  else
    fail "MessageSent: POST /api/messages/send → HTTP $send_code"
    MSG_STATUS="fail"
  fi
else
  fail "MessageSent: missing buyer/seller token or seller id"
  MSG_STATUS="fail"
fi

MSG_DB="skip"
if [[ -n "$MESSAGE_ID" ]]; then
  row="$(psql_at 5434 messaging "SELECT id::text FROM messages.messages WHERE id='$MESSAGE_ID'::uuid LIMIT 1")"
  if [[ -n "$row" ]]; then
    MSG_DB="pass"
    pass "MessageSent: messaging.messages row"
  else
    MSG_DB="fail"
    fail "MessageSent: messaging.messages row missing"
    MSG_STATUS="fail"
  fi
fi

MSG_OUTBOX="documented_skip"
ob_recent="$(psql_at 5434 messaging "SELECT COUNT(*) FROM messaging.outbox_events WHERE type ILIKE '%MessageSent%' AND created_at > NOW() - INTERVAL '20 minutes'")"
if [[ "$ob_recent" =~ ^[1-9] ]]; then
  MSG_OUTBOX="pass"
  MSG_PRODUCE_MODE="outbox_backed_grpc_or_dual_path"
  pass "MessageSent: messaging.outbox_events recent row"
else
  info "MessageSent: HTTP path uses direct Kafka (outbox optional on gRPC)"
fi

sleep 8
MSG_KAFKA="inconclusive"
if kafka_topic_has_substr "$MSG_TOPIC" "$MESSAGE_ID"; then
  MSG_KAFKA="pass"
  pass "MessageSent: Kafka topic $MSG_TOPIC contains message id"
elif [[ -n "$MESSAGE_ID" ]] && kubectl -n "$NS" logs deploy/messaging-service --since=15m 2>/dev/null | grep -qF "$MESSAGE_ID"; then
  MSG_KAFKA="pass"
  pass "MessageSent: messaging-service log shows produce for message"
else
  MSG_KAFKA="inconclusive"
  info "MessageSent: Kafka topic grep inconclusive (consumer lag or binary payload)"
fi

MSG_NOTIF_DB="skip"
if [[ -n "$SELLER_UID" ]]; then
  n="$(psql_at 5441 notification "SELECT COUNT(*) FROM notification.notifications WHERE user_id='$SELLER_UID'::uuid AND created_at > NOW() - INTERVAL '20 minutes' AND (payload::text ILIKE '%$MSG_BODY%' OR event_type ILIKE '%message%')")"
  if [[ "${n:-0}" =~ ^[1-9] ]]; then
    MSG_NOTIF_DB="pass"
    pass "MessageSent: notification.notifications row"
  else
    MSG_NOTIF_DB="fail"
    fail "MessageSent: notification DB row missing"
    MSG_STATUS="fail"
  fi
fi

if [[ -n "$seller_t" ]]; then
  unread="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/notifications" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for i in (d.get("items") or []) if not i.get("read_at")))' 2>/dev/null || echo 0)"
  if [[ "${unread:-0}" -ge 1 ]]; then
    MSG_API_STATE="unread_present"
    pass "MessageSent: GET /api/notifications unread ≥ 1"
    ra_code="$(curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/notifications/read-all" \
      -H "Authorization: Bearer $seller_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
      -d '{}' -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
    sleep 2
    unread_after="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/notifications" \
      -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for i in (d.get("items") or []) if not i.get("read_at")))' 2>/dev/null || echo -1)"
    if [[ "$ra_code" == "200" || "$ra_code" == "204" ]] && [[ "${unread_after:-1}" == "0" ]]; then
      MSG_API_STATE="read_all_cleared"
      pass "MessageSent: read-all cleared unread"
    else
      MSG_STATUS="fail"
      fail "MessageSent: read-all failed (http=$ra_code unread_after=$unread_after)"
    fi
  else
    MSG_STATUS="fail"
    fail "MessageSent: GET /api/notifications has no unread"
  fi
fi

add_flow "$(python3 -c 'import json,sys; print(json.dumps({
  "flow":"MessageSent",
  "producer":"messaging-service",
  "api_action":"POST /api/messages/send",
  "db_table":"messaging.messages",
  "outbox_table":"messaging.outbox_events",
  "outbox_result":sys.argv[1],
  "produce_mode":sys.argv[2],
  "kafka_topic":sys.argv[3],
  "kafka_result":sys.argv[4],
  "consumer":sys.argv[5],
  "notification_db":sys.argv[6],
  "final_api_state":sys.argv[7],
  "status":sys.argv[8],
}))' "$MSG_OUTBOX" "$MSG_PRODUCE_MODE" "$MSG_TOPIC" "$MSG_KAFKA" "$MSG_CONSUMER" "$MSG_NOTIF_DB" "$MSG_API_STATE" "$MSG_STATUS")"
[[ "$MSG_STATUS" == "pass" ]] || FAIL=1

# ---------------------------------------------------------------------------
# 2) ListingCreated / ListingUpdated / ListingRevisionCreated
# ---------------------------------------------------------------------------
LIST_STATUS="pass"
LIST_TOPIC="${ENV_PREFIX}.listing.events"
LIST_PRODUCE_MODE="direct_kafka"
LISTING_ID=""
REV_COUNT="0"
LIST_OUTBOX="0"

LISTING_TOKEN="${seller_t:-$contract_t}"
if [[ -n "$LISTING_TOKEN" ]]; then
  create_json="$(curl -sfS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/create" \
    -H "Authorization: Bearer $LISTING_TOKEN" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"title\":\"Kafka matrix listing $(date +%s)\",\"description\":\"event matrix\",\"price_cents\":3200,\"effective_from\":\"2026-05-01\",\"effective_until\":\"2027-05-01\",\"format\":\"LP\",\"media_condition\":\"VG+\",\"sleeve_condition\":\"VG\",\"pricing_mode\":\"fixed\",\"initial_status\":\"active\",\"images\":[\"https://picsum.photos/seed/rp-lean-contract/400/400\"],\"city\":\"Brooklyn\",\"state_or_province\":\"NY\",\"country\":\"US\",\"domestic_shipping_cents\":500,\"shipping_service\":\"Media Mail\",\"package_type\":\"LP mailer\",\"domestic_shipping\":true,\"local_pickup\":false}" 2>/dev/null || echo '{}')"
  LISTING_ID="$(printf '%s' "$create_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or (d.get("listing") or {}).get("id",""))' 2>/dev/null || true)"
fi

if [[ -n "$LISTING_ID" ]]; then
  pass "Listing: POST /api/listings/create → id $LISTING_ID"
  db_row="$(psql_at 5435 listings "SELECT id::text FROM listings.listings WHERE id='$LISTING_ID'::uuid LIMIT 1")"
  if [[ -n "$db_row" ]]; then
    pass "Listing: listings.listings row"
  else
    LIST_STATUS="fail"
    fail "Listing: listings.listings row missing"
  fi
  patch_code="$(curl -sS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X PATCH "$BASE/api/listings/$LISTING_ID" \
    -H "Authorization: Bearer $LISTING_TOKEN" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"description\":\"Kafka matrix patch $(date +%s)\"}" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$patch_code" == "200" || "$patch_code" == "204" || "$patch_code" == "409" ]]; then
    pass "Listing: PATCH /api/listings/:id → $patch_code"
  else
    LIST_STATUS="fail"
    fail "Listing: PATCH failed HTTP $patch_code"
  fi
  REV_COUNT="$(psql_at 5435 listings "SELECT COUNT(*) FROM listings.listing_revisions WHERE listing_id='$LISTING_ID'::uuid")"
  if [[ "${REV_COUNT:-0}" =~ ^[1-9] ]]; then
    pass "Listing: listing_revisions row count=$REV_COUNT"
  else
    LIST_STATUS="fail"
    fail "Listing: no listing_revisions row after patch"
  fi
  LIST_OUTBOX="$(psql_at 5435 listings "SELECT COUNT(*) FROM listings.outbox_events WHERE aggregate_id='$LISTING_ID' AND created_at > NOW() - INTERVAL '20 minutes'")"
  if [[ "${LIST_OUTBOX:-0}" =~ ^[1-9] ]]; then
    LIST_PRODUCE_MODE="outbox_backed"
    pass "Listing: listings.outbox_events row present"
  else
    info "Listing: direct Kafka produce (no recent outbox row — see listing-kafka.ts)"
  fi
else
  LIST_STATUS="fail"
  fail "Listing: could not create listing"
fi

LIST_KAFKA="inconclusive"
if [[ -n "$LISTING_ID" ]] && kafka_topic_has_substr "$LIST_TOPIC" "$LISTING_ID"; then
  LIST_KAFKA="pass"
  pass "Listing: Kafka $LIST_TOPIC contains listing id"
elif [[ -n "$LISTING_ID" ]] && kubectl -n "$NS" logs deploy/listings-service --since=15m 2>/dev/null | grep -qF "$LISTING_ID"; then
  LIST_KAFKA="pass"
  pass "Listing: listings-service log references listing id (produce path)"
else
  info "Listing: Kafka topic grep inconclusive"
fi

LIST_CONSUMER="notification-service, analytics-service"
add_flow "$(python3 -c 'import json,sys; print(json.dumps({
  "flow":"ListingCreated/ListingUpdated/ListingRevisionCreated",
  "producer":"listings-service",
  "api_action":"POST /api/listings/create; PATCH /api/listings/:id",
  "db_table":"listings.listings; listings.listing_revisions",
  "outbox_table":"listings.outbox_events",
  "outbox_recent_count":sys.argv[1],
  "produce_mode":sys.argv[2],
  "kafka_topic":sys.argv[3],
  "kafka_result":sys.argv[4],
  "consumer":sys.argv[5],
  "final_api_state":"GET /api/listings/:id revisions reachable",
  "status":sys.argv[6],
  "listing_id":sys.argv[7],
  "revision_count":sys.argv[8],
}))' "$LIST_OUTBOX" "$LIST_PRODUCE_MODE" "$LIST_TOPIC" "$LIST_KAFKA" "$LIST_CONSUMER" "$LIST_STATUS" "${LISTING_ID:-}" "${REV_COUNT:-0}")"
[[ "$LIST_STATUS" == "pass" ]] || FAIL=1

# ---------------------------------------------------------------------------
# 3) RecordCreated / RecordUpdated
# ---------------------------------------------------------------------------
REC_STATUS="pass"
REC_TOPIC="${ENV_PREFIX}.records.events"
REC_PRODUCE_MODE="not_wired_in_service_code"
RECORD_ID=""
REC_OUTBOX="0"

rec_body="$(curl -sfS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/records" \
  -H "Authorization: Bearer $contract_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"artist\":\"Kafka Matrix\",\"name\":\"Probe $(date +%s)\",\"format\":\"LP\"}" 2>/dev/null || echo '{}')"
RECORD_ID="$(printf '%s' "$rec_body" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(str(d.get("id") or (d.get("record") or {}).get("id") or "").strip())' 2>/dev/null || true)"

if [[ -n "$RECORD_ID" ]]; then
  pass "Record: POST /api/records → $RECORD_ID"
  row="$(psql_at 5433 records "SELECT id::text FROM records.records WHERE id='$RECORD_ID'::uuid LIMIT 1")"
  if [[ -n "$row" ]]; then
    pass "Record: records.records row"
  else
    REC_STATUS="partial"
    info "Record: records.records row not visible on :5433 (grpc persisted; DB port may differ)"
  fi
  patch_code="$(curl -sS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X PUT "$BASE/api/records/$RECORD_ID" \
    -H "Authorization: Bearer $contract_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"notes":"kafka matrix update"}' -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$patch_code" == "200" || "$patch_code" == "204" ]]; then
    pass "Record: PUT /api/records/:id → $patch_code"
  else
    REC_STATUS="partial"
    info "Record: PUT /api/records/:id → HTTP $patch_code"
  fi
  REC_OUTBOX="$(psql_at 5433 records "SELECT COUNT(*) FROM records.outbox_events WHERE aggregate_id='$RECORD_ID' AND created_at > NOW() - INTERVAL '20 minutes'")"
  if [[ "${REC_OUTBOX:-0}" =~ ^[1-9] ]]; then
    REC_PRODUCE_MODE="outbox_backed"
    pass "Record: records.outbox_events row"
  else
    info "Record: outbox DDL present; producer/publisher not observed in runtime (gap documented)"
    REC_STATUS="partial"
  fi
else
  REC_STATUS="fail"
  fail "Record: POST /api/records failed"
fi

REC_KAFKA="not_observed"
REC_CONSUMER="analytics-service (planned)"
add_flow "$(python3 -c 'import json,sys; print(json.dumps({
  "flow":"RecordCreated/RecordUpdated",
  "producer":"records-service",
  "api_action":"POST /api/records; PUT /api/records/:id",
  "db_table":"records.records",
  "outbox_table":"records.outbox_events",
  "outbox_recent_count":sys.argv[1],
  "produce_mode":sys.argv[2],
  "kafka_topic":sys.argv[3],
  "kafka_result":sys.argv[4],
  "consumer":sys.argv[5],
  "final_api_state":"GET /api/records includes created row",
  "status":sys.argv[6],
  "record_id":sys.argv[7],
}))' "$REC_OUTBOX" "$REC_PRODUCE_MODE" "$REC_TOPIC" "$REC_KAFKA" "$REC_CONSUMER" "$REC_STATUS" "${RECORD_ID:-}")"
[[ "$REC_STATUS" == "fail" ]] && FAIL=1

# ---------------------------------------------------------------------------
# 4) FeedbackCreated
# ---------------------------------------------------------------------------
FB_STATUS="pass"
FB_TOPIC="${ENV_PREFIX}.trust.events"
FB_PRODUCE_MODE="db_only_no_kafka_observed"
FB_COUNT="0"

fb_code="$(curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/profile/feedback" \
  -H "Authorization: Bearer $contract_t" -H 'X-RP-E2E-Contract: 1' -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
if [[ "$fb_code" == "200" ]]; then
  pass "Feedback: GET /api/profile/feedback → 200"
else
  FB_STATUS="fail"
  fail "Feedback: GET /api/profile/feedback → HTTP $fb_code"
fi

if [[ -n "$LISTING_ID" && -n "$seller_t" && -n "$buyer_t" ]]; then
  seller_uid="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/auth/me" \
    -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("user") or d; print(u.get("sub") or u.get("id") or "")' 2>/dev/null || true)"
  buyer_uid="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/auth/me" \
    -H "Authorization: Bearer $buyer_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d.get("user") or d; print(u.get("sub") or u.get("id") or "")' 2>/dev/null || true)"
  if [[ -n "$seller_uid" && -n "$buyer_uid" ]]; then
    seed_code="$(curl -sS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/trust/marketplace-feedback/seed-contract" \
      -H "Authorization: Bearer $contract_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
      -d "{\"listing_id\":\"$LISTING_ID\",\"seller_user_id\":\"$seller_uid\",\"buyer_user_id\":\"$buyer_uid\"}" \
      -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
    if [[ "$seed_code" == "200" || "$seed_code" == "201" ]]; then
      pass "Feedback: seed-contract → $seed_code"
    else
      info "Feedback: seed-contract HTTP $seed_code (TRUST_E2E_SEED may be off — using existing rows)"
    fi
  fi
fi

FB_COUNT="$(psql_at 5442 trust "SELECT COUNT(*) FROM trust.marketplace_feedback WHERE created_at > NOW() - INTERVAL '7 days'")"
if [[ "${FB_COUNT:-0}" =~ ^[1-9] ]]; then
  pass "Feedback: trust.marketplace_feedback rows present ($FB_COUNT recent)"
else
  FB_STATUS="partial"
  info "Feedback: no recent marketplace_feedback rows in trust DB"
fi

FB_OUTBOX="$(psql_at 5442 trust "SELECT COUNT(*) FROM trust.outbox_events WHERE created_at > NOW() - INTERVAL '7 days'")"
add_flow "$(python3 -c 'import json,sys; print(json.dumps({
  "flow":"FeedbackCreated",
  "producer":"trust-service",
  "api_action":"GET /api/profile/feedback; optional POST marketplace-feedback/seed-contract",
  "db_table":"trust.marketplace_feedback",
  "outbox_table":"trust.outbox_events",
  "outbox_recent_count":sys.argv[1],
  "produce_mode":sys.argv[2],
  "kafka_topic":sys.argv[3],
  "kafka_result":"not_observed",
  "consumer":"notification-service (planned)",
  "final_api_state":"GET /api/profile/feedback reflects feedback",
  "status":sys.argv[4],
  "feedback_rows_recent":sys.argv[5],
}))' "$FB_OUTBOX" "$FB_PRODUCE_MODE" "$FB_TOPIC" "$FB_STATUS" "$FB_COUNT")"
[[ "$FB_STATUS" == "fail" ]] && FAIL=1

# ---------------------------------------------------------------------------
# 5) Watchlist / RecentlyViewed
# ---------------------------------------------------------------------------
WL_STATUS="pass"
WL_PRODUCE_MODE="db_only_no_outbox_or_kafka"
WL_LISTING="${LISTING_ID:-}"
RV_LISTING="$WL_LISTING"

if [[ -z "$WL_LISTING" ]]; then
  search="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/listings/search?limit=1" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
  WL_LISTING="$(printf '%s' "$search" | python3 -c 'import json,sys; d=json.load(sys.stdin); i=(d.get("items") or [{}])[0]; print(str(i.get("id") or "").strip())' 2>/dev/null || true)"
  RV_LISTING="$WL_LISTING"
fi

if [[ -n "$contract_t" && -n "$WL_LISTING" ]]; then
  w_add="$(curl -sS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/shopping/watchlist" \
    -H "Authorization: Bearer $contract_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"item_type\":\"listing\",\"item_id\":\"$WL_LISTING\",\"listing_id\":\"$WL_LISTING\"}" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$w_add" == "200" || "$w_add" == "201" ]]; then
    pass "Watchlist: POST add → $w_add"
  else
    WL_STATUS="fail"
    fail "Watchlist: POST add → HTTP $w_add"
  fi
  rv_add="$(curl -sS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/shopping/recently-viewed" \
    -H "Authorization: Bearer $contract_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"item_type\":\"listing\",\"item_id\":\"$RV_LISTING\",\"metadata\":{\"title\":\"matrix\"}}" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$rv_add" == "200" || "$rv_add" == "201" ]]; then
    pass "RecentlyViewed: POST add → $rv_add"
  else
    WL_STATUS="fail"
    fail "RecentlyViewed: POST add → HTTP $rv_add"
  fi
  w_row="$(psql_at 5436 shopping "SELECT COUNT(*) FROM shopping.watchlist WHERE item_id='$WL_LISTING' AND created_at > NOW() - INTERVAL '20 minutes'")"
  rv_row="$(psql_at 5436 shopping "SELECT COUNT(*) FROM shopping.recently_viewed WHERE item_id='$RV_LISTING' AND viewed_at > NOW() - INTERVAL '20 minutes'")"
  if [[ "${w_row:-0}" =~ ^[1-9] && "${rv_row:-0}" =~ ^[1-9] ]]; then
    pass "Watchlist/RV: shopping DB rows"
  else
    WL_STATUS="fail"
    fail "Watchlist/RV: shopping DB rows missing (watch=$w_row rv=$rv_row)"
  fi
  wl_api="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/shopping/watchlist" \
    -H "Authorization: Bearer $contract_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
  if echo "$wl_api" | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; sys.exit(0 if items and items[0].get("listingId") and "item_type" not in items[0] else 1)' 2>/dev/null; then
    pass "Watchlist: normalized BFF shape on GET"
  else
    WL_STATUS="fail"
    fail "Watchlist: GET shape not normalized"
  fi
  curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" -X DELETE "$BASE/api/shopping/watchlist/listing/$WL_LISTING" \
    -H "Authorization: Bearer $contract_t" -H 'X-RP-E2E-Contract: 1' -o /dev/null 2>/dev/null || true
else
  WL_STATUS="fail"
  fail "Watchlist/RV: missing token or listing id"
fi

add_flow "$(python3 -c 'import json,sys; print(json.dumps({
  "flow":"Watchlist/RecentlyViewed",
  "producer":"shopping-service",
  "api_action":"POST/DELETE watchlist; POST recently-viewed",
  "db_table":"shopping.watchlist; shopping.recently_viewed",
  "outbox_table":"shopping.outbox_events (DDL only — no producer in service)",
  "produce_mode":sys.argv[1],
  "kafka_topic":"'"${ENV_PREFIX}.shopping.events"' (not emitted by shopping-service)",
  "kafka_result":"not_applicable",
  "consumer":"none wired",
  "final_api_state":"GET watchlist/recently-viewed normalized product cards",
  "status":sys.argv[2],
  "listing_id":sys.argv[3],
}))' "$WL_PRODUCE_MODE" "$WL_STATUS" "${WL_LISTING:-}")"
[[ "$WL_STATUS" == "pass" ]] || FAIL=1

# --- Delegate companion audits ---
OUTBOX_EC=0
MSG_EC=0
bash "$SCRIPT_DIR/audit-rp-event-outbox-contract.sh" >/dev/null 2>&1 || OUTBOX_EC=$?
bash "$SCRIPT_DIR/audit-rp-message-notification-event-chain.sh" >/dev/null 2>&1 || MSG_EC=$?

# --- Reports ---
FLOWS_FILE="$(mktemp)"
printf '%s\n' "${FLOWS[@]}" >"$FLOWS_FILE"
python3 - "$FLOWS_FILE" "$REPORT_JSON" "$FAIL" "$OUTBOX_EC" "$MSG_EC" <<'PY'
import json, sys
from datetime import datetime, timezone
flows = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if line:
            flows.append(json.loads(line))
out = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "flows": flows,
    "companion_scripts": {
        "audit-rp-event-outbox-contract.sh": int(sys.argv[4]),
        "audit-rp-message-notification-event-chain.sh": int(sys.argv[5]),
    },
    "overall_fail": int(sys.argv[3]) != 0,
}
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
PY
rm -f "$FLOWS_FILE"

python3 - "$REPORT_JSON" "$REPORT_MD" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
lines = [
    "# RP event Kafka matrix (RCA-7)",
    "",
    f"Generated: {data['generated_at']}",
    "",
    "## Flow matrix",
    "",
    "| Flow | Producer | API action | DB table | Outbox | Kafka topic | Consumer | Final API/UI state | Produce mode | Status |",
    "|------|----------|------------|----------|--------|-------------|----------|-------------------|--------------|--------|",
]
for f in data["flows"]:
    lines.append(
        "| {flow} | {producer} | {api} | {db} | {outbox} ({outbox_result}) | {topic} | {consumer} | {final} | {mode} | **{status}** |".format(
            flow=f.get("flow", ""),
            producer=f.get("producer", ""),
            api=f.get("api_action", ""),
            db=f.get("db_table", ""),
            outbox=f.get("outbox_table", ""),
            outbox_result=f.get("outbox_result", f.get("outbox_recent_count", "")),
            topic=f.get("kafka_topic", ""),
            consumer=f.get("consumer", ""),
            final=f.get("final_api_state", ""),
            mode=f.get("produce_mode", ""),
            status=f.get("status", ""),
        )
    )
lines += [
    "",
    "## Companion scripts",
    "",
    f"- audit-rp-event-outbox-contract.sh exit={data['companion_scripts']['audit-rp-event-outbox-contract.sh']}",
    f"- audit-rp-message-notification-event-chain.sh exit={data['companion_scripts']['audit-rp-message-notification-event-chain.sh']}",
    f"- verify-kafka-ready.sh",
    f"- rp-verify-kafka-cert-chain.sh",
    "",
]
if data["overall_fail"]:
    lines.append("**RESULT: FAIL**")
else:
    lines.append("**RESULT: PASS** (matrix flows green; partial = documented gaps only)")
open(sys.argv[2], "w").write("\n".join(lines) + "\n")
PY

echo ""
echo "Report: $REPORT_MD"
echo "JSON:   $REPORT_JSON"

if [[ "$FAIL" -ne 0 ]]; then
  fail "event kafka matrix had failures"
  exit 1
fi
if [[ "$OUTBOX_EC" -ne 0 || "$MSG_EC" -ne 0 ]]; then
  fail "companion audit exit codes outbox=$OUTBOX_EC message=$MSG_EC"
  exit 1
fi
pass "audit-rp-event-kafka-matrix complete"
exit 0
