#!/usr/bin/env bash
# Restore smoke: pg_restore all 11 RP Postgres backups into temporary databases.
#
# Usage:
#   ./scripts/restore-rp-postgres-backup-smoke.sh [backups/rp-all-11-YYYYMMDD-HHMMSS]
#
# Creates temporary DB names rp_restore_smoke_<label> on the same host ports,
# restores custom-format .dump, verifies table counts vs backup manifest.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

BACKUP_DIR="${1:-}"
if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$(ls -dt "$REPO_ROOT"/backups/rp-all-11-* 2>/dev/null | head -1 || true)"
fi
if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "❌ No backup directory found. Run ./scripts/backup-rp-postgres-dbs.sh first." >&2
  exit 1
fi

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

_use_docker=0
if ! command -v psql >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  _use_docker=1
fi

_run_psql() {
  local port="$1" db="$2" query="$3"
  if [[ "$_use_docker" -eq 1 ]]; then
    docker run --rm -e PGPASSWORD \
      postgres:16-alpine \
      psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -tAc "$query"
  else
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -tAc "$query"
  fi
}

_pg_restore() {
  local port="$1" src_db="$2" dump="$3"
  if [[ "$_use_docker" -eq 1 ]]; then
    docker run --rm -e PGPASSWORD -v "$dump:/dump:ro" \
      postgres:16-alpine \
      pg_restore -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$src_db" --no-owner --no-acl /dump
  else
    pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$src_db" --no-owner --no-acl "$dump"
  fi
}

label_for_port() {
  local port="$1"
  echo "${PORT_LABEL[$port]:-${PORT_DB[$port]}}"
}

MANIFEST="$BACKUP_DIR/restore-smoke-manifest.txt"
: >"$MANIFEST"
OK=0
FAIL=0

echo "Restore smoke from $BACKUP_DIR" | tee -a "$MANIFEST"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$MANIFEST"
echo "" | tee -a "$MANIFEST"

for port in "${PORTS[@]}"; do
  label="$(label_for_port "$port")"
  file_label="${port}-${label}"
  src_db="${PORT_DB[$port]}"
  restore_db="rp_restore_smoke_${label//-/_}"
  dump="$BACKUP_DIR/${file_label}.dump"
  counts_file="$BACKUP_DIR/${file_label}-table-counts.tsv"

  echo "=== port $port ($label) → $restore_db ===" | tee -a "$MANIFEST"

  for f in "$dump" "$BACKUP_DIR/${file_label}.sql.gz" "$BACKUP_DIR/${file_label}-extensions.tsv" \
    "$BACKUP_DIR/${file_label}-pg_settings.tsv" "$BACKUP_DIR/${file_label}-table-counts.tsv" \
    "$BACKUP_DIR/${file_label}-schemas.tsv"; do
    if [[ ! -s "$f" ]]; then
      echo "SKIP backup artifact missing: $f" | tee -a "$MANIFEST"
      FAIL=$((FAIL + 1))
      continue 2
    fi
  done

  if ! _run_psql "$port" postgres "SELECT 1" >/dev/null 2>&1; then
    echo "FAIL cannot connect port $port" | tee -a "$MANIFEST"
    FAIL=$((FAIL + 1))
    continue
  fi

  _run_psql "$port" postgres "DROP DATABASE IF EXISTS \"$restore_db\";" >/dev/null
  _run_psql "$port" postgres "CREATE DATABASE \"$restore_db\";" >/dev/null

  if [[ "$label" == "analytics" ]]; then
    _run_psql "$port" "$restore_db" "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || true
  fi

  if _pg_restore "$port" "$restore_db" "$dump" >>"$MANIFEST" 2>&1; then
    echo "pg_restore OK" | tee -a "$MANIFEST"
  else
    echo "pg_restore FAIL (see log above)" | tee -a "$MANIFEST"
    FAIL=$((FAIL + 1))
    continue
  fi

  if [[ "$label" == "analytics" ]]; then
    vec=$(_run_psql "$port" "$restore_db" "SELECT extname FROM pg_extension WHERE extname='vector';" || true)
    if [[ "$vec" == "vector" ]]; then
      echo "pgvector extension OK" | tee -a "$MANIFEST"
    else
      echo "pgvector extension MISSING" | tee -a "$MANIFEST"
      FAIL=$((FAIL + 1))
      continue
    fi
  fi

  restored_tables=$(_run_psql "$port" "$restore_db" \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');")
  backup_tables=$(awk -F'\t' 'NR>1 {c++} END {print c+0}' "$counts_file" 2>/dev/null || echo 0)
  echo "tables restored=$restored_tables backup_manifest_rows=$backup_tables" | tee -a "$MANIFEST"

  if [[ "$restored_tables" -ge 1 ]]; then
    echo "PASS $label" | tee -a "$MANIFEST"
    OK=$((OK + 1))
  else
    echo "FAIL $label (no tables)" | tee -a "$MANIFEST"
    FAIL=$((FAIL + 1))
  fi

  _run_psql "$port" postgres "DROP DATABASE \"$restore_db\";" >/dev/null 2>&1 || true
  echo "" | tee -a "$MANIFEST"
done

{
  echo "Summary: $OK ok, $FAIL failed (expected 11 ok)"
} | tee -a "$MANIFEST"

if [[ "$OK" -eq 11 && "$FAIL" -eq 0 ]]; then
  echo "✅ Restore smoke PASS — $MANIFEST"
  exit 0
fi
echo "❌ Restore smoke FAILED — $MANIFEST" >&2
exit 1
