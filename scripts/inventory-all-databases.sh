#!/usr/bin/env bash
# Inventory all 8 PostgreSQL instances (ports 5433–5440): databases, schemas, tables, row counts.
# Writes a full log and a clear mapping so we know what each port has and which service uses it.
#
# Usage: ./scripts/inventory-all-databases.sh [OUTPUT_DIR]
#   OUTPUT_DIR defaults to ./bench_logs/db-inventory-YYYYMMDD-HHMMSS (or /tmp/db-inventory-* if bench_logs missing)
#
# Requires: psql, PGPASSWORD=postgres (or set PGPASSWORD), host access to localhost:5433–5440

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# Port → service name (Docker Compose / logical name)
declare -A PORT_SERVICE
PORT_SERVICE[5433]=records
PORT_SERVICE[5434]=social
PORT_SERVICE[5435]=listings
PORT_SERVICE[5436]=shopping
PORT_SERVICE[5437]=auth
PORT_SERVICE[5438]=auction-monitor
PORT_SERVICE[5439]=analytics
PORT_SERVICE[5440]=python-ai

# Port → intended DB name (from app-config / EIGHT-DATABASES-ARCHITECTURE.md)
declare -A PORT_INTENDED_DB
PORT_INTENDED_DB[5433]=records
PORT_INTENDED_DB[5434]=records
PORT_INTENDED_DB[5435]=records
PORT_INTENDED_DB[5436]=shopping
PORT_INTENDED_DB[5437]=auth
PORT_INTENDED_DB[5438]=postgres
PORT_INTENDED_DB[5439]=analytics
PORT_INTENDED_DB[5440]=python_ai

# Port → env var used by apps
declare -A PORT_ENV
PORT_ENV[5433]=POSTGRES_URL_RECORDS
PORT_ENV[5434]=POSTGRES_URL_SOCIAL
PORT_ENV[5435]=POSTGRES_URL_LISTINGS
PORT_ENV[5436]=POSTGRES_URL_SHOPPING
PORT_ENV[5437]=POSTGRES_URL_AUTH
PORT_ENV[5438]=POSTGRES_URL_AUCTION_MONITOR
PORT_ENV[5439]=POSTGRES_URL_ANALYTICS
PORT_ENV[5440]=POSTGRES_URL_PYTHON_AI

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# Output directory
OUTPUT_DIR="${1:-}"
if [[ -z "$OUTPUT_DIR" ]]; then
  if [[ -d "$REPO_ROOT/bench_logs" ]]; then
    OUTPUT_DIR="$REPO_ROOT/bench_logs/db-inventory-$(date +%Y%m%d-%H%M%S)"
  else
    OUTPUT_DIR="/tmp/db-inventory-$(date +%Y%m%d-%H%M%S)"
  fi
fi
mkdir -p "$OUTPUT_DIR"
FULL_LOG="$OUTPUT_DIR/full.log"
MAPPING_LOG="$OUTPUT_DIR/mapping.txt"
SUMMARY_LOG="$OUTPUT_DIR/summary.txt"

# Run psql for a given port and database (optional -d); output to stdout; errors to stderr
_psql() {
  local port="$1"
  local db="${2:-postgres}"
  shift 2
  PGCONNECT_TIMEOUT="$PGCONNECT_TIMEOUT" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=0 "$@" 2>&1
}

# List databases on a port (connect to postgres)
_list_dbs() {
  local port="$1"
  _psql "$port" postgres -tAc "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;"
}

# List user schemas in a database (excluding pg_*, information_schema)
_list_schemas() {
  local port="$1"
  local db="$2"
  _psql "$port" "$db" -tAc "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY nspname;"
}

# List tables with approximate row count (pg_stat_user_tables) for a DB
_list_tables_with_rows() {
  local port="$1"
  local db="$2"
  _psql "$port" "$db" -tAc "
    SELECT schemaname || '.' || relname AS table_name, n_live_tup::bigint AS approx_rows
    FROM pg_stat_user_tables
    ORDER BY schemaname, relname;"
}

# Full table list (schemaname, relname) for a DB
_list_tables() {
  local port="$1"
  local db="$2"
  _psql "$port" "$db" -tAc "
    SELECT schemaname, relname
    FROM pg_stat_user_tables
    ORDER BY schemaname, relname;"
}

# Single-line summary per DB: db_name, schema_count, table_count, total_approx_rows
_db_summary() {
  local port="$1"
  local db="$2"
  _psql "$port" "$db" -tAc "
    SELECT
      (SELECT count(DISTINCT schemaname) FROM pg_stat_user_tables) AS schemas,
      (SELECT count(*) FROM pg_stat_user_tables) AS tables,
      (SELECT coalesce(sum(n_live_tup), 0)::bigint FROM pg_stat_user_tables) AS approx_rows;"
}

main() {
  {
    say "=== All 8 Databases Inventory ==="
    info "Host: $PGHOST, ports: 5433–5440"
    info "Full log: $FULL_LOG"
    info "Mapping: $MAPPING_LOG"
    info "Summary: $SUMMARY_LOG"
  } | tee -a "$FULL_LOG"

  echo "Port | Service | Intended DB | Env | Databases on instance" > "$MAPPING_LOG"
  echo "-----|---------|-------------|-----|----------------------" >> "$MAPPING_LOG"

  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    service="${PORT_SERVICE[$port]:-?}"
    intended="${PORT_INTENDED_DB[$port]:-?}"
    env_var="${PORT_ENV[$port]:-?}"

    say "Port $port — $service (intended DB: $intended, $env_var)"
    { echo ""; echo "=== Port $port — $service ==="; echo "Intended DB: $intended | Env: $env_var"; echo ""; } >> "$FULL_LOG"

    if ! PGCONNECT_TIMEOUT="$PGCONNECT_TIMEOUT" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -tAc "SELECT 1;" >/dev/null 2>&1; then
      warn "Port $port: connection failed"
      echo "Port $port: CONNECTION FAILED" >> "$FULL_LOG"
      continue
    fi
    ok "Port $port: connected"

    dbs=$(_list_dbs "$port" 2>/dev/null | tr -d '\r' || true)
    if [[ -z "$dbs" ]]; then
      info "Port $port: no non-template databases (or error)"
      echo "Port $port: no DBs or error" >> "$FULL_LOG"
      continue
    fi

    while IFS= read -r db; do
      [[ -z "$db" ]] && continue
      echo "--- Database: $db ---" >> "$FULL_LOG"
      schemas=$(_list_schemas "$port" "$db" 2>/dev/null | tr -d '\r' || true)
      tables_out=$(_list_tables_with_rows "$port" "$db" 2>/dev/null || true)
      summary=$(_db_summary "$port" "$db" 2>/dev/null | tr -d '\r' || true)

      _schemas_comma=$(echo "$schemas" | tr '\n' ',' | sed 's/,$//')
      echo "Schemas: $_schemas_comma" >> "$FULL_LOG"
      echo "Tables (approx rows):" >> "$FULL_LOG"
      echo "$tables_out" >> "$FULL_LOG"
      echo "Summary: $summary" >> "$FULL_LOG"
      echo "" >> "$FULL_LOG"

      # Short summary to stdout (comma-separated schemas)
      info "  DB '$db': schemas=[$_schemas_comma], $summary (schemas, tables, approx_rows)"
    done <<< "$dbs"

    # Per-port detail for mapping (DBs on one line)
    _dbs_line=$(echo "$dbs" | tr '\n' ',' | sed 's/,$//')
    echo "$port | $service | $intended | $env_var | DBs: $_dbs_line" >> "$MAPPING_LOG"
  done

  # Summary table
  {
    say "=== Mapping (Port → Service → Intended DB → Env) ==="
    echo "Port  | Service         | Intended DB   | Env"
    echo "------|-----------------|---------------|------------------------------"
    for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
      service="${PORT_SERVICE[$port]:-?}"
      intended="${PORT_INTENDED_DB[$port]:-?}"
      env_var="${PORT_ENV[$port]:-?}"
      printf " %4s | %-15s | %-13s | %s\n" "$port" "$service" "$intended" "$env_var"
    done
  } | tee -a "$FULL_LOG" | tee "$SUMMARY_LOG"

  {
    echo ""
    say "=== What each service uses (from app-config) ==="
    echo "5433  records-service      POSTGRES_URL_RECORDS   → 5433/records"
    echo "5434  social-service       POSTGRES_URL_SOCIAL    → 5434/records"
    echo "5435  listings-service     POSTGRES_URL_LISTINGS   → 5435/records"
    echo "5436  shopping-service     POSTGRES_URL_SHOPPING   → 5436/shopping"
    echo "5437  auth-service         POSTGRES_URL_AUTH      → 5437/auth"
    echo "5438  auction-monitor      POSTGRES_URL_AUCTION_MONITOR → 5438/postgres"
    echo "5439  analytics-service    POSTGRES_URL_ANALYTICS → 5439/analytics"
    echo "5440  python-ai-service    POSTGRES_URL_PYTHON_AI → 5440/python_ai"
    echo ""
    echo "Full per-DB detail: $FULL_LOG"
    echo "Mapping lines: $MAPPING_LOG"
  } | tee -a "$FULL_LOG" >> "$SUMMARY_LOG"

  ok "Inventory complete. Logs: $OUTPUT_DIR"
}

main "$@"
