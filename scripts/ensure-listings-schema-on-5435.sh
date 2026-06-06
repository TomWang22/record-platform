#!/usr/bin/env bash
# Apply listings schema on port 5435 (database 'listings'), including extended columns (media_type, has_obi, etc.).
# Idempotent. Run after restore or when SKIP_PREFLIGHT_MIGRATIONS=1 so listings-service create does not fail with "media_type does not exist".
# Usage: ./scripts/ensure-listings-schema-on-5435.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PORT=5435
DB=listings
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BASE_SCHEMA="$REPO_ROOT/infra/db/05-listings-schema.sql"
EXTENDED_SCHEMA="$REPO_ROOT/infra/db/05-listings-schema-extended.sql"

if ! PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -tAc "SELECT 1" 2>/dev/null | grep -q 1; then
  echo "Postgres on $PORT not reachable; skip listings schema ensure."
  exit 0
fi

# Ensure DB exists
PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -f "$REPO_ROOT/infra/db/00-create-listings-database.sql" 2>/dev/null || true

# Base schema (creates listings.listings if missing)
if [[ -f "$BASE_SCHEMA" ]]; then
  if PGCONNECT_TIMEOUT=3 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='listings' AND table_name='listings'" 2>/dev/null | grep -q 1; then
    : # table exists
  else
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -f "$BASE_SCHEMA" -v ON_ERROR_STOP=1 2>/dev/null && echo "Listings base schema applied on $PORT/$DB." || true
  fi
fi

# Extended schema (adds media_type etc.; idempotent)
if [[ -f "$EXTENDED_SCHEMA" ]]; then
  if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -f "$EXTENDED_SCHEMA" -v ON_ERROR_STOP=0 2>/dev/null; then
    echo "Listings extended schema (media_type, etc.) applied on $PORT/$DB."
  else
    echo "Listings extended schema apply had issues (table may not exist yet)." >&2
  fi
else
  echo "Missing $EXTENDED_SCHEMA" >&2
  exit 1
fi
exit 0
