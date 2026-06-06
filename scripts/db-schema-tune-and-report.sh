#!/usr/bin/env bash
# Generate DB schema table summary, trigram index recommendations, EXPLAIN ANALYZE per table, and sub-20ms tuning.
# Usage: ./scripts/db-schema-tune-and-report.sh [output.md]
#   With no args writes to docs/DB_SCHEMA_TABLE_AND_TUNING.md. Set APPLY_TRIGRAM=1 to create recommended trigram indexes (dry-run by default).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"
OUTPUT_FILE="${1:-$REPO_ROOT/docs/DB_SCHEMA_TABLE_AND_TUNING.md}"
APPLY_TRIGRAM="${APPLY_TRIGRAM:-0}"

declare -A PORT_DB=(
  [5433]=records
  [5434]=postgres
  [5435]=records
  [5436]=postgres
  [5437]=postgres
  [5438]=postgres
  [5439]=analytics
  [5440]=python_ai
)
declare -A PORT_SVC=(
  [5433]=records
  [5434]=social
  [5435]=listings
  [5436]=shopping
  [5437]=auth
  [5438]=auction_monitor
  [5439]=analytics
  [5440]=python_ai
)

_psql() {
  local port="$1" db="$2"
  shift 2
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -t -A -v ON_ERROR_STOP=1 "$@"
}

# Table list: port, db, schema, table, reltuples
_list_all_tables() {
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    svc="${PORT_SVC[$port]}"
    _psql "$port" "$db" -c "
      SELECT $port, '$db', n.nspname, c.relname, COALESCE(c.reltuples::bigint, -1)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY n.nspname, c.relname;" 2>/dev/null || true
  done
}

# EXPLAIN ANALYZE for SELECT * FROM schema.table LIMIT 1
_explain_one() {
  local port="$1" db="$2" schema="$3" table="$4"
  _psql "$port" "$db" -c "EXPLAIN (ANALYZE, TIMING, FORMAT TEXT) SELECT * FROM \"$schema\".\"$table\" LIMIT 1;" 2>/dev/null || echo "(connect or query error)"
}

# Text columns that are good candidates for trigram (search)
_trigram_candidates() {
  local port="$1" db="$2"
  _psql "$port" "$db" -c "
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      AND data_type IN ('text','character varying','varchar')
      AND character_maximum_length IS NULL OR character_maximum_length > 32
    ORDER BY table_schema, table_name, ordinal_position;" 2>/dev/null || true
}

mkdir -p "$(dirname "$OUTPUT_FILE")"
exec 3>"$OUTPUT_FILE"

echo "# DB schema: table setup, trigram, EXPLAIN ANALYZE, sub-20ms tuning" >&3
echo "" >&3
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ"). Refresh: \`./scripts/db-schema-tune-and-report.sh $OUTPUT_FILE\`" >&3
echo "Host: $PGHOST" >&3
echo "" >&3

# --- 1. Table setup summary (one table) ---
echo "## 1. Table setup summary" >&3
echo "" >&3
echo "| Port | Service | Database | Schema | Table | ~rows |" >&3
echo "|------|---------|----------|--------|-------|-------|" >&3
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port=$(echo "$line" | cut -d'|' -f1)
  db=$(echo "$line" | cut -d'|' -f2)
  schema=$(echo "$line" | cut -d'|' -f3)
  tab=$(echo "$line" | cut -d'|' -f4)
  rows=$(echo "$line" | cut -d'|' -f5)
  svc="${PORT_SVC[$port]:-}"
  echo "| $port | $svc | $db | $schema | $tab | $rows |" >&3
done < <(_list_all_tables)
echo "" >&3

# --- 2. Trigram extension and recommended indexes ---
echo "## 2. Trigram (pg_trgm) for LIKE/ILIKE search" >&3
echo "" >&3
echo "Ensure extension and GIN trigram indexes on text columns used in search (sub-20ms for pattern match)." >&3
echo "" >&3
echo "### Extension (run per database that has text search)" >&3
echo "\`\`\`sql" >&3
echo "CREATE EXTENSION IF NOT EXISTS pg_trgm;" >&3
echo "\`\`\`" >&3
echo "" >&3
echo "### Recommended trigram indexes (create manually or set APPLY_TRIGRAM=1)" >&3
echo "" >&3
for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  db="${PORT_DB[$port]}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    schema=$(echo "$line" | cut -d'|' -f1)
    table=$(echo "$line" | cut -d'|' -f2)
    col=$(echo "$line" | cut -d'|' -f3)
    echo "- **Port $port ($db)** \`$schema.$table\`.\`$col\`:" >&3
    echo "  \`\`\`sql" >&3
    echo "  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_${table}_${col}_trgm ON \"$schema\".\"$table\" USING gin (\"$col\" gin_trgm_ops);  -- pg_trgm extension required" >&3
    echo "  \`\`\`" >&3
    if [[ "$APPLY_TRIGRAM" == "1" ]]; then
      _psql "$port" "$db" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" 2>/dev/null || true
      _psql "$port" "$db" -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_${table}_${col}_trgm ON \"$schema\".\"$table\" USING gin (\"$col\" gin_trgm_ops);" 2>/dev/null && echo "  Applied." >&3 || true
    fi
  done < <(_trigram_candidates "$port" "$db")
done
echo "" >&3

# --- 3. EXPLAIN ANALYZE (sample per table) ---
echo "## 3. EXPLAIN ANALYZE (SELECT * LIMIT 1 per table)" >&3
echo "" >&3
echo "Target: Execution Time < 20 ms for hot path queries. Below: single-row fetch." >&3
echo "" >&3
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port=$(echo "$line" | cut -d'|' -f1)
  db=$(echo "$line" | cut -d'|' -f2)
  schema=$(echo "$line" | cut -d'|' -f3)
  tab=$(echo "$line" | cut -d'|' -f4)
  echo "### Port $port \`$schema.$tab\`" >&3
  echo "\`\`\`" >&3
  _explain_one "$port" "$db" "$schema" "$tab" >&3
  echo "\`\`\`" >&3
  echo "" >&3
done < <(_list_all_tables)

# --- 4. Tuning for sub-20ms ---
echo "## 4. Tuning for sub-20ms execution time" >&3
echo "" >&3
echo "| Setting | Recommended | Purpose |" >&3
echo "|---------|-------------|---------|" >&3
echo "| \`work_mem\` | 32768 kB (32 MB) | Per-query sort/hash; avoid disk for small-medium queries |" >&3
echo "| \`random_page_cost\` | 0.8 | SSD; prefer index scans |" >&3
echo "| \`effective_cache_size\` | 524288 (8kB) = 4 GB | Planner assumes this much cache |" >&3
echo "| \`shared_buffers\` | 131072 (8kB) = 1 GB | Hot data in RAM |" >&3
echo "| \`default_statistics_target\` | 100 | Better plans for large tables |" >&3
echo "| \`pg_trgm\` GIN indexes | On text search columns | Fast ILIKE/like for sub-20ms |" >&3
echo "" >&3
echo "Apply instance tuning: \`infra/db/comprehensive-db-tuning.sql\`, \`infra/db/service-specific-tuning.sql\`. Per-session: \`SET work_mem = '32MB';\`." >&3
echo "" >&3

exec 3>&-
echo "Wrote $OUTPUT_FILE"
