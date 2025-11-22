#!/usr/bin/env bash
set -euo pipefail

# Setup script for listings-service database on port 5435
# This creates the database and runs the schema migration

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Use localhost when running from host, host.docker.internal when running from container
LISTINGS_DB_HOST="${LISTINGS_DB_HOST:-localhost}"
LISTINGS_DB_PORT="${LISTINGS_DB_PORT:-5435}"
LISTINGS_DB_NAME="${LISTINGS_DB_NAME:-records}"
LISTINGS_DB_USER="${LISTINGS_DB_USER:-postgres}"
LISTINGS_DB_PASSWORD="${LISTINGS_DB_PASSWORD:-postgres}"

echo "== Setting up listings-service database on port $LISTINGS_DB_PORT =="

# Check if database exists, create if not
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$LISTINGS_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d postgres -c "
    CREATE DATABASE $LISTINGS_DB_NAME;
  "

echo "== Running schema migration =="
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d "$LISTINGS_DB_NAME" -f "$ROOT/infra/db/05-listings-schema.sql"

echo "== Verifying schema =="
PGPASSWORD="$LISTINGS_DB_PASSWORD" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" -U "$LISTINGS_DB_USER" -d "$LISTINGS_DB_NAME" -c "
  SELECT schemaname, tablename 
  FROM pg_tables 
  WHERE schemaname = 'listings'
  ORDER BY tablename;
"

echo "✅ Listings database setup complete!"

