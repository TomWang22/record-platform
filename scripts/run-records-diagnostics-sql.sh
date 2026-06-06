#!/usr/bin/env bash
# Run records DB diagnostics SQL (pg_settings, pg_stat_bgwriter, pg_stat_checkpointer, schema/index/bloat).
# Output goes to OUT_FILE or bench_logs/records-diagnostics-<timestamp>.txt.
# Usage: [RECORDS_DB_HOST=127.0.0.1] [RECORDS_DB_PORT=5433] [OUT_FILE=...] ./scripts/run-records-diagnostics-sql.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORDS_DB_HOST="${RECORDS_DB_HOST:-127.0.0.1}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"
OUT_FILE="${OUT_FILE:-$REPO_ROOT/bench_logs/records-diagnostics-$(date +%Y%m%d-%H%M%S).txt}"
mkdir -p "$(dirname "$OUT_FILE")"

psql_conn=(-h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U postgres -d records)
export PGPASSWORD="${PGPASSWORD:-postgres}"

{
  echo "=== Records DB diagnostics $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "Host: $RECORDS_DB_HOST Port: $RECORDS_DB_PORT"
  echo ""

  echo "--- server_version ---"
  psql "${psql_conn[@]}" -tAc "SHOW server_version;" 2>/dev/null || echo "(connection failed)"

  echo ""
  echo "--- pg_settings (tuning) ---"
  psql "${psql_conn[@]}" -tA -c "
    SELECT name || ' = ' || setting || COALESCE(' ' || unit, '')
    FROM pg_settings
    WHERE name IN (
      'max_connections','shared_buffers','effective_cache_size','work_mem',
      'maintenance_work_mem','effective_io_concurrency','random_page_cost',
      'seq_page_cost','jit','synchronous_commit','wal_compression',
      'checkpoint_timeout','checkpoint_completion_target','max_wal_size',
      'min_wal_size','wal_buffers','bgwriter_lru_maxpages','bgwriter_lru_multiplier',
      'autovacuum','autovacuum_max_workers','autovacuum_work_mem',
      'autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor',
      'autovacuum_vacuum_cost_limit','autovacuum_vacuum_cost_delay',
      'track_io_timing','shared_preload_libraries'
    )
    ORDER BY name;
  " 2>/dev/null || echo "(query failed)"

  echo ""
  echo "--- pg_stat_bgwriter ---"
  psql "${psql_conn[@]}" -c "SELECT * FROM pg_stat_bgwriter;" 2>/dev/null || echo "(query failed)"

  echo ""
  echo "--- pg_stat_checkpointer ---"
  psql "${psql_conn[@]}" -c "SELECT * FROM pg_stat_checkpointer;" 2>/dev/null || echo "(query failed)"

  echo ""
  echo "--- records schema: table sizes ---"
  psql "${psql_conn[@]}" -c "
    SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname IN ('records','records_hot')
    ORDER BY pg_total_relation_size(c.oid) DESC;
  " 2>/dev/null || echo "(query failed)"

  echo ""
  echo "--- records.records indexes ---"
  psql "${psql_conn[@]}" -c "
    SELECT i.relname AS index_name, pg_size_pretty(pg_relation_size(i.oid)) AS size,
      ix.indisunique, ix.indisprimary, pg_get_indexdef(i.oid) AS def
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE n.nspname = 'records' AND t.relname = 'records'
    ORDER BY pg_relation_size(i.oid) DESC;
  " 2>/dev/null || echo "(query failed)"

  echo ""
  echo "--- pg_stat_user_tables (records, records_hot) ---"
  psql "${psql_conn[@]}" -c "
    SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'records' AND relname IN ('records','records_hot');
  " 2>/dev/null || echo "(query failed)"

} > "$OUT_FILE" 2>&1

echo "✅ Records diagnostics written to: $OUT_FILE"
