#!/usr/bin/env bash
# Load millions of rows into analytics DB (port 5439): price_snapshots, search_analytics, user_behavior, trend_snapshots.
# Respects schema and CHECK constraints. Realistic sources, metric types, dates.
# Usage: TARGET_PRICE_SNAPSHOTS=1000000 ./scripts/load-analytics-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${ANALYTICS_DB_HOST:-localhost}"
DB_PORT="${ANALYTICS_DB_PORT:-5439}"
DB_USER="${ANALYTICS_DB_USER:-postgres}"
DB_NAME="${ANALYTICS_DB_NAME:-records}"
DB_PASS="${ANALYTICS_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_PRICE_SNAPSHOTS="${TARGET_PRICE_SNAPSHOTS:-1000000}"
TARGET_SEARCH_ANALYTICS="${TARGET_SEARCH_ANALYTICS:-1500000}"
TARGET_USER_BEHAVIOR="${TARGET_USER_BEHAVIOR:-1200000}"
TARGET_TREND_SNAPSHOTS="${TARGET_TREND_SNAPSHOTS:-500000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-3600}"

echo "$(ts) === Load analytics DB (port $DB_PORT) ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

_psql_connect postgres "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'records') THEN
    CREATE DATABASE records;
  END IF;
END \$\$;
" >/dev/null 2>&1 || true

if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'analytics' AND table_name = 'price_snapshots';" 2>/dev/null | grep -q 1; then
  echo "$(ts) analytics schema missing. Run infra/db/08-analytics-schema.sql first." >&2
  exit 1
fi

# price_snapshots — use timeout on count (large table can be slow)
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.price_snapshots;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) analytics.price_snapshots: $CURRENT (target $TARGET_PRICE_SNAPSHOTS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
while [[ "$CURRENT" -lt "$TARGET_PRICE_SNAPSHOTS" ]]; do
  NEED=$(( TARGET_PRICE_SNAPSHOTS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO analytics.price_snapshots (record_id, source, price, currency, condition_record, condition_sleeve, snapshot_date)
SELECT gen_random_uuid(), (ARRAY['discogs','popsike','gripseeat','ebay','manual'])[1 + (g.n % 5)], (random() * 500 + 5)::numeric(10,2), 'USD', (ARRAY['M','NM','EX+','VG+','VG'])[1 + (g.n % 5)], (ARRAY['M','NM','EX','VG'])[1 + (g.n % 4)], (CURRENT_DATE - (g.n % 365)::int)
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (record_id, source, snapshot_date, condition_record, condition_sleeve) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.price_snapshots;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   price_snapshots: $CURRENT"
done

# search_analytics
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.search_analytics;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) analytics.search_analytics: $CURRENT (target $TARGET_SEARCH_ANALYTICS)"
while [[ "$CURRENT" -lt "$TARGET_SEARCH_ANALYTICS" ]]; do
  NEED=$(( TARGET_SEARCH_ANALYTICS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO analytics.search_analytics (user_id, query, result_count, clicked_result_id, search_timestamp, session_id, user_agent)
SELECT CASE WHEN random() > 0.2 THEN gen_random_uuid() ELSE NULL END, 'query ' || (ARRAY['vinyl','LP','Beatles','rare','first pressing'])[1 + (g.n % 5)] || ' ' || substr(md5(g.n::text), 1, 8), (random() * 500)::int, gen_random_uuid(), now() - (random() * interval '90 days'), 'sess-' || (g.n % 100000), 'Mozilla/5.0'
FROM generate_series(1, $THIS) AS g(n);
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.search_analytics;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   search_analytics: $CURRENT"
done

# user_behavior
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.user_behavior;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) analytics.user_behavior: $CURRENT (target $TARGET_USER_BEHAVIOR)"
while [[ "$CURRENT" -lt "$TARGET_USER_BEHAVIOR" ]]; do
  NEED=$(( TARGET_USER_BEHAVIOR - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO analytics.user_behavior (user_id, event_type, entity_type, entity_id, metadata, event_timestamp)
SELECT gen_random_uuid(), (ARRAY['view','search','add_to_collection','remove_from_collection','share','export'])[1 + (g.n % 6)], (ARRAY['record','collection','search','listing'])[1 + (g.n % 4)], gen_random_uuid(), '{}'::jsonb, now() - (random() * interval '180 days')
FROM generate_series(1, $THIS) AS g(n);
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.user_behavior;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   user_behavior: $CURRENT"
done

# trend_snapshots
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.trend_snapshots;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) analytics.trend_snapshots: $CURRENT (target $TARGET_TREND_SNAPSHOTS)"
while [[ "$CURRENT" -lt "$TARGET_TREND_SNAPSHOTS" ]]; do
  NEED=$(( TARGET_TREND_SNAPSHOTS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO analytics.trend_snapshots (record_id, metric_type, metric_value, snapshot_date, period)
SELECT gen_random_uuid(), (ARRAY['price_avg','price_median','price_min','price_max','volume','search_count'])[1 + (g.n % 6)], (random() * 300 + 10)::numeric(12,4), (CURRENT_DATE - (g.n % 365)::int), (ARRAY['daily','weekly','monthly','yearly'])[1 + (g.n % 4)]
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (record_id, metric_type, snapshot_date, period) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM analytics.trend_snapshots;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   trend_snapshots: $CURRENT"
done

echo "$(ts) Done. Run run_analytics_pgbench_sweep.sh for benchmarking."
