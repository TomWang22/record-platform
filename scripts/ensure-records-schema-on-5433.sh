#!/usr/bin/env bash
# Apply records.records Prisma-aligned columns on port 5433 (idempotent).
# Run when SKIP_PREFLIGHT_MIGRATIONS=1 so records-service create does not fail with "insert_grade does not exist".
# Usage: ./scripts/ensure-records-schema-on-5433.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PORT=5433
DB=records
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
MIGRATION="$REPO_ROOT/infra/db/46-records-prisma-columns.sql"

if [[ ! -f "$MIGRATION" ]]; then
  echo "Missing $MIGRATION" >&2
  exit 1
fi

if ! PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -tAc "SELECT 1" 2>/dev/null | grep -q 1; then
  echo "Postgres on $PORT not reachable; skip records schema ensure."
  exit 0
fi

# Ensure records DB and schema exist (minimal; 03-database.sql may have created table without Prisma columns)
for d in records postgres; do
  if PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$d" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='records' AND table_name='records'" 2>/dev/null | grep -q 1; then
    echo "Applying $MIGRATION to $PORT/$d..."
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$d" -f "$MIGRATION" -v ON_ERROR_STOP=1 2>/dev/null && { echo "Records schema (Prisma columns) applied on $PORT/$d."; exit 0; } || true
  fi
done
echo "records.records not found on $PORT (records or postgres); run full migrations or 03-database.sql first."
exit 0
