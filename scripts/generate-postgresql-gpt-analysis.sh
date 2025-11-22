#!/usr/bin/env bash
set -euo pipefail

# Generate comprehensive analysis for PostgreSQL GPT
# Creates analysis files that can be sent to PostgreSQL GPT for tuning recommendations

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUTPUT_DIR="$ROOT/docs/postgresql-gpt-analysis/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Generating PostgreSQL GPT Analysis Files ==="

# Helper function to run analysis
run_analysis() {
  local db_name=$1
  local port=$2
  local schema_filter=$3
  
  say "Analyzing $db_name database (port $port)..."
  
  PGPASSWORD=postgres psql \
    -h localhost -p "$port" -U postgres -d records \
    -X -P pager=off \
    -o "$OUTPUT_DIR/${db_name}-analysis.txt" <<'SQL'
\echo '================================================================================'
\echo '=== POSTGRESQL GPT ANALYSIS FOR ' || current_database() || ' ==='
\echo '================================================================================'
\echo ''
\echo 'Generated: ' || now()::text
\echo ''

\echo '=== 1. DATABASE OVERVIEW ==='
SELECT 
  current_database() AS database,
  version() AS postgres_version,
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

\echo ''
\echo '=== 2. TABLE STATISTICS ==='
SELECT 
  schemaname,
  tablename,
  n_live_tup AS row_count,
  n_dead_tup AS dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) AS total_size,
  pg_size_pretty(pg_relation_size((schemaname||'.'||tablename)::regclass)) AS table_size,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass) - 
                 pg_relation_size((schemaname||'.'||tablename)::regclass)) AS index_size
FROM pg_stat_user_tables
ORDER BY schemaname, pg_total_relation_size((schemaname||'.'||tablename)::regclass) DESC;

\echo ''
\echo '=== 3. INDEX STATISTICS ==='
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) AS size,
  CASE 
    WHEN idx_scan = 0 THEN 'UNUSED'
    WHEN idx_scan < 10 THEN 'RARELY_USED'
    ELSE 'ACTIVE'
  END AS usage_status
FROM pg_stat_user_indexes
ORDER BY pg_relation_size((schemaname||'.'||indexname)::regclass) DESC
LIMIT 50;

\echo ''
\echo '=== 4. POSTGRESQL CONFIGURATION (Performance Settings) ==='
SELECT name, setting, unit, source, context
FROM pg_settings
WHERE name IN (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'enable_seqscan',
  'jit',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'track_io_timing',
  'effective_io_concurrency',
  'checkpoint_completion_target',
  'max_wal_size',
  'synchronous_commit',
  'max_connections',
  'max_worker_processes'
)
ORDER BY name;

\echo ''
\echo '=== 5. EXTENSIONS INSTALLED ==='
SELECT extname, extversion
FROM pg_extension
ORDER BY extname;

\echo ''
\echo '=== 6. DATABASE SIZE BREAKDOWN ==='
SELECT 
  schemaname,
  pg_size_pretty(SUM(pg_total_relation_size((schemaname||'.'||tablename)::regclass))) AS total_size
FROM pg_stat_user_tables
GROUP BY schemaname
ORDER BY SUM(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) DESC;

\echo ''
\echo '================================================================================'
\echo '=== END OF ANALYSIS ==='
\echo '================================================================================'
SQL

  ok "Analysis saved to: $OUTPUT_DIR/${db_name}-analysis.txt"
}

# Run analysis for each database
run_analysis "main" "5433" "records,records_hot,auth,analytics"
run_analysis "social" "5434" "forum,messages"
run_analysis "listings" "5435" "listings"

say "✅ All analysis files generated!"
say "📁 Output directory: $OUTPUT_DIR"
say ""
say "Next steps:"
say "  1. Review analysis files in: $OUTPUT_DIR"
say "  2. Run EXPLAIN (ANALYZE, BUFFERS) for key queries"
say "  3. Send analysis + schema files to PostgreSQL GPT"
say "  4. Reference: Target scale is 2.4M rows (not 1.2M)"

