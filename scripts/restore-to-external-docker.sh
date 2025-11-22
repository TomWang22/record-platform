#!/usr/bin/env bash
set -Eeuo pipefail

# Restore database to external Docker Postgres (localhost:5432)
# Usage: ./scripts/restore-to-external-docker.sh [backup_file]

BACKUP_FILE="${1:-./backups/records_migration_20251117_112454.dump}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: Backup file not found: $BACKUP_FILE" >&2
  echo "Available backups:" >&2
  ls -lh backups/*.dump 2>/dev/null || echo "  No backups found in ./backups/" >&2
  exit 1
fi

# Connection settings for external Docker Postgres
: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"  # Changed to 5433 to match Docker port (avoids Postgres.app conflict)
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Restoring to External Docker Postgres ==="
echo "Backup: $BACKUP_FILE"
echo "Host: $PGHOST:$PGPORT"
echo "Database: $PGDATABASE"
echo ""

# Test connection
echo "Testing connection..."
if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
  echo "❌ Cannot connect to Postgres at $PGHOST:$PGPORT" >&2
  echo "   Please ensure:" >&2
  echo "   1. Docker container 'postgres-external' is running" >&2
  echo "   2. Port 5432 is exposed" >&2
  exit 1
fi
echo "✅ Connection successful"

# Create database if needed
echo "Ensuring database exists..."
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE') THEN
    CREATE DATABASE $PGDATABASE;
  END IF;
END \$\$;
SQL

# Create extensions FIRST (before restore)
echo "Creating extensions..."
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<'SQL'
-- Create all extensions before restore
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL

# Create norm_text function BEFORE restore (needed by MVs)
echo "Creating norm_text function..."
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<'SQL'
SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;
SQL

# Restore database
echo ""
echo "=== Restoring database ==="
echo "This may take several minutes..."

# Check if we need to use docker exec for pg_restore (version compatibility)
USE_DOCKER_RESTORE=false
DOCKER_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)

if [[ -n "$DOCKER_CONTAINER" ]]; then
  # Try to read dump file with local pg_restore first
  if ! pg_restore -l "$BACKUP_FILE" >/dev/null 2>&1; then
    echo "⚠️  Local pg_restore cannot read dump file (version mismatch?)"
    echo "   Using docker exec $DOCKER_CONTAINER pg_restore..."
    USE_DOCKER_RESTORE=true
  fi
fi

if [[ "$USE_DOCKER_RESTORE" == "true" ]] && [[ -n "$DOCKER_CONTAINER" ]]; then
  # Copy backup file into container and restore from there
  echo "Copying backup file into container..."
  docker cp "$BACKUP_FILE" "$DOCKER_CONTAINER:/tmp/restore.dump"
  
  echo "Running pg_restore inside container..."
  docker exec "$DOCKER_CONTAINER" pg_restore \
    -h localhost \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --verbose \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    -j 4 \
    /tmp/restore.dump 2>&1 | tee /tmp/restore_external.log || {
    echo "⚠️  pg_restore had warnings/errors (check /tmp/restore_external.log)" >&2
    # Try single-threaded if parallel failed
    if grep -q "error\|ERROR" /tmp/restore_external.log; then
      echo "⚠️  Trying single-threaded restore..." >&2
      docker exec "$DOCKER_CONTAINER" pg_restore \
        -h localhost \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        --verbose \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --disable-triggers \
        /tmp/restore.dump 2>&1 | tee -a /tmp/restore_external.log || {
        echo "❌ Restore failed" >&2
        exit 1
      }
    fi
  }
  
  # Clean up
  docker exec "$DOCKER_CONTAINER" rm -f /tmp/restore.dump
else
  # Use local pg_restore
  echo "Using local pg_restore..."
  PGPASSWORD="$PGPASSWORD" pg_restore \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --verbose \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    -j 4 \
    "$BACKUP_FILE" 2>&1 | tee /tmp/restore_external.log || {
    echo "⚠️  pg_restore had warnings/errors (check /tmp/restore_external.log)" >&2
    # Check if it's a version issue - if so, use docker exec
    if grep -q "unsupported version" /tmp/restore_external.log; then
      echo "⚠️  Version mismatch detected, using docker exec for pg_restore..." >&2
      if [[ -n "$DOCKER_CONTAINER" ]]; then
        echo "Copying backup file into container..."
        docker cp "$BACKUP_FILE" "$DOCKER_CONTAINER:/tmp/restore.dump"
        
        echo "Running pg_restore inside container..."
        docker exec "$DOCKER_CONTAINER" pg_restore \
          -h localhost \
          -U "$PGUSER" \
          -d "$PGDATABASE" \
          --verbose \
          --clean \
          --if-exists \
          --no-owner \
          --no-privileges \
          --disable-triggers \
          /tmp/restore.dump 2>&1 | tee -a /tmp/restore_external.log || {
          echo "❌ Restore failed even with docker exec" >&2
          exit 1
        }
        
        # Clean up
        docker exec "$DOCKER_CONTAINER" rm -f /tmp/restore.dump
      else
        echo "❌ Cannot use docker exec - no container found" >&2
        exit 1
      fi
    fi
  }
fi

# Check for critical errors
if grep -q "FATAL\|ERROR.*relation\|ERROR.*database" /tmp/restore_external.log 2>/dev/null; then
  echo "❌ Critical errors detected during restore!" >&2
  grep -E "(FATAL|ERROR.*relation|ERROR.*database)" /tmp/restore_external.log | head -10 >&2
  exit 1
fi

# Run ANALYZE
echo ""
echo "=== Running ANALYZE ==="
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "ANALYZE;" || {
  echo "⚠️  ANALYZE had errors" >&2
}

# Refresh materialized views if present
echo "Refreshing materialized views..."
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<'SQL'
SET search_path = records, public, pg_catalog;

DO $$
DECLARE
  mv_exists BOOLEAN;
BEGIN
  -- Refresh aliases_mv if it exists
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname = 'aliases_mv' AND c.relkind = 'm'
  ) INTO mv_exists;
  
  IF mv_exists THEN
    REFRESH MATERIALIZED VIEW records.aliases_mv;
    RAISE NOTICE 'Refreshed records.aliases_mv';
  END IF;
  
  -- Refresh search_doc_mv if it exists
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname = 'search_doc_mv' AND c.relkind = 'm'
  ) INTO mv_exists;
  
  IF mv_exists THEN
    REFRESH MATERIALIZED VIEW records.search_doc_mv;
    RAISE NOTICE 'Refreshed records.search_doc_mv';
  END IF;
END $$;
SQL

# Verify restore
echo ""
echo "=== Verifying restore ==="
RECORD_COUNT=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -c "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ')

if [[ -z "$RECORD_COUNT" ]] || [[ "$RECORD_COUNT" == "0" ]]; then
  echo "❌ Restore verification failed - no records found!" >&2
  exit 1
fi

echo "✅ Restore complete!"
echo "   Records in database: $RECORD_COUNT"
echo ""
echo "=== Database Statistics ==="
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<'SQL'
SELECT 
  schemaname,
  tablename,
  n_live_tup AS row_count,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_stat_user_tables
WHERE schemaname IN ('records', 'public', 'auth')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
SQL

echo ""
echo "✅ Database restored successfully to external Docker Postgres!"
echo "   Connection: postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$PGDATABASE"

