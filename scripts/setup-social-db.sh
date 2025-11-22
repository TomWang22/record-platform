#!/usr/bin/env bash
set -euo pipefail

# Setup script for social-service database on port 5433
# This creates the database and runs the schema migration

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Use localhost when running from host, host.docker.internal when running from container
SOCIAL_DB_HOST="${SOCIAL_DB_HOST:-localhost}"
SOCIAL_DB_PORT="${SOCIAL_DB_PORT:-5434}"
SOCIAL_DB_NAME="${SOCIAL_DB_NAME:-records}"
SOCIAL_DB_USER="${SOCIAL_DB_USER:-postgres}"
SOCIAL_DB_PASSWORD="${SOCIAL_DB_PASSWORD:-postgres}"

echo "== Setting up social-service database on port $SOCIAL_DB_PORT =="

# Check if database exists, create if not
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d postgres -tc "
  SELECT 1 FROM pg_database WHERE datname = '$SOCIAL_DB_NAME'
" | grep -q 1 || \
  PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d postgres -c "
    CREATE DATABASE $SOCIAL_DB_NAME;
  "

echo "== Running schema migration =="
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d "$SOCIAL_DB_NAME" -f "$ROOT/infra/db/04-social-schema.sql"

echo "== Verifying schema =="
PGPASSWORD="$SOCIAL_DB_PASSWORD" psql -h "$SOCIAL_DB_HOST" -p "$SOCIAL_DB_PORT" -U "$SOCIAL_DB_USER" -d "$SOCIAL_DB_NAME" -c "
  SELECT schemaname, tablename 
  FROM pg_tables 
  WHERE schemaname IN ('forum', 'messages')
  ORDER BY schemaname, tablename;
"

echo "✅ Social database setup complete!"

