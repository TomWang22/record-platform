#!/usr/bin/env bash
# Apply cold benchmark tuning to all 8 external Postgres instances: jit=off, synchronous_commit=off,
# and gold planner/connection defaults. Raw Postgres only (no pgbouncer). For true cold measurements,
# restart each Postgres (or the host) first, then run this script, then run pgbench.
#
# Usage: ./scripts/apply-cold-pg-tuning.sh
#   PGHOST=127.0.0.1  PGUSER=postgres  PGPASSWORD=postgres
#   DRY_RUN=1  print SQL only, do not run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DRY_RUN="${DRY_RUN:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
info(){ echo "ℹ️  $*"; }

_psql() { psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d "$2" -v ON_ERROR_STOP=1 "$@" 2>/dev/null; }

# Port -> database name (same as seed script / run_pgbench_sweep)
declare -A PORT_DB=( [5433]=records [5434]=records [5435]=records [5436]=shopping [5437]=auth [5438]=postgres [5439]=analytics [5440]=python_ai )

apply_one() {
  local port=$1 db=${PORT_DB[$port]}
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY RUN] would apply cold tuning to $port/$db"
    return 0
  fi
  _psql "$port" "$db" <<'SQL'
-- Cold benchmark tuning: no pgbouncer, raw Postgres. Matches PGOPTIONS used in run_pgbench_sweep.
-- Critical: jit=off, synchronous_commit=off (disable sync WAL for benchmark TPS).
DO $$
DECLARE
  db text := current_database();
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', db);
  EXECUTE format('ALTER DATABASE %I SET synchronous_commit = off', db);
  EXECUTE format('ALTER DATABASE %I SET random_page_cost = 1.1', db);
  EXECUTE format('ALTER DATABASE %I SET effective_cache_size = %L', db, '4GB');
  EXECUTE format('ALTER DATABASE %I SET work_mem = %L', db, '32MB');
  EXECUTE format('ALTER DATABASE %I SET maintenance_work_mem = %L', db, '512MB');
  EXECUTE format('ALTER DATABASE %I SET effective_io_concurrency = 200', db);
  EXECUTE format('ALTER DATABASE %I SET max_parallel_workers_per_gather = 4', db);
  EXECUTE format('ALTER DATABASE %I SET max_parallel_workers = 12', db);
  EXECUTE format('ALTER DATABASE %I SET cpu_index_tuple_cost = 0.0005', db);
  EXECUTE format('ALTER DATABASE %I SET cpu_tuple_cost = 0.01', db);
  RAISE NOTICE 'Cold tuning (jit=off, synchronous_commit=off, gold planner) applied for %', db;
END $$;
SQL
  ok "Cold tuning applied to $port/$db"
}

main() {
  say "Applying cold PG tuning (jit=off, synchronous_commit=off, raw – no pgbouncer) to all 8 instances"
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    apply_one "$port" || info "Skip or fail $port"
  done
  say "Done. For true cold benchmarks: restart Postgres (or container) first, then run pgbench."
}

main "$@"
