#!/usr/bin/env bash
# Dump Postgres version, key GUCs, and table sizes for tuning analysis (e.g. for a Postgres GPT or runbook).
# Use the output log to diagnose TPS issues and suggest infra/db tuning.
# Usage: ./scripts/dump-postgres-tuning-context.sh [output.log]
#   Or: PGPORTS="5433 5436" ./scripts/dump-postgres-tuning-context.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"
# All platform DB ports (records, social, listings, shopping, auth, analytics, auction_monitor, python_ai)
PGPORTS="${PGPORTS:-5433 5434 5435 5436 5437 5438 5439 5440}"
OUTPUT="${1:-}"

if [[ -z "$OUTPUT" ]]; then
  mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
  OUTPUT="$REPO_ROOT/bench_logs/postgres-tuning-context-$(date +%Y%m%d-%H%M%S).log"
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found; install PostgreSQL client. Output would go to $OUTPUT"
  exit 1
fi

echo "Postgres tuning context dump — $(date -Iseconds)" | tee "$OUTPUT"
echo "Host: $PGHOST Ports: $PGPORTS" | tee -a "$OUTPUT"
echo "Output: $OUTPUT" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

GUC_QUERY="
SELECT name, setting, unit, short_desc
FROM pg_settings
WHERE name IN (
  'shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size',
  'max_connections', 'max_parallel_workers_per_gather', 'max_worker_processes', 'max_parallel_workers',
  'random_page_cost', 'effective_io_concurrency', 'default_statistics_target',
  'enable_seqscan', 'enable_indexscan', 'checkpoint_completion_target', 'max_wal_size', 'wal_buffers',
  'autovacuum', 'autovacuum_max_workers', 'autovacuum_naptime', 'temp_buffers'
)
ORDER BY name;
"

TABLE_SIZES_QUERY="
SELECT
  n.nspname || '.' || c.relname AS relation,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 30;
"

for port in $PGPORTS; do
  echo "=== Port $port ===" | tee -a "$OUTPUT"
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -tAc "SELECT version();" >> "$OUTPUT" 2>&1; then
    echo "  (unable to connect)" | tee -a "$OUTPUT"
    echo "" | tee -a "$OUTPUT"
    continue
  fi
  echo "Version:" | tee -a "$OUTPUT"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -tAc "SELECT version();" >> "$OUTPUT" 2>&1 || true
  echo "" | tee -a "$OUTPUT"
  echo "--- Key GUCs ---" | tee -a "$OUTPUT"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -A -F' | ' -c "$GUC_QUERY" >> "$OUTPUT" 2>&1 || true
  echo "" | tee -a "$OUTPUT"
  for db in postgres records; do
    echo "--- Table sizes (db: $db) ---" | tee -a "$OUTPUT"
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -A -F' | ' -c "$TABLE_SIZES_QUERY" >> "$OUTPUT" 2>&1 || true
    echo "" | tee -a "$OUTPUT"
  done
done

echo "Done. Log for Postgres tuning / GPT: $OUTPUT"
