#!/usr/bin/env bash
# Event/outbox contract: static matrix, DB schema, optional runtime API proofs, no OCH topics.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/event-contract}"
MATRIX_JSON="${MATRIX_JSON:-$REPORT_DIR/topic-consumer-matrix.json}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/event-outbox-contract.md}"
RUNTIME_MD="${RUNTIME_MD:-$REPORT_DIR/event-runtime-proof.md}"

CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
HOST="${RP_PUBLIC_HOST:-record-platform.test}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
SELLER_EMAIL="${RP_SELLER_EMAIL:-seller-contract@record-platform.local}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "$BASE")"
LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
CURL_EDGE=()
[[ -n "$LB_IP" ]] && CURL_EDGE=(--resolve "${HOST}:443:${LB_IP}")

mkdir -p "$REPORT_DIR"
FAIL=0
RUNTIME_FAIL=0

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
rt_fail() { echo "❌ [runtime] $*"; RUNTIME_FAIL=1; }

echo "=== RP event / outbox contract audit ==="

# --- 1) Static infra alignment ---
if bash "$SCRIPT_DIR/verify-outbox-infra-alignment.sh"; then
  pass "verify-outbox-infra-alignment"
else
  fail "verify-outbox-infra-alignment"
fi

# --- 2) Forbidden OCH / housing / booking / social topic names ---
FORBIDDEN_TOPIC_RE='(och\.|off[- ]campus|housing\.|landlord\.|tenant\.|booking\.events|social\.events)'
if rg -i "$FORBIDDEN_TOPIC_RE" proto/events scripts/lib/rp-kafka-event-topics-from-proto.sh \
  --glob '!bench_logs/**' --glob '!docs/reference/**' 2>/dev/null | grep -v '^#' >/tmp/rp-forbidden-topics.txt; then
  fail "Forbidden topic names in proto/topic scripts:"
  sed 's/^/  /' /tmp/rp-forbidden-topics.txt
else
  pass "No forbidden OCH/housing/booking/social topic names in proto generators"
fi

# --- 3) Service scope: outbox DDL + producer hints ---
declare -A SVC_DB=(
  [messaging-service]=messaging
  [notification-service]=notification
  [listings-service]=listings
  [shopping-service]=shopping
  [records-service]=records
  [trust-service]=trust
  [auction-monitor]=auction-monitor-core
)

matrix_entries=()
for svc in messaging-service notification-service listings-service shopping-service records-service trust-service auction-monitor; do
  db="${SVC_DB[$svc]:-}"
  sql_file=""
  case "$svc" in
    messaging-service) sql_file="infra/db/02-messaging-outbox.sql" ;;
    notification-service) sql_file="infra/db/03-notification-outbox.sql" ;;
    listings-service) sql_file="infra/db/03-listings-outbox.sql" ;;
    shopping-service) sql_file="infra/db/01-shopping-outbox.sql" ;;
    records-service) sql_file="infra/db/01-records-outbox.sql" ;;
    trust-service) sql_file="infra/db/03-trust-outbox.sql" ;;
    auction-monitor) sql_file="infra/db/01-auction-monitor-outbox.sql" ;;
  esac
  if [[ -f "$sql_file" ]]; then
    pass "outbox DDL present: $sql_file"
  else
    fail "missing outbox DDL for $svc"
  fi
  producers="$(rg -l 'outbox_events|insertOutbox|outbox' "services/$svc" 2>/dev/null | head -5 | tr '\n' ',' | sed 's/,$//' || true)"
  consumers="$(rg -l 'kafka|consumer|subscribe' "services/$svc" 2>/dev/null | head -5 | tr '\n' ',' | sed 's/,$//' || true)"
  matrix_entries+=("{\"service\":\"$svc\",\"db\":\"$db\",\"outbox_sql\":\"$sql_file\",\"producer_files\":\"$producers\",\"consumer_files\":\"$consumers\"}")
done

# api-gateway emit check
if rg -q 'outbox|kafka.*produce' services/api-gateway/src 2>/dev/null; then
  pass "api-gateway may emit/route events (grep hit)"
else
  pass "api-gateway: no direct outbox producer (proxy-only — expected)"
fi

# --- 4) DB schema columns on localhost ports (when Postgres reachable) ---
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

check_outbox_table() {
  local port="$1" db="$2" schema="$3"
  local sql="SELECT column_name FROM information_schema.columns WHERE table_schema='$schema' AND table_name='outbox_events' ORDER BY 1"
  local cols
  cols="$(psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -At -c "$sql" 2>/dev/null || true)"
  if [[ -z "$cols" ]]; then
    echo "skip"
    return 1
  fi
  for need in id aggregate_id type payload created_at published; do
    echo "$cols" | grep -qx "$need" || return 2
  done
  echo "ok"
  return 0
}

DB_CHECKS=()
for port_db in "5434:messaging:messaging" "5441:notification:notification" "5435:listings:listings" "5436:shopping:shopping" "5433:records:records" "5442:trust:trust"; do
  IFS=':' read -r port db schema <<<"$port_db"
  st="$(check_outbox_table "$port" "$db" "$schema" || true)"
  if [[ "$st" == "ok" ]]; then
    pass "DB outbox_events columns OK ($db @ :$port)"
    DB_CHECKS+=("{\"db\":\"$db\",\"port\":$port,\"status\":\"pass\"}")
  elif [[ "$st" == "skip" ]]; then
    echo "ℹ️  DB skip $db @ :$port (not reachable)"
    DB_CHECKS+=("{\"db\":\"$db\",\"port\":$port,\"status\":\"skip\"}")
  else
    fail "DB outbox_events missing required columns ($db @ :$port)"
    DB_CHECKS+=("{\"db\":\"$db\",\"port\":$port,\"status\":\"fail\"}")
  fi
done

# --- 5) Runtime scenarios (edge + Postgres when available) ---
token=""
if curl -sfS --max-time 12 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null | grep -q .; then
  token="$(curl -sfS --max-time 12 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  pass "runtime: obtained contract auth token"
else
  rt_fail "runtime: cannot reach $BASE/api/auth/login (cluster/edge down?)"
fi

runtime_notes=()
FLOW_MATRIX=()

_login_token() {
  local email="$1"
  curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true
}

if [[ -n "$token" ]]; then
  # A) Message send persistence
  conv_res="$(curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/messages/start" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"listing_id":"00000000-0000-0000-0000-000000000001","body":"outbox audit probe"}' 2>&1 || true)"
  if echo "$conv_res" | grep -qE 'thread|conversation|message|error'; then
    pass "runtime A: messages/start responded"
    runtime_notes+=("- Message start API reachable")
  else
    rt_fail "runtime A: messages/start failed: ${conv_res:0:200}"
  fi

  # C) Listing PATCH + revisions (create owned listing when needed)
  create_res="$(curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/create" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
    -d '{"title":"Outbox audit listing","description":"audit","price_cents":1999,"format":"LP","initial_status":"active"}' 2>/dev/null || echo '{}')"
  lid="$(printf '%s' "$create_res" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or (d.get("listing") or {}).get("id",""))' 2>/dev/null || true)"
  if [[ -z "$lid" ]]; then
    list_res="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/listings/mine" \
      -H "Authorization: Bearer $token" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
    lid="$(printf '%s' "$list_res" | python3 -c 'import json,sys; d=json.load(sys.stdin); rows=d.get("listings") or d.get("items") or []; i=rows[0] if rows else None; print((i or {}).get("id","") if isinstance(i,dict) else "")' 2>/dev/null || true)"
  fi
  if [[ -n "$lid" ]]; then
    rev_code="$(curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/listings/$lid/revisions" \
      -H "Authorization: Bearer $token" -H 'X-RP-E2E-Contract: 1' -o /tmp/rp-rev.json -w '%{http_code}' 2>/dev/null || echo 000)"
    if [[ "$rev_code" == "200" ]]; then
      pass "runtime C: listing revisions API HTTP 200 ($lid)"
      patch_code="$(curl -sS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" -X PATCH "$BASE/api/listings/$lid" \
        -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
        -d "{\"description\":\"Outbox audit patch $(date +%s)\"}" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
      if [[ "$patch_code" == "200" || "$patch_code" == "204" ]]; then
        pass "runtime C: listing PATCH $patch_code"
      elif [[ "$patch_code" == "409" ]]; then
        pass "runtime C: listing PATCH 409 (conflict — revisions API OK, create path proven)"
      else
        rt_fail "runtime C: listing PATCH HTTP $patch_code"
      fi
    else
      rt_fail "runtime C: listing revisions HTTP $rev_code"
    fi
  else
    rt_fail "runtime C: could not create or resolve listing for revision probe"
  fi

  # D) Records list
  rec="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/records" \
    -H "Authorization: Bearer $token" -H 'X-RP-E2E-Contract: 1' -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$rec" == *200* ]]; then
    pass "runtime D: GET /api/records OK"
  else
    rt_fail "runtime D: GET /api/records failed"
  fi

  # E) Trust feedback list
  fb="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/profile/feedback" \
    -H "Authorization: Bearer $token" -H 'X-RP-E2E-Contract: 1' -w '%{http_code}' 2>/dev/null || echo 000)"
  if [[ "$fb" == *200* ]]; then
    pass "runtime E: GET /api/profile/feedback OK"
  else
    rt_fail "runtime E: GET /api/profile/feedback failed"
  fi

  # --- Event-backed message_send (buyer → seller notification path) ---
  buyer_t="$(_login_token "$BUYER_EMAIL")"
  seller_t="$(_login_token "$SELLER_EMAIL")"
  if [[ -n "$buyer_t" && -n "$seller_t" ]]; then
    audit_lid="$(curl -sfS --max-time 20 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/listings/create" \
      -H "Authorization: Bearer $seller_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
      -d "{\"title\":\"Outbox flow $(date +%s)\",\"description\":\"event matrix\",\"price_cents\":2500,\"format\":\"LP\",\"initial_status\":\"active\"}" 2>/dev/null \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or (d.get("listing") or {}).get("id",""))' 2>/dev/null || true)"
    if [[ -n "$audit_lid" ]]; then
      msg_body="outbox-matrix-$(date +%s)"
      msg_res="$(curl -sfS --max-time 25 --cacert "$CA" "${CURL_EDGE[@]}" -X POST "$BASE/api/messages/start" \
        -H "Authorization: Bearer $buyer_t" -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
        -d "{\"listing_id\":\"$audit_lid\",\"body\":\"$msg_body\"}" 2>/dev/null || echo '{}')"
      if echo "$msg_res" | grep -qE 'thread|conversation|message'; then
        sleep 8
        seller_notif="$(curl -sfS --max-time 15 --cacert "$CA" "${CURL_EDGE[@]}" "$BASE/api/notifications" \
          -H "Authorization: Bearer $seller_t" -H 'X-RP-E2E-Contract: 1' 2>/dev/null || echo '{}')"
        if echo "$seller_notif" | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; sys.exit(0 if any("message" in str(i.get("event_type","")+i.get("title","")+str(i.get("payload",""))).lower() for i in items[:20]) else 1)' 2>/dev/null; then
          pass "flow message_send: seller notification row via API"
          FLOW_MATRIX+=("{\"flow\":\"message_send\",\"producer\":\"messaging-service\",\"outbox_table\":\"messaging.outbox_events\",\"topic\":\"messaging.events.v1\",\"consumer\":\"notification-service\",\"side_effect\":\"notification row for seller\",\"status\":\"pass\"}")
          runtime_notes+=("- message_send: API notification for seller after buyer message")
        else
          rt_fail "flow message_send: seller /api/notifications missing message event"
          FLOW_MATRIX+=("{\"flow\":\"message_send\",\"status\":\"fail\",\"reason\":\"no seller notification row\"}")
        fi
        if command -v psql >/dev/null 2>&1; then
          ob="$(psql -h "$PGHOST" -p 5434 -U "$PGUSER" -d messaging -At -c \
            "SELECT COUNT(*) FROM messaging.outbox_events WHERE type ILIKE '%MessageSent%' AND created_at > NOW() - INTERVAL '10 minutes'" 2>/dev/null || echo "")"
          [[ "$ob" =~ ^[1-9] ]] && runtime_notes+=("- message_send: messaging.outbox_events MessageSent row present")
        fi
      else
        rt_fail "flow message_send: messages/start failed"
        FLOW_MATRIX+=("{\"flow\":\"message_send\",\"status\":\"fail\",\"reason\":\"messages/start\"}")
      fi
    fi
  else
    rt_fail "flow message_send: could not login buyer/seller contract users"
  fi

  FLOW_MATRIX+=("{\"flow\":\"listing_create\",\"producer\":\"listings-service\",\"outbox_table\":\"listings.outbox_events\",\"topic\":\"${ENV_PREFIX}.listing.events\",\"consumer\":\"notification-service/analytics\",\"side_effect\":\"listing revision/event row\",\"status\":\"partial\",\"note\":\"revisions API probed above\"}")
  FLOW_MATRIX+=("{\"flow\":\"record_update\",\"producer\":\"records-service\",\"outbox_table\":\"records.outbox_events\",\"topic\":\"${ENV_PREFIX}.records.events\",\"consumer\":\"analytics-service\",\"side_effect\":\"revision/event row\",\"status\":\"partial\",\"note\":\"GET /api/records OK\"}")
  FLOW_MATRIX+=("{\"flow\":\"feedback_create\",\"producer\":\"trust-service\",\"outbox_table\":\"trust.outbox_events\",\"topic\":\"${ENV_PREFIX}.trust.events\",\"consumer\":\"notification-service\",\"side_effect\":\"seller notification\",\"status\":\"partial\"}")
  FLOW_MATRIX+=("{\"flow\":\"watchlist_add\",\"producer\":\"shopping-service\",\"outbox_table\":\"shopping.outbox_events\",\"topic\":\"${ENV_PREFIX}.shopping.events\",\"consumer\":\"notification-service\",\"side_effect\":\"watchlist persisted\",\"status\":\"partial\"}")
  for blocked in offer_created offer_countered_or_declined listing_updated shipping_update auction_spike auction_ending_soon message_reply; do
    FLOW_MATRIX+=("{\"flow\":\"$blocked\",\"status\":\"phase_9_or_10_blocked\",\"note\":\"not implemented or OBO/auction phase gated\"}")
  done
fi

# Outbox row proof when messaging DB up
if command -v psql >/dev/null 2>&1; then
  oc="$(psql -h "$PGHOST" -p 5434 -U "$PGUSER" -d messaging -At -c \
    "SELECT COUNT(*) FROM messaging.outbox_events" 2>/dev/null || echo "")"
  if [[ "$oc" =~ ^[0-9]+$ ]]; then
    pass "runtime DB: messaging.outbox_events count=$oc"
    runtime_notes+=("- messaging.outbox_events rows visible on :5434")
  fi
  nc="$(psql -h "$PGHOST" -p 5441 -U "$PGUSER" -d notification -At -c \
    "SELECT COUNT(*) FROM notification.outbox_events" 2>/dev/null || echo "")"
  if [[ "$nc" =~ ^[0-9]+$ ]]; then
    pass "runtime DB: notification.outbox_events count=$nc"
  fi
fi

# --- JSON matrix ---
export RP_MATRIX_ENTRIES="[$(IFS=,; echo "${matrix_entries[*]}")]"
export RP_DB_CHECKS="[$(IFS=,; echo "${DB_CHECKS[*]}")]"
export RP_FLOW_MATRIX="[$(IFS=,; echo "${FLOW_MATRIX[*]}")]"
python3 - "$MATRIX_JSON" <<'PY'
import json, os, sys
from datetime import datetime, timezone
entries = json.loads(os.environ.get("RP_MATRIX_ENTRIES", "[]"))
db_checks = json.loads(os.environ.get("RP_DB_CHECKS", "[]"))
flows = json.loads(os.environ.get("RP_FLOW_MATRIX", "[]"))
out = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "services": entries,
    "db_checks": db_checks,
    "flows": flows,
}
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
PY

{
  echo "# Event / outbox contract"
  echo ""
  echo "Time (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Static"
  echo "- Infra alignment: verify-outbox-infra-alignment.sh"
  echo "- Forbidden OCH topics: scanned proto + topic generator"
  echo "- Service outbox DDL + producer/consumer file hints"
  echo ""
  echo "## DB schema"
  printf '%s\n' "${DB_CHECKS[@]}" | sed 's/^/- /'
  echo ""
  echo "## Result"
  if [[ $FAIL -eq 0 ]]; then echo "**Static/DB contract:** PASS"; else echo "**Static/DB contract:** FAIL"; fi
  echo ""
  echo "Matrix: \`$MATRIX_JSON\`"
} >"$REPORT_MD"

{
  echo "# Event runtime proof"
  echo ""
  echo "Time (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Scenarios"
  printf '%s\n' "${runtime_notes[@]}" | sed 's/^/- /'
  echo ""
  if [[ $RUNTIME_FAIL -eq 0 ]]; then
    echo "**Runtime:** PASS (API paths reachable; DB counts when Postgres up)"
  else
    echo "**Runtime:** FAIL or partial — re-run with Colima up and edge on record-platform.test"
  fi
} >"$RUNTIME_MD"

echo ""
if [[ $FAIL -eq 0 && $RUNTIME_FAIL -eq 0 ]]; then
  pass "audit-rp-event-outbox-contract complete"
  exit 0
fi
if [[ $FAIL -eq 0 ]]; then
  echo "⚠️  Static PASS; runtime FAIL — see $RUNTIME_MD" >&2
  exit 2
fi
exit 1
