#!/usr/bin/env bash
# Record Platform Postgres backup — 11 DBs on host ports 5433–5443.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/backup-rp-postgres-dbs.sh
#
# Output: backups/rp-all-11-YYYYMMDD-HHMMSS/
#   Per DB (6 files): .dump, .sql.gz, -extensions.tsv, -pg_settings.tsv,
#   -table-counts.tsv, -schemas.tsv
#
# Local partial dev (skip unreachable DBs):
#   ALLOW_BACKUP_SKIPS=1 ./scripts/backup-rp-postgres-dbs.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
TS="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_BASE="${BACKUP_DIR:-$REPO_ROOT/backups}"
OUTDIR="$BACKUP_BASE/rp-all-11-$TS"
PARALLEL_JOBS="${PG_DUMP_JOBS:-4}"
USE_PG_DOCKER="${USE_PG_DOCKER:-}"
ALLOW_BACKUP_SKIPS="${ALLOW_BACKUP_SKIPS:-0}"
EXPECTED_DBS=11
META_SUFFIXES=(extensions pg_settings table-counts schemas)

# Port → actual Postgres database name (verified via docker exec / compose)
declare -A PORT_DB=(
  [5433]=records
  [5434]=messaging
  [5435]=listings
  [5436]=shopping
  [5437]=auth
  [5438]=postgres
  [5439]=analytics
  [5440]=python_ai
  [5441]=notification
  [5442]=trust
  [5443]=media
)

# Human-friendly output label (filename / manifest); may differ from DB name
declare -A PORT_LABEL=(
  [5438]=auction-monitor-core
  [5440]=python-ai
)

PORTS=(5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443)

PGHOST_FOR_DOCKER="${PGHOST_FOR_DOCKER:-}"
if [[ -z "$PGHOST_FOR_DOCKER" ]]; then
  if [[ "$PGHOST" == "127.0.0.1" ]] || [[ "$PGHOST" == "localhost" ]]; then
    PGHOST_FOR_DOCKER="host.docker.internal"
  else
    PGHOST_FOR_DOCKER="$PGHOST"
  fi
fi

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1; then
    USE_PG_DOCKER=1
  else
    echo "❌ pg_dump and psql required (e.g. brew install libpq), or Docker." >&2
    exit 1
  fi
fi

mkdir -p "$OUTDIR"
MANIFEST="$OUTDIR/manifest.txt"
FAILURES=0
SKIPS=0

_run_psql() {
  local port="$1" db="$2" query="$3"
  docker run --rm \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:16-alpine \
    psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc "$query"
}

_run_psql_local() {
  local port="$1" db="$2" query="$3"
  PGCONNECT_TIMEOUT=5 psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc "$query"
}

_psql() {
  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    _run_psql "$@"
  else
    _run_psql_local "$@"
  fi
}

_check_db_exists() {
  local port="$1"
  local db="$2"
  if ! _psql "$port" postgres "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -qx "1"; then
    echo "❌ DB '$db' not found on port $port. Available DBs:" >&2
    _psql "$port" postgres "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1" >&2 || true
    return 1
  fi
}

_can_connect_db() {
  local port="$1"
  local db="$2"
  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" postgres:16-alpine \
      psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -c "SELECT 1;" >/dev/null 2>&1
  else
    PGCONNECT_TIMEOUT=5 psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "SELECT 1;" >/dev/null 2>&1
  fi
}

{
  echo "Record Platform Postgres backup — 11 DBs — $TS"
  echo "Host: $PGHOST"
  echo "Started: $(date -Iseconds)"
  echo ""
} > "$MANIFEST"

_dump_one() {
  local port="$1"
  local db="${PORT_DB[$port]}"
  local display="${PORT_LABEL[$port]:-$db}"
  local label="${port}-${display}"
  local out="$OUTDIR/$label"
  local basename_dump="$label.dump"
  local basename_sql="$label.sql"

  if ! _check_db_exists "$port" "$db"; then
    if [[ "$ALLOW_BACKUP_SKIPS" == "1" ]]; then
      echo "⚠️  $label: skip (DB '$db' missing)"
      echo "skip $label (db missing)" >> "$MANIFEST"
      SKIPS=$((SKIPS + 1))
      return 0
    fi
    echo "❌ $label: database '$db' not found on port $port" >&2
    FAILURES=$((FAILURES + 1))
    echo "fail $label (db missing)" >> "$MANIFEST"
    return 0
  fi

  local attempt connected=0
  for attempt in 1 2 3; do
    if _can_connect_db "$port" "$db"; then
      connected=1
      break
    fi
    sleep 2
  done

  if [[ "$connected" -ne 1 ]]; then
    if [[ "$ALLOW_BACKUP_SKIPS" == "1" ]]; then
      echo "⚠️  $label: skip (cannot connect to DB '$db')"
      echo "skip $label (connect failed)" >> "$MANIFEST"
      SKIPS=$((SKIPS + 1))
      return 0
    fi
    echo "❌ $label: cannot connect to DB '$db' on port $port" >&2
    FAILURES=$((FAILURES + 1))
    echo "fail $label (connect failed)" >> "$MANIFEST"
    return 0
  fi

  echo "Backing up $label (db=$db) ..."

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fc -j "$PARALLEL_JOBS" \
        --no-owner --no-privileges -f "/backup/$basename_dump" 2>/dev/null || \
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fc \
        --no-owner --no-privileges -f "/backup/$basename_dump"
  else
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      -Fc -j "$PARALLEL_JOBS" --no-owner --no-privileges -f "${out}.dump" 2>/dev/null || \
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      -Fc --no-owner --no-privileges -f "${out}.dump"
  fi

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      sh -c "pg_dump -h $PGHOST_FOR_DOCKER -p $port -U $PGUSER -d $db -Fp --no-owner --no-privileges | gzip -9 > /backup/$basename_sql.gz"
  else
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges 2>/dev/null | gzip -9 > "${out}.sql.gz"
  fi

  if [[ "${BACKUP_PLAIN_SQL:-0}" == "1" ]]; then
    if [[ "${USE_PG_DOCKER}" == "1" ]]; then
      docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
        pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "/backup/$basename_sql"
    else
      pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "${out}.sql" 2>/dev/null || true
    fi
  fi

  _psql "$port" "$db" "SELECT name||E'\t'||setting||E'\t'||source FROM pg_settings ORDER BY name" > "${out}-pg_settings.tsv"
  _psql "$port" "$db" "SELECT extname||E'\t'||extversion FROM pg_extension ORDER BY 1" > "${out}-extensions.tsv"
  _psql "$port" "$db" "SELECT schemaname||E'\t'||tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename" > "${out}-schemas.tsv"
  _psql "$port" "$db" "SELECT schemaname||E'\t'||relname||E'\t'||n_live_tup FROM pg_stat_user_tables ORDER BY schemaname, relname" > "${out}-table-counts.tsv"

  local size_dump size_sql
  size_dump="$(ls -lh "${out}.dump" 2>/dev/null | awk '{print $5}')"
  size_sql="$(ls -lh "${out}.sql.gz" 2>/dev/null | awk '{print $5}')"
  echo "  ${out}.dump ($size_dump), ${out}.sql.gz ($size_sql)"
  manifest_line="ok $label db=$db ${out}.dump ${out}.sql.gz"
  [[ -f "${out}.sql" ]] && manifest_line="$manifest_line ${out}.sql"
  echo "$manifest_line" >> "$MANIFEST"
}

_validate_backup() {
  local ok_count=0
  while IFS= read -r line; do
    [[ "$line" =~ ^ok\  ]] && ok_count=$((ok_count + 1))
  done < "$MANIFEST"

  if [[ "$ALLOW_BACKUP_SKIPS" != "1" ]]; then
    if [[ "$ok_count" -ne "$EXPECTED_DBS" ]]; then
      echo "❌ Expected $EXPECTED_DBS ok rows in manifest, got $ok_count (skips=$SKIPS failures=$FAILURES)" >&2
      FAILURES=$((FAILURES + 1))
    fi
    if [[ "$SKIPS" -gt 0 ]]; then
      echo "❌ Skipped $SKIPS DB(s); set ALLOW_BACKUP_SKIPS=1 only for partial local dev" >&2
      FAILURES=$((FAILURES + 1))
    fi
  fi

  for port in "${PORTS[@]}"; do
    local db="${PORT_DB[$port]}"
    local display="${PORT_LABEL[$port]:-$db}"
    local label="${port}-${display}"
    local out="$OUTDIR/$label"
    if [[ "$ALLOW_BACKUP_SKIPS" == "1" ]] && ! grep -q "^ok $label " "$MANIFEST" 2>/dev/null; then
      continue
    fi
    if [[ ! -s "${out}.dump" ]]; then
      echo "❌ Missing or empty ${out}.dump" >&2
      FAILURES=$((FAILURES + 1))
    fi
    if [[ ! -s "${out}.sql.gz" ]]; then
      echo "❌ Missing or empty ${out}.sql.gz" >&2
      FAILURES=$((FAILURES + 1))
    fi
    for meta in "${META_SUFFIXES[@]}"; do
      local f="${out}-${meta}.tsv"
      if [[ ! -s "$f" ]]; then
        echo "❌ Missing or empty metadata $f" >&2
        FAILURES=$((FAILURES + 1))
      fi
    done
    if [[ "$port" == "5439" ]] && [[ -s "${out}-extensions.tsv" ]]; then
      if ! grep -q $'^vector\t' "${out}-extensions.tsv" 2>/dev/null; then
        echo "⚠️  analytics (5439): pgvector extension (vector) not installed" >&2
        echo "    postgres-analytics uses postgres:16-alpine which lacks pgvector." >&2
        echo "    listing_search_index and hybrid search cannot restore until image supports vector." >&2
        echo "    Fix: use pgvector/pgvector:pg16 for postgres-analytics, then CREATE EXTENSION vector;" >&2
        echo "         and run infra/db/07-analytics-pgvector-hybrid-search.sql" >&2
      else
        echo "✓ analytics pgvector present in extensions.tsv"
      fi
    fi
  done

  local dumps sql_gz ext settings counts schemas total_files
  dumps=$(find "$OUTDIR" -maxdepth 1 -name '*.dump' | wc -l | tr -d ' ')
  sql_gz=$(find "$OUTDIR" -maxdepth 1 -name '*.sql.gz' | wc -l | tr -d ' ')
  ext=$(find "$OUTDIR" -maxdepth 1 -name '*-extensions.tsv' | wc -l | tr -d ' ')
  settings=$(find "$OUTDIR" -maxdepth 1 -name '*-pg_settings.tsv' | wc -l | tr -d ' ')
  counts=$(find "$OUTDIR" -maxdepth 1 -name '*-table-counts.tsv' | wc -l | tr -d ' ')
  schemas=$(find "$OUTDIR" -maxdepth 1 -name '*-schemas.tsv' | wc -l | tr -d ' ')
  total_files=$(find "$OUTDIR" -maxdepth 1 -type f ! -name 'manifest.txt' | wc -l | tr -d ' ')

  echo ""
  echo "Validation file counts: dumps=$dumps sql.gz=$sql_gz extensions=$ext pg_settings=$settings table-counts=$counts schemas=$schemas total_data_files=$total_files"

  if [[ "$ALLOW_BACKUP_SKIPS" != "1" && "$ok_count" -eq "$EXPECTED_DBS" ]]; then
    local required=$((EXPECTED_DBS * 6))
    if [[ "$dumps" -ne "$EXPECTED_DBS" || "$sql_gz" -ne "$EXPECTED_DBS" ]]; then
      echo "❌ Expected $EXPECTED_DBS .dump and $EXPECTED_DBS .sql.gz files" >&2
      FAILURES=$((FAILURES + 1))
    fi
    for n in "$ext" "$settings" "$counts" "$schemas"; do
      if [[ "$n" -ne "$EXPECTED_DBS" ]]; then
        echo "❌ Expected $EXPECTED_DBS of each metadata TSV type, got extensions=$ext pg_settings=$settings table-counts=$counts schemas=$schemas" >&2
        FAILURES=$((FAILURES + 1))
        break
      fi
    done
    if [[ "$total_files" -lt "$required" ]]; then
      echo "❌ Expected at least $required data/metadata files (+ manifest), got $total_files" >&2
      FAILURES=$((FAILURES + 1))
    fi
  fi
}

if [[ -z "${USE_PG_DOCKER}" ]] && command -v pg_dump >/dev/null 2>&1; then
  probe_err=$(pg_dump -h "$PGHOST" -p 5433 -U "$PGUSER" -d records -Fc --no-owner -f /dev/null 2>&1) || true
  if echo "$probe_err" | grep -q "server version mismatch"; then
    echo "⚠️  Local pg_dump older than server; using Docker postgres:16-alpine."
    USE_PG_DOCKER=1
  fi
fi
if [[ "${USE_PG_DOCKER}" == "1" ]]; then
  echo "Using Docker (postgres:16-alpine) for pg_dump/psql; host seen as $PGHOST_FOR_DOCKER"
  echo ""
fi

echo "=== Record Platform Postgres backup — 11 DBs (5433–5443) ==="
echo "Output: $OUTDIR"
echo ""

for port in "${PORTS[@]}"; do
  _dump_one "$port"
done

echo ""
echo "Finished: $(date -Iseconds)" >> "$MANIFEST"
_validate_backup

if [[ "$FAILURES" -gt 0 ]]; then
  echo "❌ Backup validation failed ($FAILURES issue(s)): $OUTDIR" >&2
  exit 1
fi

if [[ -x "$SCRIPT_DIR/rp-write-rp-runtime-manifest.sh" ]]; then
  bash "$SCRIPT_DIR/rp-write-rp-runtime-manifest.sh" "$OUTDIR"
  echo "Wrote manifest.json for cold-bootstrap restore" >> "$MANIFEST"
fi

echo "✅ Backup complete: $OUTDIR"
echo "   Restore: RESTORE_BACKUP_DIR=$OUTDIR ./scripts/restore-external-postgres-from-backup.sh $OUTDIR"
echo "   Cold-bootstrap: RESTORE_BACKUP_DIR=$OUTDIR make cold-bootstrap"
echo ""
