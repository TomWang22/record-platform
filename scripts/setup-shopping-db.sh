#!/usr/bin/env bash
set -euo pipefail

# Setup script for shopping-service database on port 5436
# This creates the database and runs the schema migration

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Use localhost when running from host, host.docker.internal when running from container
SHOPPING_DB_HOST="${SHOPPING_DB_HOST:-localhost}"
SHOPPING_DB_PORT="${SHOPPING_DB_PORT:-5436}"
SHOPPING_DB_NAME="${SHOPPING_DB_NAME:-records}"
SHOPPING_DB_USER="${SHOPPING_DB_USER:-postgres}"
SHOPPING_DB_PASSWORD="${SHOPPING_DB_PASSWORD:-postgres}"

echo "== Setting up shopping-service database on port $SHOPPING_DB_PORT =="

# Check if database exists, create if not
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$SHOPPING_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d postgres -c "
    CREATE DATABASE $SHOPPING_DB_NAME;
  "

echo "== Running schema migration =="
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" -f "$ROOT/infra/db/06-shopping-schema.sql"

echo "== Verifying schema =="
PGPASSWORD="$SHOPPING_DB_PASSWORD" psql -h "$SHOPPING_DB_HOST" -p "$SHOPPING_DB_PORT" -U "$SHOPPING_DB_USER" -d "$SHOPPING_DB_NAME" -c "
  SELECT schemaname, tablename 
  FROM pg_tables 
  WHERE schemaname = 'shopping'
  ORDER BY tablename;
"

echo "✅ Shopping database setup complete!"

