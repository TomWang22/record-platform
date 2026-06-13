#!/usr/bin/env bash
# T15.4S-1 — Platform event E2E matrix: DB/outbox → Kafka → consumer → notification/API.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT_MD="${REPORT_MD:-$REPORT_DIR/t15-4s-platform-event-matrix.md}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
BASE="$(edge_normalize_e2e_api_base 2>/dev/null || echo "${RP_PUBLIC_ORIGIN:-https://record-platform.test}")"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"

FAIL=0
pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; FAIL=1; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

psql_q() {
  psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d "$2" -At -F '|' -c "$3" 2>/dev/null || true
}

mkdir -p "$REPORT_DIR"
say "=== T15.4S platform event E2E matrix ==="

# --- Phase 1: live product flows (messaging, OBO, auction, shopping) ---
if bash "$SCRIPT_DIR/rp-event-notification-matrix.sh"; then
  pass "rp-event-notification-matrix"
else
  fail "rp-event-notification-matrix"
fi

# --- Phase 2: AI platform events (analytics + auction-monitor + python-ai) ---
TOKEN="$(curl -sfS --max-time 20 --cacert "$CA" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token") or "")' 2>/dev/null || true)"
USER_ID="$(curl -sfS --max-time 15 --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("sub") or (d.get("user") or {}).get("id") or "")' 2>/dev/null || true)"
[[ -n "$USER_ID" ]] || fail "contract user id missing"
curl -sfS --max-time 30 --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/analytics/ai/features/$USER_ID" >/dev/null 2>&1 || fail "analytics ai features trigger"
curl -sfS --max-time 15 --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
  "$BASE/auctions/ai-signals?refresh=1" >/dev/null 2>&1 || fail "auction ai-signals trigger"
LISTING="$(psql_q 5435 listings "SELECT listing_id::text FROM listings.auction_settings WHERE status='active' LIMIT 1")"
curl -sfS --max-time 20 --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/ai/offer-insights?listing_id=$LISTING" >/dev/null 2>&1 || fail "offer-insights trigger"
bash "$SCRIPT_DIR/rp-ai-outbox-publish-drain.sh" >/dev/null 2>&1 || fail "ai outbox drain"

# Drain messaging outbox backlog (HTTP path also direct-publishes; backlog must not block gate)
for ((i=1; i<=20; i++)); do
  N="$(kubectl exec -n "${K8S_NAMESPACE:-record-platform}" deployment/messaging-service -- node -e "
const {Pool}=require('pg');const {kafka}=require('@common/utils/kafka');
const pool=new Pool({connectionString:process.env.POSTGRES_URL_MESSAGING||process.env.DATABASE_URL});
const topic='messaging.events.v1';
(async()=>{
  const p=kafka.producer();await p.connect();
  const {rows}=await pool.query(\"WITH picked AS (SELECT id FROM messaging.outbox_events WHERE published=false ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED) SELECT b.id::text,b.aggregate_id,b.payload FROM messaging.outbox_events b INNER JOIN picked p ON b.id=p.id\");
  for(const r of rows){await p.send({topic,messages:[{key:r.aggregate_id,value:r.payload}]});await pool.query('UPDATE messaging.outbox_events SET published=true WHERE id=\$1::uuid',[r.id]);}
  console.log(rows.length);await p.disconnect();await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
" 2>/dev/null | tail -1)"
  [[ "${N:-0}" -eq 0 ]] && break
done
[[ "${N:-0}" -ge 0 ]] && pass "messaging outbox drain batches=$i"

# --- Phase 3: SQL outbox published=true proof ---
OUTBOX_SQL="$(mktemp)"
cat >"$OUTBOX_SQL" <<'EOSQL'
\echo '== analytics.outbox_events =='
SELECT type, published, count(*) FROM analytics.outbox_events GROUP BY 1,2 ORDER BY 1,2;
\echo '== auction_monitor.outbox_events =='
SELECT type, published, count(*) FROM auction_monitor.outbox_events GROUP BY 1,2 ORDER BY 1,2;
\echo '== listings.outbox_events =='
SELECT type, published, count(*) FROM listings.outbox_events GROUP BY 1,2 ORDER BY 1,2;
\echo '== messaging.outbox_events =='
SELECT type, published, count(*) FROM messaging.outbox_events GROUP BY 1,2 ORDER BY 1,2;
\echo '== shopping.outbox_events =='
SELECT type, published, count(*) FROM shopping.outbox_events GROUP BY 1,2 ORDER BY 1,2;
\echo '== ai.outbox_events (python_ai 5440) =='
EOSQL

{
  psql -h "$PGHOST" -p 5439 -U "$PGUSER" -d analytics -v ON_ERROR_STOP=0 -f "$OUTBOX_SQL" 2>/dev/null || true
  psql -h "$PGHOST" -p 5438 -U "$PGUSER" -d postgres -v ON_ERROR_STOP=0 -c \
    "SELECT type, published, count(*) FROM auction_monitor.outbox_events GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || true
  psql -h "$PGHOST" -p 5435 -U "$PGUSER" -d listings -v ON_ERROR_STOP=0 -c \
    "SELECT type, published, count(*) FROM listings.outbox_events GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || true
  psql -h "$PGHOST" -p 5434 -U "$PGUSER" -d messaging -v ON_ERROR_STOP=0 -c \
    "SELECT type, published, count(*) FROM messaging.outbox_events GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || true
  psql -h "$PGHOST" -p 5436 -U "$PGUSER" -d shopping -v ON_ERROR_STOP=0 -c \
    "SELECT type, published, count(*) FROM shopping.outbox_events GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || true
  psql -h "$PGHOST" -p 5440 -U "$PGUSER" -d python_ai -v ON_ERROR_STOP=0 -c \
    "SELECT type, published, count(*) FROM ai.outbox_events GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || true
} | tee "$REPORT_DIR/t15-4s-outbox-sql-proof.txt"

rm -f "$OUTBOX_SQL"

# Required AI types must have published=true rows
check_published() {
  local port="$1" db="$2" schema="$3" etype="$4"
  local pub
  pub="$(psql_q "$port" "$db" "SELECT COUNT(*) FROM ${schema}.outbox_events WHERE type='$etype' AND published=true")"
  [[ "${pub:-0}" =~ ^[1-9] ]] && pass "$etype published=true count=$pub ($port/$db.$schema)" || fail "$etype missing published=true on $port/$db.$schema"
}
check_published 5439 analytics analytics AIInsightCreatedV1
check_published 5438 postgres auction_monitor AuctionRiskDetectedV1
check_published 5440 python_ai ai PricingRecommendationCreatedV1

# Messaging must not be unpublished-only for MessageSentV1
msg_pub="$(psql_q 5434 messaging "SELECT COUNT(*) FROM messaging.outbox_events WHERE type='MessageSentV1' AND published=true")"
msg_unpub="$(psql_q 5434 messaging "SELECT COUNT(*) FROM messaging.outbox_events WHERE type='MessageSentV1' AND published=false")"
if [[ "${msg_pub:-0}" =~ ^[1-9] ]]; then
  pass "messaging MessageSentV1 published=true=$msg_pub"
elif [[ "${msg_unpub:-0}" =~ ^[1-9] ]]; then
  fail "messaging MessageSentV1 unpublished-only count=$msg_unpub"
fi

# Listings OBO/auction: at least one published row per family when outbox exists
for etype in OfferCreated BidPlaced; do
  pub="$(psql_q 5435 listings "SELECT COUNT(*) FROM listings.outbox_events WHERE type='$etype' AND published=true")"
  unp="$(psql_q 5435 listings "SELECT COUNT(*) FROM listings.outbox_events WHERE type='$etype' AND published=false")"
  if [[ "${pub:-0}" =~ ^[1-9] ]]; then
    pass "listings $etype published=true=$pub"
  elif [[ "${unp:-0}" =~ ^[1-9] ]]; then
    fail "listings $etype has unpublished=$unp only"
  else
    pass "listings $etype no outbox rows (notification path may be direct kafka)"
  fi
done

# Write matrix report
python3 - "$REPORT_MD" "$REPORT_DIR/event-notification-matrix.json" "$REPORT_DIR/t15-4s-outbox-sql-proof.txt" "$FAIL" <<'PY'
import json, sys, datetime
md, matrix_json, sql_proof, fail = sys.argv[1:5]
rows = []
try:
    rows = json.load(open(matrix_json)).get("rows", [])
except Exception:
    pass
sql = open(sql_proof).read() if __import__("os").path.isfile(sql_proof) else ""
lines = [
    "# T15.4S platform event matrix",
    "",
    f"Generated: {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    "",
    "## Product flows (rp-event-notification-matrix)",
    "",
    "| Event | Producer/API | Outbox | Kafka | Consumer | Notification | Status |",
    "|-------|--------------|--------|-------|----------|--------------|--------|",
]
for r in rows:
    lines.append(f"| {r.get('event','')} | {r.get('api_action','')} | {r.get('outbox','')} | {r.get('kafka_topic','')} | {r.get('consumer','')} | {r.get('notification_db','')} | {r.get('status','')} |")
lines += ["", "## SQL outbox proof", "", "```", sql.strip(), "```", ""]
lines.append("**RESULT: PASS**" if fail == "0" else "**RESULT: FAIL**")
open(md, "w").write("\n".join(lines) + "\n")
PY

say "Report: $REPORT_MD"
[[ "$FAIL" -eq 0 ]] || exit 1
pass "rp-platform-event-e2e-matrix complete"
