#!/usr/bin/env bash
# Check records DB on port 5433: row count, optional load from backups.
# Usage: ./scripts/check-records-db.sh [--load]
#   --load  If data missing or < 1M rows, try loading from backups/*.sql or backups/*.dump
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECORDS_DB_HOST="${RECORDS_DB_HOST:-localhost}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"
RECORDS_DB_USER="${RECORDS_DB_USER:-postgres}"
RECORDS_DB_NAME="${RECORDS_DB_NAME:-records}"
RECORDS_DB_PASS="${RECORDS_DB_PASS:-postgres}"
DO_LOAD=false
[[ "${1:-}" == "--load" ]] && DO_LOAD=true

psql_check() {
  PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d "$1" -tAc "$2" 2>/dev/null || echo ""
}

ROW_COUNT=0
echo "=== Records DB check (port $RECORDS_DB_PORT) ==="
if ! PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
  echo "❌ Cannot connect to Postgres at $RECORDS_DB_HOST:$RECORDS_DB_PORT"
  echo "   Start Docker Postgres (e.g. docker compose up -d) and ensure port 5433 is published."
  exit 1
fi
echo "✅ Connected to $RECORDS_DB_HOST:$RECORDS_DB_PORT"

DB_EXISTS=$(psql_check postgres "SELECT 1 FROM pg_database WHERE datname = 'records';")
if [[ "$DB_EXISTS" != "1" ]]; then
  echo "⚠️  Database 'records' does not exist"
else
  TABLE_EXISTS=$(PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d records -c "SELECT 1 FROM records.records LIMIT 1;" 2>/dev/null | grep -q 1 && echo "1" || echo "")
  if [[ -z "$TABLE_EXISTS" ]]; then
    echo "⚠️  Table records.records does not exist or is empty"
  else
    ROW_COUNT=$(psql_check records "SELECT count(*) FROM records.records;" | tr -d ' ')
    [[ -z "$ROW_COUNT" ]] || ! [[ "$ROW_COUNT" =~ ^[0-9]+$ ]] && ROW_COUNT=0
    echo "✅ records.records: $ROW_COUNT rows"
  fi
fi

# Optional load from backups
if [[ "$DO_LOAD" == "true" ]] && [[ "$ROW_COUNT" -lt 1000000 ]]; then
  BACKUPS_DIR="${REPO_ROOT}/backups"
  echo "⚠️  Insufficient data ($ROW_COUNT rows). Attempting load from $BACKUPS_DIR ..."
  RESTORED=false
  # Ensure records DB exists before loading (in case only postgres exists)
  if [[ "$DB_EXISTS" != "1" ]]; then
    PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -c "CREATE DATABASE records;" 2>/dev/null || true
  fi
  # Prefer reference backup record-platform-postgres-1-all-*.sql; else any *.sql
  LATEST_SQL=$(find "$BACKUPS_DIR" -maxdepth 1 -name "record-platform-postgres-1-all-*.sql" -type f 2>/dev/null | sort -r | head -1)
  [[ -z "$LATEST_SQL" ]] && LATEST_SQL=$(find "$BACKUPS_DIR" -maxdepth 1 -name "*.sql" -type f 2>/dev/null | sort -r | head -1)
  if [[ -n "$LATEST_SQL" ]] && [[ -f "$LATEST_SQL" ]]; then
    echo "Loading from SQL: $LATEST_SQL"
    if PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
      PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d records -f "$LATEST_SQL" 2>&1 | tail -20
    else
      PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -f "$LATEST_SQL" 2>&1 | tail -20
    fi
    sleep 2
    NEW_ROW_COUNT=$(psql_check records "SELECT count(*) FROM records.records;" | tr -d ' ')
    [[ -z "$NEW_ROW_COUNT" ]] && NEW_ROW_COUNT=0
    if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
      echo "✅ Loaded from SQL: $NEW_ROW_COUNT rows"
      RESTORED=true
    fi
  fi
  if [[ "$RESTORED" != "true" ]] && [[ -f "$REPO_ROOT/scripts/restore-to-external-docker.sh" ]]; then
    LATEST_DUMP=$(find "$BACKUPS_DIR" -maxdepth 1 -name "*.dump" -type f 2>/dev/null | sort -r | head -1)
    if [[ -n "$LATEST_DUMP" ]] && [[ -f "$LATEST_DUMP" ]]; then
      echo "Restoring from dump: $LATEST_DUMP"
      "$REPO_ROOT/scripts/restore-to-external-docker.sh" "$LATEST_DUMP" 2>&1 | tail -20
      sleep 3
      NEW_ROW_COUNT=$(psql_check records "SELECT count(*) FROM records.records;" | tr -d ' ')
      [[ -z "$NEW_ROW_COUNT" ]] && NEW_ROW_COUNT=0
      if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
        echo "✅ Restored from dump: $NEW_ROW_COUNT rows"
        RESTORED=true
      fi
    fi
  fi
  if [[ "$RESTORED" != "true" ]] && [[ -x "$REPO_ROOT/scripts/load-records-millions.sh" ]]; then
    echo "Attempting load via load-records-millions.sh (may take several minutes)..."
    TARGET_ROWS=2500000 BATCH_SIZE=100000 "$REPO_ROOT/scripts/load-records-millions.sh" 2>&1 | tail -20
    NEW_ROW_COUNT=$(psql_check records "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ')
    [[ -z "$NEW_ROW_COUNT" ]] && NEW_ROW_COUNT=0
    if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
      echo "✅ Loaded via load-records-millions.sh: $NEW_ROW_COUNT rows"
      RESTORED=true
    fi
  fi
  if [[ "$RESTORED" != "true" ]]; then
    echo "⚠️  No suitable backup in $BACKUPS_DIR and loader did not reach 1M+ rows. Current rows: $ROW_COUNT"
  fi
fi

if [[ "$ROW_COUNT" -lt 1000000 ]] && [[ "$DO_LOAD" != "true" ]]; then
  echo "💡 To load data: place record-platform-postgres-1-all-*.sql (or *.dump) in backups/ then run: $0 --load"
  echo "   Or run: TARGET_ROWS=2500000 $REPO_ROOT/scripts/load-records-millions.sh (then re-run check or pgbench)"
fi
echo "=== Done ==="
