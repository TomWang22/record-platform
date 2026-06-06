#!/usr/bin/env bash
# Restore RP runtime Postgres (host ports 5433–5443) from hybrid manifest or restore-ready/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${1:-}"
[[ -d "$BACKUP_DIR" ]] || { echo "Usage: $0 <backup-dir>" >&2; exit 1; }

if [[ -f "$BACKUP_DIR/manifest.json" ]]; then
  exec "$SCRIPT_DIR/restore-rp-hybrid-backup.sh" "$BACKUP_DIR"
fi

READY="$BACKUP_DIR"
[[ -d "$BACKUP_DIR/restore-ready" ]] && READY="$BACKUP_DIR/restore-ready"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

declare -A PORT_DB=(
  [5433]=records [5434]=messaging [5435]=listings [5436]=shopping [5437]=auth
  [5438]=postgres [5439]=analytics [5440]=python_ai [5441]=notification
  [5442]=trust [5443]=media
)

# Must match backup-rp-postgres-dbs.sh PORT_LABEL (filename slug ≠ DB name)
declare -A PORT_LABEL=(
  [5438]=auction-monitor-core
  [5440]=python-ai
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

och_terminate_db_sessions() {
  psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=0 -q -t -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$2' AND pid <> pg_backend_pid();" 2>/dev/null || true
}

say "=== Restore RP runtime Postgres from $READY ==="
echo "restore booking: skipped"
echo "restore social: skipped (5434 is messaging)"

for port in 5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443; do
  db="${PORT_DB[$port]}"
  slug="${PORT_LABEL[$port]:-$db}"
  dump="$READY/${port}-${slug}.dump"
  sqlgz="$READY/${port}-${slug}.sql.gz"
  if [[ -f "$dump" ]]; then
    echo "Restoring $db @ $port from $(basename "$dump")"
    och_terminate_db_sessions "$port" "$db"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$db\";"
    if [[ "$port" == "5439" ]]; then
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || \
        warn "analytics: pgvector extension unavailable — restore may skip listing_search_index"
    fi
    pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" --no-owner --no-privileges "$dump" 2>/dev/null || true
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "ANALYZE;" 2>/dev/null || true
    ok "$db:$port"
  elif [[ -f "$sqlgz" ]]; then
    och_terminate_db_sessions "$port" "$db"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$db\";"
    if [[ "$port" == "5439" ]]; then
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || \
        warn "analytics: pgvector extension unavailable — restore may skip listing_search_index"
    fi
    gunzip -c "$sqlgz" | psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" 2>/dev/null || true
    ok "$db:$port"
  fi
done
say "Done."
