#!/usr/bin/env bash
set -euo pipefail

# Optimize shopping database for performance
# Mirrors optimize-db-for-performance.sh for main database

: "${SHOPPING_DB_HOST:=localhost}"
: "${SHOPPING_DB_PORT:=5436}"
: "${SHOPPING_DB_USER:=postgres}"
: "${SHOPPING_DB_NAME:=records}"
: "${SHOPPING_DB_PASSWORD:=postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Optimizing Shopping Database for High Performance ==="
echo "Using Postgres at ${SHOPPING_DB_HOST}:${SHOPPING_DB_PORT}..."

# Test connection
if ! PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  echo "❌ Cannot connect to shopping database at ${SHOPPING_DB_HOST}:${SHOPPING_DB_PORT}" >&2
  exit 1
fi

# Handle effective_io_concurrency
echo "Setting effective_io_concurrency..."
if ! PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" -c "ALTER SYSTEM SET effective_io_concurrency = 200;" 2>/dev/null; then
  echo "⚠️  Platform doesn't support effective_io_concurrency=200, using 0..."
  PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" -c "ALTER SYSTEM SET effective_io_concurrency = 0;" 2>/dev/null || true
fi

PGPASSWORD="$SHOPPING_DB_PASSWORD" psql \
  -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" \
  -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- ============================================
-- SHOPPING DATABASE PERFORMANCE OPTIMIZATIONS
-- Target: High TPS for shopping cart, watchlist, history queries
-- ============================================

-- 1. System-level settings (persistent)
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_cache_size = '2GB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET max_worker_processes = 12;
ALTER SYSTEM SET max_parallel_workers = 12;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;

-- Reload configuration
SELECT pg_reload_conf();

-- 2. Database-level settings (persistent)
ALTER DATABASE records SET random_page_cost = 1.1;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '2GB';
ALTER DATABASE records SET work_mem = '32MB';
ALTER DATABASE records SET track_io_timing = on;
ALTER DATABASE records SET max_parallel_workers = 12;
ALTER DATABASE records SET max_parallel_workers_per_gather = 4;

-- 3. Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 4. Analyze tables for fresh statistics
ANALYZE shopping.shopping_cart;
ANALYZE shopping.watchlist;
ANALYZE shopping.recently_viewed;
ANALYZE shopping.wishlist;
ANALYZE shopping.purchase_history;
ANALYZE shopping.search_history;
ANALYZE shopping.cache_metadata;

-- 5. Prewarm critical indexes
DO $$
DECLARE idx regclass;
BEGIN
  -- Shopping indexes
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'shopping'
      AND c.relkind = 'i'
  LOOP
    PERFORM pg_prewarm(idx);
  END LOOP;
END $$;

-- Show current settings
SELECT 'Current max_connections: ' || current_setting('max_connections');
SELECT 'Current shared_buffers: ' || current_setting('shared_buffers');
SELECT 'Current work_mem: ' || current_setting('work_mem');
SQL

say "✅ Shopping database optimization complete!"
say "⚠️  Note: max_connections requires PostgreSQL restart to take effect"

