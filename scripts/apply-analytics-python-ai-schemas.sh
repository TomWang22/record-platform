#!/usr/bin/env bash
# Apply analytics (5439), auction_monitor (5438), and python_ai (5440) schemas so
# load-analytics-millions.sh, load-auction-monitor-millions.sh, and load-python-ai-millions.sh
# can run. Creates database 'records' if missing, then runs the schema SQL files.
#
# Usage:
#   ./scripts/apply-analytics-python-ai-schemas.sh
#   PGSQL_VIA_DOCKER=1 ./scripts/apply-analytics-python-ai-schemas.sh   # when Postgres runs in Docker
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ts() { printf '%s' "$(date '+%Y-%m-%d %H:%M:%S')"; }

run_schema() {
  local port="$1"
  local label="$2"
  local sql_file="$3"
  local db_host="${4:-localhost}"
  local db_user="${5:-postgres}"
  local db_pass="${6:-postgres}"

  if [[ ! -f "$sql_file" ]]; then
    echo "$(ts) [SKIP] $label: $sql_file not found." >&2
    return 1
  fi

  if [[ "${PGSQL_VIA_DOCKER:-0}" == "1" ]]; then
    local container
    container="$(docker ps -q --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null | head -1)"
    if [[ -z "$container" ]]; then
      echo "$(ts) [SKIP] $label: No container for port $port. Start Docker Compose (docker compose up -d)." >&2
      return 1
    fi
    echo "$(ts) Applying $label schema (port $port) via container $container..."
    # CREATE DATABASE cannot run inside a transaction; run as standalone command
    if ! docker exec -i "$container" env PGPASSWORD="$db_pass" psql -h 127.0.0.1 -p 5432 -U "$db_user" -d postgres -X -P pager=off -tAc "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
      docker exec -i "$container" env PGPASSWORD="$db_pass" psql -h 127.0.0.1 -p 5432 -U "$db_user" -d postgres -X -P pager=off -c "CREATE DATABASE records;" >/dev/null 2>&1 || true
    fi
    if docker exec -i "$container" env PGPASSWORD="$db_pass" psql -h 127.0.0.1 -p 5432 -U "$db_user" -d records -X -P pager=off < "$sql_file"; then
      echo "$(ts) $label schema applied."
      return 0
    fi
  else
    echo "$(ts) Applying $label schema (port $port)..."
    if ! PGPASSWORD="$db_pass" psql -h "$db_host" -p "$port" -U "$db_user" -d postgres -X -P pager=off -tAc "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
      PGPASSWORD="$db_pass" psql -h "$db_host" -p "$port" -U "$db_user" -d postgres -X -P pager=off -c "CREATE DATABASE records;" >/dev/null 2>&1 || true
    fi
    if PGPASSWORD="$db_pass" psql -h "$db_host" -p "$port" -U "$db_user" -d records -X -P pager=off -f "$sql_file"; then
      echo "$(ts) $label schema applied."
      return 0
    fi
  fi
  echo "$(ts) $label schema apply failed." >&2
  return 1
}

echo "$(ts) === Apply analytics, auction_monitor, and python_ai schemas ==="
echo ""

run_schema 5438 "Auction monitor" "$REPO_ROOT/infra/db/07-auction-monitor-schema.sql" "${AUCTION_MONITOR_DB_HOST:-localhost}" "${AUCTION_MONITOR_DB_USER:-postgres}" "${AUCTION_MONITOR_DB_PASS:-postgres}"
run_schema 5439 "Analytics" "$REPO_ROOT/infra/db/08-analytics-schema.sql" "${ANALYTICS_DB_HOST:-localhost}" "${ANALYTICS_DB_USER:-postgres}" "${ANALYTICS_DB_PASS:-postgres}"
run_schema 5440 "Python AI" "$REPO_ROOT/infra/db/09-python-ai-schema.sql" "${PYTHON_AI_DB_HOST:-localhost}" "${PYTHON_AI_DB_USER:-postgres}" "${PYTHON_AI_DB_PASS:-postgres}"

echo ""
echo "$(ts) Done. To load only these three DBs (auction monitor, analytics, python_ai):"
echo "  PGSQL_VIA_DOCKER=1 SKIP_RECORDS=1 SKIP_AUTH=1 SKIP_SOCIAL=1 SKIP_LISTINGS=1 SKIP_SHOPPING=1 LOAD_SAFE_FOR_COLIMA=1 ./scripts/load-all-dbs-millions.sh"
