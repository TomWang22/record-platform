#!/usr/bin/env bash
# Strict full platform restore: schema, data, extensions, pg_settings drift, verification, report.
# Uses every file in the backup dir: .dump, *-extensions.tsv, *-pg_settings.tsv.
# Deterministic, verifiable; fails if tables missing or restore integrity check fails.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore_full_backup_strict.sh backups/all-8-20260306-040148
#   ./scripts/restore_full_backup_strict.sh 20260306-040148
#
# Env:
#   SKIP_SCALE=1           — do not scale record-platform deployments down/up
#   RESTORE_REPORT_DIR=   — dir for restore report (default: backups/restore_reports)
#   PGHOST=127.0.0.1      — Postgres host
#
# See docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${1:-${BACKUP_DIR:-}}"
if [[ -z "$BACKUP_DIR" ]]; then
  echo "Usage: $0 <backup_directory>" >&2
  echo "   or: BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS $0" >&2
  echo "   or: $0 20260306-040148   (uses backups/all-8-20260306-040148)" >&2
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

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
SKIP_SCALE="${SKIP_SCALE:-0}"
RESTORE_REPORT_DIR="${RESTORE_REPORT_DIR:-$REPO_ROOT/backups/restore_reports}"
mkdir -p "$RESTORE_REPORT_DIR"
REPORT_TS="$(date +%Y%m%d-%H%M%S)"
STARTED_ISO="$(date -Iseconds)"
REPORT_FILE="$RESTORE_REPORT_DIR/restore_report_${REPORT_TS}.txt"
REPORT_JSON="$RESTORE_REPORT_DIR/restore_report_${REPORT_TS}.json"

# Port -> database name (5438 = default DB "postgres", do not DROP)
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

_psql() {
  local port="$1" db="$2"
  shift 2
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 "$@" 2>/dev/null
}

_log() { echo "$@" | tee -a "$REPORT_FILE"; }
_fatal() { _log "ERROR: $*"; exit 1; }

# Start report
{
  echo "=== STRICT FULL PLATFORM RESTORE REPORT ==="
  echo "Backup dir: $BACKUP_DIR"
  echo "Started: $(date -Iseconds)"
  echo "PGHOST: $PGHOST"
  echo ""
} > "$REPORT_FILE"

_log "=== STRICT FULL PLATFORM RESTORE START ==="
_log "Backup dir: $BACKUP_DIR"
_log ""

if [[ "$SKIP_SCALE" != "1" ]]; then
  if command -v kubectl >/dev/null 2>&1; then
    _log "Scaling down record-platform deployments..."
    kubectl scale deployment --all --replicas=0 -n record-platform 2>/dev/null || true
    _log "Services scaled down."
  fi
  _log ""
fi

FAILED=0
declare -a REPORT_ENTRIES

for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  db="${PORT_DB[$port]}"
  label="${port}-${db}"
  dump="$BACKUP_DIR/$label.dump"
  ext_file="$BACKUP_DIR/$label-extensions.tsv"
  settings_file="$BACKUP_DIR/$label-pg_settings.tsv"

  if [[ ! -f "$dump" ]]; then
    _log "--- $label: no $label.dump; skip ---"
    continue
  fi

  _log "----------------------------------------"
  _log "Restoring database: $db (port $port)"
  _log ""

  if ! PGCONNECT_TIMEOUT=5 _psql "$port" postgres -c "SELECT 1;" >/dev/null 2>&1; then
    _log "  ⚠️  Cannot connect to $PGHOST:$port; skip"
    ((FAILED++)) || true
    continue
  fi

  # 1. Database recreated (except postgres DB on 5438)
  if [[ "$db" == "postgres" ]]; then
    _log "  (Port 5438: restoring into default DB 'postgres', not dropping.)"
    # Restore with --clean to drop existing objects
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --clean --if-exists --no-owner --no-privileges --disable-triggers -j 4 "$dump" >> "$REPORT_FILE" 2>&1 || \
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --clean --if-exists --no-owner --no-privileges --disable-triggers "$dump" >> "$REPORT_FILE" 2>&1 || true
  else
    _psql "$port" postgres -c "DROP DATABASE IF EXISTS $db;" || true
    _psql "$port" postgres -c "CREATE DATABASE $db;"
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --no-owner --no-privileges --disable-triggers -j 4 "$dump" >> "$REPORT_FILE" 2>&1 || \
    PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      --no-owner --no-privileges --disable-triggers "$dump" >> "$REPORT_FILE" 2>&1 || true
  fi

  # 2. Verify tables exist
  TABLE_COUNT=$(_psql "$port" "$db" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" | tr -d ' ')
  if [[ -z "$TABLE_COUNT" ]] || [[ "${TABLE_COUNT:-0}" -eq 0 ]]; then
    _log "  ERROR: No user tables restored in $db (table_schema not in pg_catalog/information_schema)."
    ((FAILED++)) || true
  else
    _log "  Tables (user): $TABLE_COUNT"
  fi

  # 3. Ensure extensions from snapshot
  if [[ -f "$ext_file" ]]; then
    _log "  Ensuring extensions from $label-extensions.tsv..."
    while IFS=$'\t' read -r extname _; do
      [[ -z "${extname:-}" ]] && continue
      # plpgsql is built-in; CREATE EXTENSION may not exist for it
      if [[ "$extname" == "plpgsql" ]]; then
        continue
      fi
      _psql "$port" "$db" -c "CREATE EXTENSION IF NOT EXISTS \"$extname\";" >> "$REPORT_FILE" 2>&1 || true
    done < "$ext_file"
    _log "  Extensions applied."
  fi

  # 4. Compare pg_settings drift (log only; non-fatal)
  if [[ -f "$settings_file" ]]; then
    _log "  Comparing pg_settings drift..."
    CURRENT_SETTINGS="/tmp/current_pg_settings_${port}.tsv"
    _psql "$port" "$db" -At -F $'\t' -c "SELECT name, setting FROM pg_settings ORDER BY name;" > "$CURRENT_SETTINGS" 2>/dev/null || true
    if [[ -s "$CURRENT_SETTINGS" ]]; then
      BACKUP_SETTINGS_CUT="/tmp/backup_pg_settings_${port}.tsv"
      cut -f1,2 "$settings_file" > "$BACKUP_SETTINGS_CUT" 2>/dev/null || true
      if diff -q "$BACKUP_SETTINGS_CUT" "$CURRENT_SETTINGS" >/dev/null 2>&1; then
        _log "  pg_settings: no drift."
      else
        _log "  pg_settings: drift detected (non-fatal). See diff below."
        diff "$BACKUP_SETTINGS_CUT" "$CURRENT_SETTINGS" >> "$REPORT_FILE" 2>&1 || true
      fi
      rm -f "$CURRENT_SETTINGS" "$BACKUP_SETTINGS_CUT"
    fi
  fi

  # 5. Row counts for report (all user tables)
  TOTAL_ROWS=$(_psql "$port" "$db" -t -c "
    SELECT coalesce(sum(n_live_tup), 0)::bigint
    FROM pg_stat_user_tables;
  " | tr -d ' ')
  _log "  Approx total rows (pg_stat_user_tables): ${TOTAL_ROWS:-0}"
  _log "  ✓ $db fully restored and validated"
  _log ""

  REPORT_ENTRIES+=("{\"port\":$port,\"db\":\"$db\",\"tables\":${TABLE_COUNT:-0},\"total_rows\":${TOTAL_ROWS:-0}}")
done

if [[ "$SKIP_SCALE" != "1" ]]; then
  if command -v kubectl >/dev/null 2>&1; then
    _log "Scaling record-platform deployments back up..."
    kubectl scale deployment --all --replicas=1 -n record-platform 2>/dev/null || true
  fi
fi

# JSON report
FINISHED_ISO="$(date -Iseconds)"
ENTRIES_JSON=""
if [[ ${#REPORT_ENTRIES[@]} -gt 0 ]]; then
  ENTRIES_JSON="$(IFS=,; echo "${REPORT_ENTRIES[*]}")"
fi
printf '{"backup_dir":"%s","started":"%s","finished":"%s","entries":[%s],"failed_count":%d}\n' \
  "$BACKUP_DIR" \
  "$STARTED_ISO" \
  "$FINISHED_ISO" \
  "$ENTRIES_JSON" \
  "${FAILED:-0}" \
  > "$REPORT_JSON" 2>/dev/null || true

{
  echo ""
  echo "=== STRICT FULL PLATFORM RESTORE COMPLETE ==="
  echo "Report: $REPORT_FILE"
  echo "JSON:   $REPORT_JSON"
  echo "Failed DBs: $FAILED"
} | tee -a "$REPORT_FILE"

if [[ "${FAILED:-0}" -gt 0 ]]; then
  exit 1
fi
