#!/usr/bin/env bash
# Load millions of rows into listings DB (port 5435): listings.listings and related tables.
# Respects schema: listing_type, condition, price, etc. Short title/description to avoid GIN blow-up.
# Usage: TARGET_LISTINGS=1000000 ./scripts/load-listings-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
#   LISTINGS_BATCH_SIZE=20000 — smaller batches for listings (default 20k; GIN on title/description)
#   STATEMENT_TIMEOUT=3600 — per-statement timeout in seconds (default 1h)
#   LISTINGS_DROP_GIN_DURING_LOAD=1 — drop GIN indexes during load (only for small/empty tables; on 200k+ rows we skip or timeout)
#   LISTINGS_DROP_GIN_TIMEOUT=1800 — max seconds to wait for DROP (default 30 min); then proceed with indexes
#   LISTINGS_SKIP_GIN_DROP_ABOVE=150000 — if row count >= this, skip GIN drop (drop can take hours on large tables)
#   LOAD_LISTINGS_FAST_STAGING=1 — use UNLOGGED staging table: fill in large batches (no GIN), then INSERT SELECT (much faster; requires GIN drop)
#   STAGING_BATCH_SIZE=100000 — rows per batch when filling staging (default 100k; no index cost so large is fast)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${LISTINGS_DB_HOST:-localhost}"
DB_PORT="${LISTINGS_DB_PORT:-5435}"
DB_USER="${LISTINGS_DB_USER:-postgres}"
DB_NAME="${LISTINGS_DB_NAME:-records}"
DB_PASS="${LISTINGS_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_LISTINGS="${TARGET_LISTINGS:-1000000}"
TARGET_VIEWS="${TARGET_VIEWS:-2000000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
# listings.listings has GIN on title/description; with GIN in place use smaller batches to avoid timeout/OOM
LISTINGS_BATCH_SIZE="${LISTINGS_BATCH_SIZE:-10000}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-3600}"
LISTINGS_DROP_GIN_DURING_LOAD="${LISTINGS_DROP_GIN_DURING_LOAD:-0}"
LISTINGS_DROP_GIN_TIMEOUT="${LISTINGS_DROP_GIN_TIMEOUT:-1800}"
LISTINGS_SKIP_GIN_DROP_ABOVE="${LISTINGS_SKIP_GIN_DROP_ABOVE:-150000}"
LOAD_PROGRESS_INTERVAL="${LOAD_PROGRESS_INTERVAL:-30}"
LOAD_LISTINGS_FAST_STAGING="${LOAD_LISTINGS_FAST_STAGING:-0}"
STAGING_BATCH_SIZE="${STAGING_BATCH_SIZE:-100000}"

echo "$(ts) === Load listings DB (port $DB_PORT): listings.listings + listing_views ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

echo "$(ts) Checking table existence..."
if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'listings' AND table_name = 'listings';" 2>/dev/null | grep -q 1; then
  echo "$(ts) listings.listings missing. Run listings migrations first (e.g. infra/db/05-listings-schema.sql)." >&2
  exit 1
fi

# Fast approximate row count from pg_class (avoids slow/blocking COUNT(*) on large tables)
_count_from_pg_class() {
  psql -d records -tAc "
    SELECT COALESCE((SELECT reltuples::bigint FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'listings' AND c.relname = 'listings'), 0);
  " 2>/dev/null | tr -d ' ' || echo "0"
}

echo "$(ts) Getting row count (exact with 60s timeout, then fallback to approximate)..."
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM listings.listings;" 2>/dev/null | tr -d ' ' || echo "")
if [[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]]; then
  echo "$(ts)   Exact count timed out or failed; using approximate count (run ANALYZE listings.listings for accuracy)." >&2
  CURRENT=$(_count_from_pg_class)
fi
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) listings.listings: $CURRENT (target $TARGET_LISTINGS) [batch ${LISTINGS_BATCH_SIZE}, statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_LISTINGS" ]]; then
  NEED=$(( TARGET_LISTINGS - CURRENT ))
  # Fast path: UNLOGGED staging table, then single INSERT SELECT (avoids per-row GIN cost; 10–50x faster)
  if [[ "${LOAD_LISTINGS_FAST_STAGING}" == "1" ]] && [[ "$CURRENT" -lt "${LISTINGS_SKIP_GIN_DROP_ABOVE}" ]]; then
    echo "$(ts)   Using fast staging path (UNLOGGED table, batch ${STAGING_BATCH_SIZE})..."
    echo "$(ts)   Dropping GIN indexes..."
    psql -d records -c "DROP INDEX IF EXISTS listings.idx_listings_title_trgm; DROP INDEX IF EXISTS listings.idx_listings_description_trgm;" >/dev/null 2>&1 || true
    psql -d records -c "DROP TABLE IF EXISTS listings.listings_staging;" >/dev/null 2>&1 || true
    psql -d records -c "CREATE UNLOGGED TABLE listings.listings_staging (LIKE listings.listings INCLUDING DEFAULTS);" >/dev/null 2>&1 || { echo "$(ts)   Failed to create staging table." >&2; exit 1; }
    _staged=0
    _batch=0
    while [[ $_staged -lt "$NEED" ]]; do
      THIS=$(( STAGING_BATCH_SIZE < (NEED - _staged) ? STAGING_BATCH_SIZE : (NEED - _staged) ))
      _batch=$(( _batch + 1 ))
      echo "$(ts)   staging batch $_batch: inserting $THIS rows into staging (no indexes)..."
      _sql_file=$(mktemp)
      cat <<EOSQL > "$_sql_file"
SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO listings.listings_staging (user_id, title, description, price, currency, listing_type, condition, catalog_id, category, location, shipping_cost, is_active, is_featured, view_count, watch_count)
SELECT
  gen_random_uuid(),
  'LP ' || (ARRAY['Beatles','Pink Floyd','Led Zeppelin','Queen','Fleetwood Mac','David Bowie','Prince','Radiohead'])[1 + (g.n % 8)] || ' ' || substr(md5((${_staged} + g.n)::text), 1, 8) || ' ' || ((${_staged} + g.n) % 1000),
  'Vinyl catalog ' || ((${_staged} + g.n) % 50000) || '. Condition and search text for pgbench.',
  (random() * 500 + 10)::numeric(12,2),
  'USD',
  (ARRAY['fixed_price','fixed_price','auction','obo'])[1 + (g.n % 4)],
  (ARRAY['New','Like New','Very Good','Good','Fair'])[1 + (g.n % 5)],
  'CAT-' || ((${_staged} + g.n) % 100000),
  (ARRAY['Vinyl','LP','7\"','CD','Cassette'])[1 + (g.n % 5)],
  (ARRAY['US','UK','JP','DE',''])[1 + (g.n % 5)],
  (random() * 15)::numeric(10,2),
  true,
  (random() > 0.9),
  (random() * 200)::int,
  (random() * 50)::int
FROM generate_series(1, $THIS) AS g(n);
EOSQL
      psql -d records 2>/dev/null < "$_sql_file" || { rm -f "$_sql_file"; echo "$(ts)   Staging batch $_batch failed." >&2; psql -d records -c "DROP TABLE IF EXISTS listings.listings_staging;" >/dev/null 2>&1; exit 1; }
      rm -f "$_sql_file"
      _staged=$(( _staged + THIS ))
      echo "$(ts)   staging batch $_batch done: $_staged / $NEED rows in staging"
    done
    echo "$(ts)   Copying staging → listings.listings (single INSERT SELECT)..."
    psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s'; INSERT INTO listings.listings SELECT * FROM listings.listings_staging;" >/dev/null 2>&1 || { echo "$(ts)   INSERT SELECT failed." >&2; psql -d records -c "DROP TABLE IF EXISTS listings.listings_staging;" >/dev/null 2>&1; exit 1; }
    psql -d records -c "DROP TABLE listings.listings_staging;" >/dev/null 2>&1 || true
    echo "$(ts)   Recreating GIN indexes on listings.listings..."
    psql -d records -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_title_trgm ON listings.listings USING gin(title gin_trgm_ops); CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_description_trgm ON listings.listings USING gin(description gin_trgm_ops);" >/dev/null 2>&1 || \
    psql -d records -c "CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings.listings USING gin(title gin_trgm_ops); CREATE INDEX IF NOT EXISTS idx_listings_description_trgm ON listings.listings USING gin(description gin_trgm_ops);" >/dev/null 2>&1 || true
    echo "$(ts)   Fast staging load done."
  else
    # Non–fast-staging path: optional GIN drop, then batched inserts with indexes
    _do_drop_gin=false
    _gin_was_dropped=false
    if [[ "${LISTINGS_DROP_GIN_DURING_LOAD}" == "1" ]]; then
      if [[ "$CURRENT" -ge "${LISTINGS_SKIP_GIN_DROP_ABOVE}" ]]; then
        _msg="Table has $CURRENT rows (>= ${LISTINGS_SKIP_GIN_DROP_ABOVE}); skipping GIN drop (can take many hours on large tables). Inserting with indexes."
        echo "$(ts)   $_msg" >&2
      else
        _do_drop_gin=true
      fi
    fi
    if [[ "$_do_drop_gin" == "true" ]]; then
      echo "$(ts)   Dropping GIN indexes (max ${LISTINGS_DROP_GIN_TIMEOUT}s; small table so should finish)..."
      psql -d records -c "DROP INDEX IF EXISTS listings.idx_listings_title_trgm; DROP INDEX IF EXISTS listings.idx_listings_description_trgm;" >/dev/null 2>&1 &
      _drop_pid=$!
      _drop_start=$(date +%s)
      _drop_timed_out=false
      while kill -0 "$_drop_pid" 2>/dev/null; do
        _elapsed=$(($(date +%s) - _drop_start))
        if [[ "$_elapsed" -ge "${LISTINGS_DROP_GIN_TIMEOUT}" ]]; then
          echo "$(ts)   GIN drop timed out after ${LISTINGS_DROP_GIN_TIMEOUT}s; proceeding with indexes (slower but will finish)." >&2
          kill "$_drop_pid" 2>/dev/null || true
          wait "$_drop_pid" 2>/dev/null || true
          _drop_timed_out=true
          break
        fi
        echo "$(ts)   ... still dropping GIN indexes (${_elapsed}s / ${LISTINGS_DROP_GIN_TIMEOUT}s)..." >&2
        sleep "$LOAD_PROGRESS_INTERVAL"
      done
      if [[ "$_drop_timed_out" != "true" ]]; then
        wait "$_drop_pid" || true
        echo "$(ts)   GIN indexes dropped."
        _gin_was_dropped=true
      fi
    fi
    NEED=$(( TARGET_LISTINGS - CURRENT ))
    BATCH=0
    while [[ $NEED -gt 0 ]]; do
      THIS=$(( LISTINGS_BATCH_SIZE < NEED ? LISTINGS_BATCH_SIZE : NEED ))
      BATCH=$(( BATCH + 1 ))
      echo "$(ts)   listings batch $BATCH: inserting $THIS rows..." >&2
      _sql_file=$(mktemp)
      cat <<EOSQL > "$_sql_file"
SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO listings.listings (user_id, title, description, price, currency, listing_type, condition, catalog_id, category, location, shipping_cost, is_active, is_featured, view_count, watch_count)
SELECT
  gen_random_uuid(),
  'LP ' || (ARRAY['Beatles','Pink Floyd','Led Zeppelin','Queen','Fleetwood Mac','David Bowie','Prince','Radiohead'])[1 + (g.n % 8)] || ' ' || substr(md5(g.n::text), 1, 8) || ' ' || (g.n % 1000),
  'Vinyl catalog ' || (g.n % 50000) || '. Condition and search text for pgbench.',
  (random() * 500 + 10)::numeric(12,2),
  'USD',
  (ARRAY['fixed_price','fixed_price','auction','obo'])[1 + (g.n % 4)],
  (ARRAY['New','Like New','Very Good','Good','Fair'])[1 + (g.n % 5)],
  'CAT-' || (g.n % 100000),
  (ARRAY['Vinyl','LP','7\"','CD','Cassette'])[1 + (g.n % 5)],
  (ARRAY['US','UK','JP','DE',''])[1 + (g.n % 5)],
  (random() * 15)::numeric(10,2),
  true,
  (random() > 0.9),
  (random() * 200)::int,
  (random() * 50)::int
FROM generate_series(1, $THIS) AS g(n);
EOSQL
      _err_file=$(mktemp)
      psql -d records 2>"$_err_file" < "$_sql_file" &
      _pid=$!
      while kill -0 "$_pid" 2>/dev/null; do
        echo "$(ts)   ... still inserting listings batch $BATCH ($THIS rows)..." >&2
        sleep "$LOAD_PROGRESS_INTERVAL"
      done
      wait "$_pid"
      _rc=$?
      if [[ $_rc -ne 0 ]]; then
        echo "$(ts)   listings batch $BATCH failed (exit $_rc). Error from Postgres:" >&2
        sed 's/^/     /' "$_err_file" >&2
        echo "$(ts)   Try smaller LISTINGS_BATCH_SIZE (e.g. 5000) or run on empty table with LISTINGS_DROP_GIN_DURING_LOAD=1." >&2
        rm -f "$_sql_file" "$_err_file"
        break
      fi
      rm -f "$_sql_file" "$_err_file"
      CURRENT=$(( CURRENT + THIS ))
      NEED=$(( TARGET_LISTINGS - CURRENT ))
      echo "$(ts)   listings batch $BATCH done: ~$CURRENT rows" >&2
    done
    if [[ "$_gin_was_dropped" == "true" ]]; then
      echo "$(ts)   Recreating GIN indexes on listings.listings..."
      psql -d records -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_title_trgm ON listings.listings USING gin(title gin_trgm_ops); CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_description_trgm ON listings.listings USING gin(description gin_trgm_ops);" >/dev/null 2>&1 || \
      psql -d records -c "CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings.listings USING gin(title gin_trgm_ops); CREATE INDEX IF NOT EXISTS idx_listings_description_trgm ON listings.listings USING gin(description gin_trgm_ops);" >/dev/null 2>&1 || true
      echo "$(ts)   GIN indexes recreated."
    fi
  fi
fi

# 2) listing_views (FK listing_id) — sample listing IDs via TABLESAMPLE (avoids ORDER BY random() full scan on 1M+ rows)
echo "$(ts) Getting listing_views row count (60s timeout)..."
CURRENT=$(psql -d records -tAc "SET statement_timeout = '60s'; SELECT count(*) FROM listings.listing_views;" 2>/dev/null | tr -d ' ' || echo "0")
[[ -z "$CURRENT" || ! "$CURRENT" =~ ^[0-9]+$ ]] && CURRENT=0
echo "$(ts) listings.listing_views: $CURRENT (target $TARGET_VIEWS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
if [[ "$CURRENT" -lt "$TARGET_VIEWS" ]]; then
  NEED=$(( TARGET_VIEWS - CURRENT ))
  BATCH=0
  while [[ $NEED -gt 0 ]]; do
    THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
    BATCH=$(( BATCH + 1 ))
    echo "$(ts)   listing_views batch $BATCH: inserting $THIS rows..." >&2
    _err_file=$(mktemp)
    psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH list_sample AS (
  SELECT id, row_number() OVER () AS rn FROM (
    SELECT id FROM listings.listings TABLESAMPLE SYSTEM(0.15) LIMIT 1000
  ) t
),
series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO listings.listing_views (listing_id, user_id, viewed_at)
SELECT
  (SELECT id FROM list_sample WHERE rn = 1 + (s.n % (SELECT count(*) FROM list_sample))),
  (CASE WHEN s.n % 5 != 0 THEN gen_random_uuid()::uuid ELSE NULL END),
  now() - (random() * interval '365 days')
FROM series s;" 2>"$_err_file" || {
      echo "$(ts) listing_views batch $BATCH failed." >&2
      echo "$(ts) Postgres error:" >&2
      sed 's/^/     /' "$_err_file" >&2
      rm -f "$_err_file"
      break
    }
    rm -f "$_err_file"
    CURRENT=$(( CURRENT + THIS ))
    NEED=$(( TARGET_VIEWS - CURRENT ))
    echo "$(ts)   listing_views batch $BATCH done: ~$CURRENT rows" >&2
  done
fi

echo "$(ts) Done. Run run_listings_pgbench_sweep.sh for benchmarking."
