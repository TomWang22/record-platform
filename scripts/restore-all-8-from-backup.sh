#!/usr/bin/env bash
# Restore all 8 external Postgres DBs from a hard backup directory (e.g. backups/all-8-20260306-040148).
# Uses .dump (pg_restore) when present, else .sql.gz (gunzip | psql), else .sql (psql -f).
#
# Usage:
#   BACKUP_DIR=backups/all-8-20260306-040148 PGPASSWORD=postgres ./scripts/restore-all-8-from-backup.sh
#   ./scripts/restore-all-8-from-backup.sh backups/all-8-20260306-040148
#   RESTORE_PORTS="5433 5437" BACKUP_DIR=backups/all-8-20260306-040148 ./scripts/restore-all-8-from-backup.sh
#   RESTORE_DB=records BACKUP_DIR=backups/all-8-20260306-040148 ./scripts/restore-all-8-from-backup.sh
#
# Prereqs: Postgres instances on PGHOST:5433–5440 (e.g. Docker Compose). Run ensure-external-databases-created.sh first.
# See docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md and scripts/backup-all-8-dbs.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-${1:-}}"
if [[ -z "$BACKUP_DIR" ]]; then
  echo "Usage: BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS PGPASSWORD=postgres $0" >&2
  echo "   or: $0 backups/all-8-YYYYMMDD-HHMMSS" >&2
  echo "   or: $0 20260306-040148   (uses backups/all-8-20260306-040148)" >&2
  echo "Restore all 8 DBs from a backup directory created by backup-all-8-dbs.sh." >&2
  exit 1
fi
# Allow suffix (e.g. 20260306-040148) -> backups/all-8-20260306-040148
if [[ "$BACKUP_DIR" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
  BACKUP_DIR="$REPO_ROOT/backups/all-8-$BACKUP_DIR"
fi
if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"

# Port → database name (must match backup-all-8-dbs.sh)
declare -A PORT_DB=(
  [5433]=records
  [5434]=social
  [5435]=listings
  [5436]=shopping
  [5437]=auth
  [5438]=postgres
  [5439]=analytics
  [5440]=python_ai
)

if [[ -n "${RESTORE_DB:-}" ]]; then
  RESTORE_PORTS=""
  for p in 5433 5434 5435 5436 5437 5438 5439 5440; do
    [[ "${PORT_DB[$p]}" == "$RESTORE_DB" ]] && RESTORE_PORTS="$p" && break
  done
  [[ -z "$RESTORE_PORTS" ]] && { echo "Unknown RESTORE_DB=$RESTORE_DB" >&2; exit 1; }
fi
PORTS="${RESTORE_PORTS:-5433 5434 5435 5436 5437 5438 5439 5440}"

_psql() {
  local port="$1" db="$2"
  shift 2
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 "$@"
}

_ensure_db() {
  local port="$1" db="$2"
  _psql "$port" postgres -c "SELECT 1 FROM pg_database WHERE datname = '$db';" -tA | grep -q 1 && return 0
  _psql "$port" postgres -c "CREATE DATABASE $db;"
}

_prep_dump_restore() {
  local port="$1" db="$2"
  _ensure_db "$port" "$db"
  _psql "$port" "$db" <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
  _psql "$port" "$db" <<'SQL'
SET search_path = public, pg_catalog;
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;
SQL
}

_restore_one() {
  local port="$1" db="$2" label="${1}-${2}"
  local dump="$BACKUP_DIR/$label.dump" sqlgz="$BACKUP_DIR/$label.sql.gz" sql="$BACKUP_DIR/$label.sql"

  if [[ -f "$dump" ]]; then
    echo "  Restoring $label from .dump (pg_restore)..."
    _prep_dump_restore "$port" "$db"
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --clean --if-exists --no-owner --no-privileges --disable-triggers -j 4 "$dump" 2>/dev/null || \
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --clean --if-exists --no-owner --no-privileges --disable-triggers "$dump" 2>/dev/null || true
    echo "  ✅ $label (dump)"
  elif [[ -f "$sqlgz" ]]; then
    echo "  Restoring $label from .sql.gz..."
    _ensure_db "$port" "$db"
    gunzip -c "$sqlgz" | _psql "$port" "$db" -f - 2>/dev/null || true
    echo "  ✅ $label (sql.gz)"
  elif [[ -f "$sql" ]]; then
    echo "  Restoring $label from .sql..."
    _ensure_db "$port" "$db"
    _psql "$port" "$db" -f "$sql" 2>/dev/null || true
    echo "  ✅ $label (sql)"
  else
    echo "  ⚠️  $label: no $label.dump, $label.sql.gz, or $label.sql in $BACKUP_DIR; skip"
  fi
}

echo "=== Restore all 8 from backup ==="
echo "BACKUP_DIR=$BACKUP_DIR"
echo "PGHOST=$PGHOST"
echo ""

for port in $PORTS; do
  db="${PORT_DB[$port]:-}"
  [[ -z "$db" ]] && continue
  echo "--- $port ($db) ---"
  if ! PGCONNECT_TIMEOUT=3 _psql "$port" postgres -c "SELECT 1;" >/dev/null 2>&1; then
    echo "  ⚠️  Cannot connect to $PGHOST:$port; skip"
    continue
  fi
  _restore_one "$port" "$db"
done

echo ""
echo "Done. Verify: PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md"
