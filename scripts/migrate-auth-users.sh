#!/usr/bin/env bash
set -euo pipefail

# Migrate users from main database (port 5433) to auth database (port 5437)
# This script copies all users from auth.users in the main DB to the new auth DB

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAIN_DB_HOST="${MAIN_DB_HOST:-localhost}"
MAIN_DB_PORT="${MAIN_DB_PORT:-5433}"
AUTH_DB_HOST="${AUTH_DB_HOST:-localhost}"
AUTH_DB_PORT="${AUTH_DB_PORT:-5437}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-records}"

echo "=== Migrating users from main DB (port $MAIN_DB_PORT) to auth DB (port $AUTH_DB_PORT) ==="

# Check if source has users
USER_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$MAIN_DB_HOST" -p "$MAIN_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM auth.users;" 2>&1 | tr -d '[:space:]')
echo "Found $USER_COUNT users in main database"

if [[ "$USER_COUNT" == "0" ]]; then
  echo "⚠️  No users to migrate"
  exit 0
fi

# Check if destination already has users
DEST_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM auth.users;" 2>&1 | tr -d '[:space:]')
echo "Found $DEST_COUNT users in auth database"

if [[ "$DEST_COUNT" != "0" ]]; then
  echo "⚠️  Auth database already has users. Skipping migration to avoid duplicates."
  echo "   If you want to force migration, delete users from auth database first."
  exit 0
fi

# Export users from main DB
echo "Exporting users from main database..."
PGPASSWORD="$DB_PASSWORD" psql -h "$MAIN_DB_HOST" -p "$MAIN_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  COPY (
    SELECT id, email, password_hash, settings, created_at
    FROM auth.users
    ORDER BY created_at
  ) TO STDOUT WITH (FORMAT csv, HEADER false)
" > /tmp/auth_users_export.csv

# Import users to auth DB
echo "Importing users to auth database..."
PGPASSWORD="$DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  COPY auth.users (id, email, password_hash, settings, created_at)
  FROM STDIN WITH (FORMAT csv)
" < /tmp/auth_users_export.csv

# Verify migration
IMPORTED_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM auth.users;" 2>&1 | tr -d '[:space:]')
echo "✅ Migrated $IMPORTED_COUNT users to auth database"

# Clean up
rm -f /tmp/auth_users_export.csv

echo "=== Migration complete ==="
echo ""
echo "⚠️  IMPORTANT: After verifying the migration, you should:"
echo "   1. Update all services to use POSTGRES_URL_AUTH pointing to port 5437"
echo "   2. Test authentication with migrated users"
echo "   3. Once verified, you can optionally remove auth.users from the main database"
echo "      (but keep the schema for now in case of rollback)"

