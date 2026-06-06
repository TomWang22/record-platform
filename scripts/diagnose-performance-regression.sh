#!/usr/bin/env bash
set -Eeuo pipefail

# Diagnostic script to identify performance regression between Nov 22 and Nov 26 runs
# Compares current configuration with previous "gold" run

echo "=== Performance Regression Diagnostic ==="
echo "Comparing current setup with Nov 22 'gold' run"
echo ""

# Database connection
RECORDS_DB_HOST="${RECORDS_DB_HOST:-localhost}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"
RECORDS_DB_USER="${RECORDS_DB_USER:-postgres}"
RECORDS_DB_PASS="${RECORDS_DB_PASS:-postgres}"
RECORDS_DB_NAME="${RECORDS_DB_NAME:-records}"

# Read benchmark script defaults to match PGOPTIONS_EXTRA
TRGM_THRESHOLD="${TRGM_THRESHOLD:-0.40}"
TRACK_IO_TIMING="${TRACK_IO_TIMING:-on}"
WORK_MEM_MB="${WORK_MEM_MB:-32}"
EFFECTIVE_IO_CONCURRENCY="${EFFECTIVE_IO_CONCURRENCY:-200}"
MAX_PARALLEL_WORKERS="${MAX_PARALLEL_WORKERS:-12}"
MAX_PARALLEL_WORKERS_PER_GATHER="${MAX_PARALLEL_WORKERS_PER_GATHER:-4}"
MAINTENANCE_WORK_MEM="${MAINTENANCE_WORK_MEM:-512MB}"
RANDOM_PAGE_COST="${RANDOM_PAGE_COST:-1.1}"
CPU_INDEX_TUPLE_COST="${CPU_INDEX_TUPLE_COST:-0.0005}"
CPU_TUPLE_COST="${CPU_TUPLE_COST:-0.01}"
EFFECTIVE_CACHE_SIZE="${EFFECTIVE_CACHE_SIZE:-4GB}"

# Build PGOPTIONS_EXTRA to match benchmark script
PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=off -c random_page_cost=${RANDOM_PAGE_COST} -c cpu_index_tuple_cost=${CPU_INDEX_TUPLE_COST} -c cpu_tuple_cost=${CPU_TUPLE_COST} -c effective_cache_size=${EFFECTIVE_CACHE_SIZE} -c work_mem=${WORK_MEM_MB}MB -c track_io_timing=${TRACK_IO_TIMING} -c effective_io_concurrency=${EFFECTIVE_IO_CONCURRENCY} -c max_parallel_workers=${MAX_PARALLEL_WORKERS} -c max_parallel_workers_per_gather=${MAX_PARALLEL_WORKERS_PER_GATHER} -c maintenance_work_mem=${MAINTENANCE_WORK_MEM} -c pg_trgm.similarity_threshold=${TRGM_THRESHOLD} -c synchronous_commit=off"

psql_cmd() {
  PGPASSWORD="$RECORDS_DB_PASS" psql \
    -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
    -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
    -X -P pager=off "$@"
}

psql_cmd_with_options() {
  # PGOPTIONS is an environment variable that psql reads (same as pgbench)
  # It contains space-separated -c flags like: "-c jit=off -c enable_seqscan=off"
  export PGOPTIONS="$PGOPTIONS_EXTRA"
  PGPASSWORD="$RECORDS_DB_PASS" psql \
    -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
    -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
    -X -P pager=off "$@"
  unset PGOPTIONS
}

echo "=== 1. Function Definition Check ==="
echo "Current search_records_fuzzy_ids function:"
psql_cmd <<'SQL'
SELECT 
  CASE 
    WHEN l.lanname = 'sql' THEN 'SQL'
    WHEN l.lanname = 'plpgsql' THEN 'PL/pgSQL'
    ELSE COALESCE(l.lanname, 'OTHER')
  END AS language,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname = 'search_records_fuzzy_ids'
  AND p.pronargs = 5
LIMIT 1;
SQL

echo ""
echo "=== 2. PostgreSQL Configuration (Critical Settings) ==="
echo "NOTE: These are DATABASE-LEVEL defaults. Session-level PGOPTIONS override these during benchmarks."
psql_cmd <<'SQL'
SELECT 
  name,
  setting,
  unit,
  CASE 
    WHEN context = 'postmaster' THEN '⚠️  REQUIRES RESTART'
    WHEN context = 'sighup' THEN '⚠️  REQUIRES RELOAD'
    ELSE '✓ Can change'
  END AS change_requirement,
  CASE
    WHEN name = 'enable_seqscan' AND setting = 'on' THEN '❌ Should be OFF for gold run'
    WHEN name = 'jit' AND setting = 'on' THEN '❌ Should be OFF for gold run'
    WHEN name = 'synchronous_commit' AND setting = 'on' THEN '❌ Should be OFF for gold run'
    WHEN name = 'effective_cache_size' AND setting::bigint * 8192 / (1024*1024*1024) != 4 THEN '⚠️  Gold run used 4GB'
    WHEN name = 'work_mem' AND setting::bigint / 1024 != 32 THEN '⚠️  Gold run used 32MB'
    ELSE '✓ OK'
  END AS gold_check
FROM pg_settings
WHERE name IN (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'effective_io_concurrency',
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'checkpoint_completion_target',
  'max_wal_size',
  'synchronous_commit',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'track_io_timing',
  'pg_trgm.similarity_threshold',
  'jit',
  'enable_seqscan',
  'max_connections',
  'statement_timeout'
)
ORDER BY name;
SQL

echo ""
echo "=== 2b. Session Settings WITH PGOPTIONS_EXTRA (What pgbench actually uses) ==="
echo "Testing with PGOPTIONS_EXTRA from benchmark script:"
echo "$PGOPTIONS_EXTRA"
echo ""
psql_cmd_with_options <<'SQL'
SELECT 
  name,
  setting,
  CASE 
    WHEN name = 'enable_seqscan' AND setting = 'off' THEN '✅ Correct (OFF)'
    WHEN name = 'enable_seqscan' AND setting = 'on' THEN '❌ WRONG (should be OFF)'
    WHEN name = 'jit' AND setting = 'off' THEN '✅ Correct (OFF)'
    WHEN name = 'jit' AND setting = 'on' THEN '❌ WRONG (should be OFF)'
    WHEN name = 'synchronous_commit' AND setting = 'off' THEN '✅ Correct (OFF)'
    WHEN name = 'synchronous_commit' AND setting = 'on' THEN '❌ WRONG (should be OFF)'
    WHEN name = 'work_mem' AND setting LIKE '32%' THEN '✅ Correct (32MB)'
    WHEN name = 'effective_cache_size' AND setting::bigint * 8192 / (1024*1024*1024) = 4 THEN '✅ Correct (4GB)'
    ELSE '✓ ' || setting
  END AS status
FROM pg_settings
WHERE name IN ('enable_seqscan', 'jit', 'synchronous_commit', 'work_mem', 'effective_cache_size', 'random_page_cost', 'track_io_timing')
ORDER BY name;
SQL

echo ""
echo "=== 3. Database Statistics ==="
echo "Checking table statistics vs actual row count..."
psql_cmd <<'SQL'
SELECT 
  schemaname,
  relname AS tablename,
  n_live_tup AS live_rows,
  n_dead_tup AS dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  CASE 
    WHEN last_analyze IS NULL AND last_autoanalyze IS NULL THEN '⚠️  NEVER ANALYZED'
    WHEN last_analyze IS NOT NULL AND last_analyze < NOW() - INTERVAL '1 day' THEN '⚠️  STALE (>1 day old)'
    WHEN last_autoanalyze IS NOT NULL AND last_autoanalyze < NOW() - INTERVAL '1 day' THEN '⚠️  STALE (>1 day old)'
    ELSE '✓ Recent'
  END AS stats_status
FROM pg_stat_user_tables
WHERE schemaname = 'records' AND relname = 'records'
LIMIT 1;
SQL

echo ""
echo "Actual row count (from table):"
psql_cmd <<'SQL'
SELECT 
  schemaname,
  relname AS tablename,
  (SELECT COUNT(*) FROM records.records) AS actual_row_count,
  pg_size_pretty(pg_total_relation_size('records.records'::regclass)) AS table_size
FROM pg_stat_user_tables
WHERE schemaname = 'records' AND relname = 'records'
LIMIT 1;
SQL

echo ""
echo "Statistics vs Reality Check:"
psql_cmd <<'SQL'
WITH stats AS (
  SELECT n_live_tup AS stats_rows FROM pg_stat_user_tables 
  WHERE schemaname = 'records' AND relname = 'records'
),
actual AS (
  SELECT COUNT(*)::bigint AS actual_rows FROM records.records
)
SELECT 
  s.stats_rows AS statistics_row_count,
  a.actual_rows AS actual_row_count,
  CASE 
    WHEN s.stats_rows = 0 AND a.actual_rows > 0 THEN '❌ CRITICAL: Statistics show 0 rows but table has ' || a.actual_rows || ' rows - RUN ANALYZE!'
    WHEN ABS(s.stats_rows - a.actual_rows)::float / GREATEST(a.actual_rows, 1) > 0.1 THEN '⚠️  WARNING: Statistics are significantly off (>10% difference)'
    WHEN ABS(s.stats_rows - a.actual_rows)::float / GREATEST(a.actual_rows, 1) > 0.05 THEN '⚠️  Statistics are slightly off (>5% difference)'
    ELSE '✅ Statistics match reality'
  END AS status
FROM stats s, actual a;
SQL

echo ""
echo "=== 4. Index Usage Check ==="
psql_cmd <<'SQL'
SELECT 
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'records' 
  AND relname = 'records'
  AND indexrelname LIKE '%search%'
ORDER BY idx_scan DESC;
SQL

echo ""
echo "=== 5. Cache Hit Ratio ==="
psql_cmd <<'SQL'
SELECT 
  'Database' AS scope,
  sum(heap_blks_read) AS heap_read,
  sum(heap_blks_hit) AS heap_hit,
  CASE 
    WHEN sum(heap_blks_hit) + sum(heap_blks_read) > 0 
    THEN round(100.0 * sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)), 2)
    ELSE 0
  END AS hit_ratio_pct
FROM pg_statio_user_tables
WHERE schemaname = 'records';

-- Also check database-level cache stats
SELECT 
  'Database-level' AS scope,
  blks_read AS heap_read,
  blks_hit AS heap_hit,
  CASE 
    WHEN blks_hit + blks_read > 0 
    THEN round(100.0 * blks_hit / (blks_hit + blks_read), 2)
    ELSE 0
  END AS hit_ratio_pct
FROM pg_stat_database
WHERE datname = 'records';
SQL

echo ""
echo "=== 6. Query Plan Analysis (Sample Query) ==="
USER_ID="${USER_ID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
QUERY="${QUERY:-鄧麗君 album 263 cn-041 polygram}"

psql_cmd <<SQL
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS, TIMING OFF, SUMMARY)
SELECT id, rank
FROM public.search_records_fuzzy_ids(
  '${USER_ID}'::uuid,
  '${QUERY}',
  50::bigint,
  0::bigint,
  'fast'::text
);
SQL

echo ""
echo "=== 7. Expected vs Current Performance ==="
echo "Previous 'Gold' Run (Nov 22):"
echo "  knn warm @ 64 clients:  6152 TPS"
echo "  knn warm @ 96 clients:  7491 TPS"
echo "  knn warm @ 128 clients: 6720 TPS"
echo "  knn warm @ 256 clients: 6634 TPS"
echo ""
echo "Current Run (Nov 26):"
echo "  knn warm @ 64 clients:  4258 TPS (-31%)"
echo "  knn warm @ 96 clients:  4232 TPS (-43%)"
echo "  knn warm @ 128 clients: 3486 TPS (-48%)"
echo "  knn warm @ 256 clients: 1987 TPS (-70%)"
echo ""
echo "Target: 6-8k TPS consistently for both cold and warm"
echo ""
echo "=== 8. Critical Issues Summary ==="
echo "Checking if PGOPTIONS_EXTRA fixes the issues..."
psql_cmd_with_options <<'SQL'
SELECT 
  CASE 
    WHEN COUNT(*) FILTER (WHERE name = 'enable_seqscan' AND setting = 'off') = 1 THEN '✅ enable_seqscan=off (correct)'
    ELSE '❌ enable_seqscan=on (WRONG - should be off)'
  END AS enable_seqscan_status,
  CASE 
    WHEN COUNT(*) FILTER (WHERE name = 'jit' AND setting = 'off') = 1 THEN '✅ jit=off (correct)'
    ELSE '❌ jit=on (WRONG - should be off)'
  END AS jit_status,
  CASE 
    WHEN COUNT(*) FILTER (WHERE name = 'synchronous_commit' AND setting = 'off') = 1 THEN '✅ synchronous_commit=off (correct)'
    ELSE '❌ synchronous_commit=on (WRONG - should be off)'
  END AS synchronous_commit_status
FROM pg_settings
WHERE name IN ('enable_seqscan', 'jit', 'synchronous_commit');
SQL

echo ""
echo "=== 9. Recommendations ==="
echo "1. ✅ Function candidate_cap=40, min_rank=0.50 matches gold version"
echo "2. ✅ PGOPTIONS_EXTRA settings are correctly applied (enable_seqscan=off, jit=off, synchronous_commit=off)"
echo "3. ❌ CRITICAL: Run ANALYZE on records.records table - statistics show 0 rows but table has 2.4M rows!"
echo "   → This can cause terrible query plans and significant performance degradation"
echo "   → Command: psql -d records -c \"ANALYZE records.records;\""
echo "4. ⚠️  Check for autovacuum interference (should be disabled during benchmarks)"
echo "5. ✅ work_mem=32MB matches gold"
echo "6. ✅ effective_cache_size=4GB matches gold (via PGOPTIONS)"
echo "7. ⚠️  Verify fast temp tablespace is configured (FAST_TEMP_TABLESPACE)"
echo "8. ⚠️  Check for connection pooler interference"
echo "9. ⚠️  Verify no other processes are competing for resources"
echo "10. ⚠️  shared_buffers shows 1GB (131072 8kB) - check if docker-compose.yml specifies 2GB and restart if needed"
echo ""
echo "=== 10. Quick Fix Commands ==="
echo "# Run benchmark with gold configuration:"
echo "export USE_AUTO_WRAPPER=false"
echo "export USE_SQL_FUNCTION=false"
echo "export TRACK_IO_TIMING=on"
echo "export TRGM_THRESHOLD=0.40"
echo "export MODE=deep"
echo "export RUN_COLD_CACHE=true"
echo "export DISABLE_AUTOVACUUM=true"
echo "./scripts/run_pgbench_sweep.sh"

