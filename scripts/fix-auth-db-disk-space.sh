#!/usr/bin/env bash
set -euo pipefail

# Fix auth database disk space issue by recreating it
# This script will:
# 1. Stop and remove the problematic auth DB container
# 2. Remove the volume (after backing up if needed)
# 3. Recreate the database with fresh volume

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Fixing Auth Database Disk Space Issue ==="
echo ""

# Check if we have users in main DB to migrate back
MAIN_DB_USERS=$(PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -tAc "SELECT COUNT(*) FROM auth.users;" 2>/dev/null || echo "0")
echo "Found $MAIN_DB_USERS users in main database (port 5433)"

if [[ "$MAIN_DB_USERS" -gt "0" ]]; then
  echo "✅ Users exist in main DB - they will be available after recreation"
fi

# Stop and remove container
echo ""
echo "Step 1: Stopping auth DB container..."
docker stop record-platform-postgres-auth-1 2>/dev/null || true
docker rm record-platform-postgres-auth-1 2>/dev/null || true

# Remove volume (this frees up space)
echo "Step 2: Removing problematic volume..."
docker volume rm record-platform_pgdata-auth 2>/dev/null || true

# Wait a moment for cleanup
sleep 2

# Recreate using docker-compose
echo "Step 3: Recreating auth database..."
docker compose up -d postgres-auth

# Wait for it to be healthy
echo "Step 4: Waiting for database to be ready..."
for i in {1..30}; do
  if docker ps | grep -q "postgres-auth.*healthy"; then
    echo "✅ Database is healthy"
    break
  fi
  sleep 2
done

# Run setup script
echo "Step 5: Setting up database schema..."
if [[ -f "./scripts/setup-auth-db.sh" ]]; then
  ./scripts/setup-auth-db.sh
else
  echo "⚠️  setup-auth-db.sh not found, creating schema manually..."
  PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d postgres -c "CREATE DATABASE records;" 2>/dev/null || true
  PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -f infra/db/07-auth-schema.sql
fi

# Migrate users back if they exist in main DB
if [[ "$MAIN_DB_USERS" -gt "0" ]]; then
  echo "Step 6: Migrating users from main DB..."
  if [[ -f "./scripts/migrate-auth-users.sh" ]]; then
    ./scripts/migrate-auth-users.sh
  else
    echo "⚠️  migrate-auth-users.sh not found, skipping user migration"
    echo "   Users are still in main DB (port 5433) - auth-service can use them there"
  fi
fi

echo ""
echo "✅ Auth database recreation complete!"
echo ""
echo "Next steps:"
echo "1. Update auth-service to use port 5437:"
echo "   kubectl -n record-platform set env deploy/auth-service POSTGRES_URL_AUTH='postgresql://postgres:postgres@host.docker.internal:5437/records?search_path=auth&connect_timeout=5'"
echo "2. Restart auth-service:"
echo "   kubectl -n record-platform rollout restart deploy/auth-service"
