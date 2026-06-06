#!/usr/bin/env bash
# Load millions of rows into auction_monitor DB (port 5438): auction_results, user_saved_auctions, monitoring_jobs.
# Respects schema: source IN ('discogs','popsike','gripseeat','ebay'), UNIQUE(source, external_id).
# Usage: TARGET_AUCTION_RESULTS=1000000 ./scripts/load-auction-monitor-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${AUCTION_MONITOR_DB_HOST:-localhost}"
DB_PORT="${AUCTION_MONITOR_DB_PORT:-5438}"
DB_USER="${AUCTION_MONITOR_DB_USER:-postgres}"
DB_NAME="${AUCTION_MONITOR_DB_NAME:-records}"
DB_PASS="${AUCTION_MONITOR_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_AUCTION_RESULTS="${TARGET_AUCTION_RESULTS:-1000000}"
TARGET_USER_SAVED="${TARGET_USER_SAVED:-300000}"
TARGET_MONITORING_JOBS="${TARGET_MONITORING_JOBS:-100000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-3600}"

echo "$(ts) === Load auction_monitor DB (port $DB_PORT) ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

# records DB already created by apply script; skip DO block (CREATE DATABASE cannot run in transaction)

if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'auction_monitor' AND table_name = 'auction_results';" 2>/dev/null | grep -q 1; then
  echo "$(ts) auction_monitor schema missing. Run auction-monitor migrations first (e.g. infra/db/07-auction-monitor-schema.sql)." >&2
  exit 1
fi

# auction_results — UNIQUE(source, external_id). Use timeout for count (large table can be slow)
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.auction_results;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) auction_monitor.auction_results: $CURRENT (target $TARGET_AUCTION_RESULTS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
while [[ "$CURRENT" -lt "$TARGET_AUCTION_RESULTS" ]]; do
  NEED=$(( TARGET_AUCTION_RESULTS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO auction_monitor.auction_results (source, external_id, record_id, title, artist, label, catalog_number, format, condition_record, condition_sleeve, price, currency, shipping_cost, total_cost, sold_at)
SELECT
  (ARRAY['discogs','popsike','gripseeat','ebay'])[1 + (g.n % 4)],
  'ext-' || g.n || '-' || substr(md5(random()::text), 1, 12),
  CASE WHEN random() > 0.5 THEN gen_random_uuid() ELSE NULL END,
  'LP ' || (ARRAY['Beatles','Pink Floyd','Queen','Led Zeppelin'])[1 + (g.n % 4)] || ' — ' || substr(md5(g.n::text), 1, 8),
  (ARRAY['Beatles','Pink Floyd','Queen','Led Zeppelin','Fleetwood Mac'])[1 + (g.n % 5)],
  'Label ' || (g.n % 5000),
  'CAT-' || (g.n % 100000),
  (ARRAY['LP','7\"','12\"','CD'])[1 + (g.n % 4)],
  (ARRAY['M','NM','EX+','VG+','VG'])[1 + (g.n % 5)],
  (ARRAY['M','NM','EX','VG'])[1 + (g.n % 4)],
  (random() * 400 + 10)::numeric(10,2),
  'USD',
  (random() * 15)::numeric(10,2),
  (random() * 420 + 15)::numeric(10,2),
  now() - (random() * interval '730 days')
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (source, external_id) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.auction_results;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   auction_results: $CURRENT"
done

# user_saved_auctions — FK auction_result_id; use TABLESAMPLE to avoid ORDER BY random() full scan on 1M rows
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.user_saved_auctions;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) auction_monitor.user_saved_auctions: $CURRENT (target $TARGET_USER_SAVED)"
while [[ "$CURRENT" -lt "$TARGET_USER_SAVED" ]]; do
  NEED=$(( TARGET_USER_SAVED - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH id_sample AS (
  SELECT id, row_number() OVER () AS rn FROM (SELECT id FROM auction_monitor.auction_results TABLESAMPLE SYSTEM(0.2) LIMIT 1000) t
),
series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO auction_monitor.user_saved_auctions (user_id, auction_result_id, notes)
SELECT gen_random_uuid(), (SELECT id FROM id_sample WHERE rn = 1 + (s.n % (SELECT count(*) FROM id_sample))), 'Note ' || s.n
FROM series s
ON CONFLICT (user_id, auction_result_id) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.user_saved_auctions;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   user_saved_auctions: $CURRENT"
done

# monitoring_jobs — UNIQUE(user_id, source, query)
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.monitoring_jobs;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) auction_monitor.monitoring_jobs: $CURRENT (target $TARGET_MONITORING_JOBS)"
while [[ "$CURRENT" -lt "$TARGET_MONITORING_JOBS" ]]; do
  NEED=$(( TARGET_MONITORING_JOBS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO auction_monitor.monitoring_jobs (user_id, source, query, active, last_result_count)
SELECT gen_random_uuid(), (ARRAY['discogs','popsike','gripseeat','ebay'])[1 + (g.n % 4)], 'query ' || substr(md5(g.n::text), 1, 16), (random() > 0.2), (random() * 100)::int
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (user_id, source, query) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM auction_monitor.monitoring_jobs;" 2>/dev/null | tr -d ' ' || echo "0")
  [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
  echo "$(ts)   monitoring_jobs: $CURRENT"
done

echo "$(ts) Done. Run run_auction-monitor_pgbench_sweep.sh for benchmarking."
