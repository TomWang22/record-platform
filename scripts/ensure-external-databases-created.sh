#!/usr/bin/env bash
# Ensure the 7 application databases exist on the already-running external Postgres instances (ports 5433–5440).
# Does not recreate or start Postgres; run after bring-up-external-infra.sh. Idempotent (CREATE DATABASE IF NOT EXISTS).
# Table schemas (07-*, 46-*, etc.) are applied by service migrations or by running infra/db/*.sql against each DB as needed.
# Usage: ./scripts/ensure-external-databases-created.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"

if ! command -v psql >/dev/null 2>&1; then
  echo "⚠️  psql not found. Install PostgreSQL client (brew install libpq) or run the SQL files manually."
  exit 1
fi

# Port -> 00-create-*-database.sql (run against -d postgres)
declare -A DB_FILES=(
  [5433]=infra/db/00-create-records-database.sql
  [5434]=infra/db/00-create-social-database.sql
  [5435]=infra/db/00-create-listings-database.sql
  [5436]=infra/db/00-create-shopping-database.sql
  [5437]=infra/db/00-create-auth-database.sql
  [5439]=infra/db/00-create-analytics-database.sql
  [5440]=infra/db/00-create-python-ai-database.sql
)
# 5438 = auction-monitor uses default "postgres" DB, no create needed

echo "=== Ensuring external databases exist (${PGHOST}:5433–5440) ==="
for port in 5433 5434 5435 5436 5437 5439 5440; do
  file="${DB_FILES[$port]}"
  if [[ ! -f "$REPO_ROOT/$file" ]]; then
    echo "⚠️  Skip $port: $file not found"
    continue
  fi
  if psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -f "$REPO_ROOT/$file" 2>/dev/null; then
    echo "✅ DB on port $port ensured ($file)"
  else
    echo "⚠️  Failed to ensure DB on port $port ($file)"
  fi
done
echo "Done. Next: apply schemas with scripts/apply-external-db-schemas.sh (see docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md)."
