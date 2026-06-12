#!/usr/bin/env bash
# Drain unpublished AI platform outbox rows and prove published=true.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

NS="${HOUSING_NS:-record-platform}"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
CA="$(rp_dev_edge_ca_file)"
BASE="${RP_PUBLIC_ORIGIN:-https://record-platform.test}"
EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
BATCHES="${RP_AI_OUTBOX_DRAIN_BATCHES:-40}"
BATCH_SIZE="${RP_AI_OUTBOX_DRAIN_BATCH_SIZE:-100}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

psql_q() {
  psql -h "$PGHOST" -p "$1" -U postgres -d "$2" -v ON_ERROR_STOP=1 -tAc "$3"
}

say "=== rp-ai-outbox-publish-drain ==="

# 1) Trigger live producers via API
TOKEN="$(curl -sk --cacert "$CA" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")"
USER_ID="$(curl -sk --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sub') or d.get('user',{}).get('id',''))")"
curl -sk --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/analytics/ai/features/$USER_ID" >/dev/null || true
curl -sk --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/auctions/ai-signals?refresh=1" >/dev/null || true
LISTING="$(psql_q 5435 listings "SELECT listing_id::text FROM listings.auction_settings WHERE status='active' LIMIT 1")"
curl -sk --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/api/ai/offer-insights?listing_id=$LISTING" >/dev/null || true
ok "triggered analytics / auction-monitor / python-ai producers"

# 2) Drain auction-monitor outbox in-cluster (Node + mTLS)
for ((i=1; i<=BATCHES; i++)); do
  N="$(kubectl exec -n "$NS" deployment/auction-monitor -- node -e "
const {Pool}=require('pg');const {kafka}=require('@common/utils/kafka');
const pool=new Pool({connectionString:process.env.POSTGRES_URL_AUCTION_MONITOR});
const topic=(process.env.ENV_PREFIX||'dev')+'.auction_monitor.events';
(async()=>{
  const p=kafka.producer();await p.connect();
  const {rows}=await pool.query(\"WITH picked AS (SELECT id FROM auction_monitor.outbox_events WHERE published=false ORDER BY created_at ASC LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED) SELECT b.id::text,b.aggregate_id,b.payload FROM auction_monitor.outbox_events b INNER JOIN picked p ON b.id=p.id\");
  for(const r of rows){await p.send({topic,messages:[{key:r.aggregate_id,value:r.payload}]});await pool.query('UPDATE auction_monitor.outbox_events SET published=true WHERE id=\$1::uuid',[r.id]);}
  console.log(rows.length);await p.disconnect();await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
" 2>/dev/null | tail -1)"
  [[ "${N:-0}" -eq 0 ]] && break
done
ok "auction-monitor outbox drain batches=$i"

# 3) Proof queries
say "Outbox published counts"
psql -h "$PGHOST" -p 5439 -U postgres -d analytics -c \
  "SELECT type, published, count(*) FROM analytics.outbox_events WHERE type IN ('AIInsightCreatedV1','PricingRecommendationCreatedV1') GROUP BY 1,2 ORDER BY 1,2;"
psql -h "$PGHOST" -p 5438 -U postgres -d postgres -c \
  "SELECT type, published, count(*) FROM auction_monitor.outbox_events WHERE type='AuctionRiskDetectedV1' GROUP BY 1,2 ORDER BY 1,2;"
psql -h "$PGHOST" -p 5440 -U postgres -d python_ai -c \
  "SELECT type, published, count(*) FROM ai.outbox_events WHERE type='PricingRecommendationCreatedV1' GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null || echo "ℹ️  python_ai outbox table not present yet"

AI_PUB="$(psql_q 5439 analytics "SELECT count(*) FROM analytics.outbox_events WHERE type='AIInsightCreatedV1' AND published=true")"
AUC_PUB="$(psql_q 5438 postgres "SELECT count(*) FROM auction_monitor.outbox_events WHERE type='AuctionRiskDetectedV1' AND published=true")"
PRICING_PUB="$(psql_q 5440 python_ai "SELECT count(*) FROM ai.outbox_events WHERE type='PricingRecommendationCreatedV1' AND published=true" 2>/dev/null || echo 0)"

[[ "${AI_PUB:-0}" -ge 1 ]] || fail "AIInsightCreatedV1 published=true count=$AI_PUB"
[[ "${AUC_PUB:-0}" -ge 1 ]] || fail "AuctionRiskDetectedV1 published=true count=$AUC_PUB"
[[ "${PRICING_PUB:-0}" -ge 1 ]] || fail "PricingRecommendationCreatedV1 published=true count=$PRICING_PUB"

NOTIF_AI="$(psql_q 5441 notification "SELECT count(*) FROM notification.notifications WHERE event_type IN ('AIInsightCreatedV1','AuctionRiskDetectedV1','PricingRecommendationCreatedV1')")"
[[ "${NOTIF_AI:-0}" -ge 3 ]] || fail "notification AI rows=$NOTIF_AI (need >=3)"

ok "drain complete: AI=$AI_PUB auction=$AUC_PUB pricing=$PRICING_PUB notifications=$NOTIF_AI"
exit 0
