#!/usr/bin/env bash
set -euo pipefail

# Setup script for auth-service database on port 5437
# This creates the database and runs the schema migration

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Use localhost when running from host, host.docker.internal when running from container
AUTH_DB_HOST="${AUTH_DB_HOST:-localhost}"
AUTH_DB_PORT="${AUTH_DB_PORT:-5437}"
AUTH_DB_NAME="${AUTH_DB_NAME:-records}"
AUTH_DB_USER="${AUTH_DB_USER:-postgres}"
AUTH_DB_PASSWORD="${AUTH_DB_PASSWORD:-postgres}"

echo "== Setting up auth-service database on port $AUTH_DB_PORT =="

# Check if database exists, create if not
PGPASSWORD="$AUTH_DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$AUTH_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$AUTH_DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d postgres -c "
    CREATE DATABASE $AUTH_DB_NAME;
  "

echo "== Running schema migration =="
PGPASSWORD="$AUTH_DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d "$AUTH_DB_NAME" -f "$ROOT/infra/db/07-auth-schema.sql"

echo "== Verifying schema =="
PGPASSWORD="$AUTH_DB_PASSWORD" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d "$AUTH_DB_NAME" -c "
  SELECT schemaname, tablename 
  FROM pg_tables 
  WHERE schemaname = 'auth'
  ORDER BY schemaname, tablename;
"

echo "✅ Auth database setup complete!"

