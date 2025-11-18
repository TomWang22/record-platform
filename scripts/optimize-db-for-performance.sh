#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD" ]]; then
  echo "❌ PostgreSQL pod not found in namespace $NS"
  exit 1
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Optimizing Database for 28k TPS Target ==="

# Wait for database to be ready
say "Waiting for database to be ready..."
for i in {1..30}; do
  if kubectl -n "$NS" exec "$POD" -c db -- pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    ok "Database is ready"
    break
  fi
  sleep 2
done

say "Applying aggressive performance optimizations..."

# Always use localhost:5432 to match run_pgbench_sweep.sh
# This ensures optimizations are applied to the same database
: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "Using Postgres at ${PGHOST}:${PGPORT} for optimizations..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- ============================================
-- AGGRESSIVE PERFORMANCE OPTIMIZATIONS
-- Target: 28k TPS (from good run)
-- ============================================

-- 1. System-level settings (persistent)
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_cache_size = '4GB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET shared_buffers = '1GB';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET max_worker_processes = 12;
ALTER SYSTEM SET max_parallel_workers = 12;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;

-- Reload configuration
SELECT pg_reload_conf();

-- 2. Database-level settings (persistent)
ALTER DATABASE records SET random_page_cost = 1.1;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '4GB';
ALTER DATABASE records SET work_mem = '32MB';
ALTER DATABASE records SET track_io_timing = on;
ALTER DATABASE records SET max_parallel_workers = 12;
ALTER DATABASE records SET max_parallel_workers_per_gather = 4;
ALTER DATABASE records SET search_path = 'records, public';

-- 3. Session-level settings (immediate effect)
SET random_page_cost = 1.1;
SET cpu_index_tuple_cost = 0.0005;
SET cpu_tuple_cost = 0.01;
SET effective_cache_size = '4GB';
SET work_mem = '32MB';
SET track_io_timing = on;
SET max_parallel_workers = 12;
SET max_parallel_workers_per_gather = 4;
SET search_path = records, public;

-- 4. Ensure all critical indexes exist and are optimized
CREATE INDEX IF NOT EXISTS ix_records_user_id_updated_at ON records.records(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_records_search_norm_gist ON records.records USING gist (search_norm gist_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_records_artist_trgm ON records.records USING gin (artist gin_trgm_ops) WITH (fastupdate = off);
CREATE INDEX IF NOT EXISTS ix_records_name_trgm ON records.records USING gin (name gin_trgm_ops) WITH (fastupdate = off);
CREATE INDEX IF NOT EXISTS ix_records_catalog_trgm ON records.records USING gin (catalog_number gin_trgm_ops) WITH (fastupdate = off);

-- 5. Ensure search_norm column is populated
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'records' 
    AND table_name = 'records' 
    AND column_name = 'search_norm'
  ) THEN
    ALTER TABLE records.records ADD COLUMN search_norm text;
  END IF;
END $$;

UPDATE records.records 
SET search_norm = lower(concat_ws(' ', artist, name, catalog_number)) 
WHERE search_norm IS NULL;

-- 6. VACUUM ANALYZE for fresh statistics
VACUUM ANALYZE records.records;

-- 7. Prewarm critical indexes
SELECT pg_prewarm('records.ix_records_user_id_updated_at'::regclass) 
WHERE to_regclass('records.ix_records_user_id_updated_at') IS NOT NULL;

SELECT pg_prewarm('records.ix_records_search_norm_gist'::regclass) 
WHERE to_regclass('records.ix_records_search_norm_gist') IS NOT NULL;

SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass) 
WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;

SELECT pg_prewarm('records.ix_records_name_trgm'::regclass) 
WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;

SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass) 
WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;

-- 8. Verify settings
SELECT 
  name, 
  setting, 
  unit,
  source
FROM pg_settings 
WHERE name IN (
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'effective_cache_size',
  'work_mem',
  'track_io_timing',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'shared_buffers',
  'max_connections'
)
ORDER BY name;

ok "Performance optimizations applied"
SQL
OPT_EXIT=$?

if [[ ${OPT_EXIT:-0} -ne 0 ]]; then
  echo "❌ Optimization failed!" >&2
  exit 1
fi

say "=== Optimization Complete ==="
echo ""
echo "Applied optimizations:"
echo "✅ System-level settings (persistent)"
echo "✅ Database-level settings (persistent)"
echo "✅ Session-level settings (immediate)"
echo "✅ Index optimization (GIN, GiST, fastupdate=off)"
echo "✅ VACUUM ANALYZE for fresh statistics"
echo "✅ Index prewarming"
echo ""
echo "Next: Run benchmark to verify 28k TPS target"

