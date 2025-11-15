#!/usr/bin/env bash
set -Eeuo pipefail

# Restore database from local backup file
# Usage: ./scripts/restore-from-local-backup.sh [backup_file]

NS="${NS:-record-platform}"
BACKUP_FILE="${1:-/Users/tom/record-platform/backups/records_20251112_partitioned.dump}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "=== Restoring from backup ==="
echo "Backup: $BACKUP_FILE"
echo ""

# Wait for pod to be ready
echo "Waiting for Postgres pod to be ready..."
kubectl -n "$NS" wait pod -l app=postgres --for=condition=Ready --timeout=120s >/dev/null 2>&1 || {
  echo "Error: Postgres pod not ready" >&2
  exit 1
}

# Get Postgres pod
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

# Wait for database to accept connections
echo "Waiting for database to accept connections..."
MAX_RETRIES=30
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    echo "  Waiting... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  else
    echo "Error: Database not ready after $MAX_RETRIES retries" >&2
    exit 1
  fi
done

echo "Postgres pod: $PGPOD"
echo ""

# Copy backup to pod
echo "Copying backup to pod..."
kubectl -n "$NS" cp "$BACKUP_FILE" "$PGPOD:/tmp/restore.dump" -c db

# Create extensions FIRST (before restore)
echo "Creating extensions in postgres database..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres <<'SQL'
-- Create extensions in template1 so they're available for new databases
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL

# Restore
echo "Restoring database..."
# Drop database if it exists
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -h localhost -U postgres -d postgres -X -P pager=off -c "DROP DATABASE IF EXISTS records;" >/dev/null 2>&1 || true

# Create database using createdb (more reliable than SQL)
echo "Creating database..."
kubectl -n "$NS" exec "$PGPOD" -c db -- createdb -h localhost -U postgres records 2>&1 || {
  echo "Error: Failed to create database" >&2
  exit 1
}

# Verify it was created
echo "Verifying database was created..."
sleep 1
if ! kubectl -n "$NS" exec "$PGPOD" -c db -- psql -h localhost -U postgres -d postgres -X -P pager=off -c "SELECT datname FROM pg_database WHERE datname='records';" | grep -q records; then
  echo "Error: Database verification failed" >&2
  exit 1
fi
echo "Database created successfully"

# Verify database was created (try multiple times with retries)
echo "Verifying database was created..."
MAX_RETRIES=10
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -h localhost -U postgres -d records -X -P pager=off -c "SELECT 1;" >/dev/null 2>&1; then
    echo "Database created successfully"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    echo "  Waiting for database to be ready... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 1
  else
    echo "Error: Failed to create records database after $MAX_RETRIES retries" >&2
    echo "Checking database status..." >&2
    kubectl -n "$NS" exec "$PGPOD" -c db -- psql -h localhost -U postgres -d postgres -X -P pager=off -c "SELECT datname FROM pg_database WHERE datname='records';" >&2
    exit 1
  fi
done

# Create extensions in records database BEFORE restore
echo "Creating extensions in records database..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
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
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;
SQL

# Clean up legacy objects that might interfere
echo "Cleaning up legacy objects..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL' || true
-- Drop legacy table if it exists (from previous migration attempts)
DROP TABLE IF EXISTS records.records_legacy CASCADE;

-- Drop any orphaned triggers
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT tgname, tgrelid::regclass::text as table_name
    FROM pg_trigger
    WHERE tgname LIKE '%legacy%' OR tgrelid::regclass::text LIKE '%legacy%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s CASCADE', r.tgname, r.table_name);
  END LOOP;
END $$;
SQL

# Check disk space before restore
echo "=== Checking disk space ==="
AVAILABLE=$(kubectl -n "$NS" exec "$PGPOD" -c db -- df /var/lib/postgresql/data | tail -1 | awk '{print $4}')
AVAILABLE_MB=$((AVAILABLE / 1024))
echo "Available space: ${AVAILABLE_MB}MB"

if [[ $AVAILABLE_MB -lt 1000 ]]; then
  echo "WARNING: Less than 1GB free. Attempting to free space..." >&2
  echo "Run ./scripts/free-disk-space.sh first if restore fails" >&2
  
  # Try to free some space
  kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -c "CHECKPOINT;" || true
fi

# Restore in stages to avoid MV errors and memory issues
echo "Running pg_restore (pre-data + data sections, will handle indexes separately if needed)..."
set +e

# Restore pre-data + data (schema and data, indexes may fail due to disk space)
kubectl -n "$NS" exec "$PGPOD" -c db -- pg_restore \
  -U postgres \
  -d records \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --section=pre-data \
  --section=data \
  -j 1 \
  /tmp/restore.dump > /tmp/restore.log 2>&1 || true
RESTORE_EXIT=$?

# Check for disk space errors
if grep -q "No space left on device" /tmp/restore.log 2>/dev/null; then
  echo "WARNING: Disk space errors detected during restore" >&2
  echo "Some indexes may not have been created" >&2
  echo "Available space:" >&2
  kubectl -n "$NS" exec "$PGPOD" -c db -- df -h /var/lib/postgresql/data | head -2
  echo "" >&2
  echo "Will attempt to create critical indexes separately..." >&2
  DISK_SPACE_ERROR=1
else
  DISK_SPACE_ERROR=0
fi

# Show restore errors (filter out common safe-to-ignore ones)
echo "=== Restore errors (filtered) ==="
grep -E "(ERROR|WARNING)" /tmp/restore.log | grep -v "already exists\|does not exist\|materialized view.*has not been populated" | head -20 || echo "No critical errors found"

# Restore post-data (functions, triggers)
echo ""
echo "Restoring post-data (functions, triggers)..."
kubectl -n "$NS" exec "$PGPOD" -c db -- pg_restore \
  -U postgres \
  -d records \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --section=post-data \
  -j 1 \
  /tmp/restore.dump >> /tmp/restore.log 2>&1 || true
POST_DATA_EXIT=$?

# If we had disk space errors, try to create critical indexes
if [[ $DISK_SPACE_ERROR -eq 1 ]]; then
  echo ""
  echo "=== Attempting to create critical indexes (with space check) ==="
  kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- Check what indexes are missing
DO $$
DECLARE
  missing_pkey BOOLEAN;
  missing_user_idx BOOLEAN;
  db_size_mb INTEGER;
  free_space_kb INTEGER;
BEGIN
  -- Check if primary key exists
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'records_pkey' AND conrelid = 'records.records'::regclass
  ) INTO missing_pkey;
  
  -- Check if user_id index exists
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'records' AND tablename = 'records' AND indexname LIKE '%user_id%'
  ) INTO missing_user_idx;
  
  -- Get database size
  SELECT (pg_database_size('records') / 1024 / 1024) INTO db_size_mb;
  
  RAISE NOTICE 'Database size: % MB', db_size_mb;
  RAISE NOTICE 'Missing primary key: %', missing_pkey;
  RAISE NOTICE 'Missing user_id index: %', missing_user_idx;
  
  -- Create primary key if missing (critical)
  IF missing_pkey THEN
    BEGIN
      ALTER TABLE records.records ADD CONSTRAINT records_pkey PRIMARY KEY (id, user_id);
      RAISE NOTICE 'Created primary key';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to create primary key: %', SQLERRM;
    END;
  END IF;
  
  -- Create user_id index if missing (critical for queries)
  IF missing_user_idx THEN
    BEGIN
      CREATE INDEX idx_records_user_id ON records.records(user_id);
      RAISE NOTICE 'Created user_id index';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to create user_id index: %', SQLERRM;
    END;
  END IF;
  
  -- Only create large indexes if we have reasonable space
  IF db_size_mb < 3000 THEN
    RAISE WARNING 'Database size suggests low disk space. Skipping large search indexes.';
    RAISE NOTICE 'Create indexes manually after freeing space:';
    RAISE NOTICE '  CREATE INDEX idx_records_search_norm_gist ON records.records USING gist(search_norm gist_trgm_ops);';
    RAISE NOTICE '  CREATE INDEX idx_records_search_norm_gin ON records.records USING gin(search_norm gin_trgm_ops) WITH (fastupdate=off);';
  ELSE
    -- Try to create search indexes
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist ON records.records USING gist(search_norm gist_trgm_ops);
      RAISE NOTICE 'Created GIST search index';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to create GIST index: %', SQLERRM;
    END;
    
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin ON records.records USING gin(search_norm gin_trgm_ops) WITH (fastupdate=off);
      RAISE NOTICE 'Created GIN search index';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to create GIN index: %', SQLERRM;
    END;
  END IF;
END $$;
SQL
fi

set -e

# Check if restore succeeded (exit code 1 is OK for pg_restore with warnings)
if [[ $RESTORE_EXIT -gt 1 ]] || [[ $POST_DATA_EXIT -gt 1 ]]; then
  echo "WARNING: pg_restore had errors" >&2
  echo "Check /tmp/restore.log for details" >&2
  echo "Common errors (schema already exists, etc.) are usually safe to ignore" >&2
fi

# Run post-init SQL
echo "Running post-init SQL..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;

-- Ensure unaccent extension exists
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Ensure norm_text function exists (depends on unaccent)
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;

-- Ensure search_records_fuzzy_ids function exists (critical for benchmarks)
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH norm AS (SELECT norm_text(COALESCE(p_q,'')) AS qn),
  cand_main AS (
    SELECT r.id, 1 - (r.search_norm <-> (SELECT qn FROM norm)) AS knn_rank
    FROM records.records r
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND r.search_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND r.search_norm %    (SELECT qn FROM norm))
      )
    ORDER BY r.search_norm <-> (SELECT qn FROM norm)
    LIMIT LEAST(1000, GREATEST(1, p_limit*10))
  ),
  cand_alias AS (
    SELECT DISTINCT r.id, max(similarity(a.term_norm,(SELECT qn FROM norm))) AS alias_sim
    FROM public.record_aliases a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
      )
    GROUP BY r.id
  )
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,(SELECT qn FROM norm)),
           similarity(r.name_norm,  (SELECT qn FROM norm)),
           similarity(r.search_norm,(SELECT qn FROM norm)),
           COALESCE(ca.alias_sim,0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
  WHERE GREATEST(
    similarity(r.artist_norm,(SELECT qn FROM norm)),
    similarity(r.name_norm,  (SELECT qn FROM norm)),
    similarity(r.search_norm,(SELECT qn FROM norm)),
    COALESCE(ca.alias_sim,0)
  ) > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;

-- Refresh materialized views (in correct order, ignore errors)
-- Only refresh if they exist and are not populated
DO $$
DECLARE
  mv_count INTEGER;
BEGIN
  -- Check and refresh aliases_mv first (search_doc_mv depends on it)
  SELECT COUNT(*) INTO mv_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'records' AND c.relname = 'aliases_mv' AND c.relkind = 'm';
  
  IF mv_count > 0 THEN
    BEGIN
      REFRESH MATERIALIZED VIEW records.aliases_mv;
      RAISE NOTICE 'Refreshed records.aliases_mv';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to refresh records.aliases_mv: %', SQLERRM;
    END;
  END IF;
  
  -- Then refresh search_doc_mv
  SELECT COUNT(*) INTO mv_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'records' AND c.relname = 'search_doc_mv' AND c.relkind = 'm';
  
  IF mv_count > 0 THEN
    BEGIN
      REFRESH MATERIALIZED VIEW records.search_doc_mv;
      RAISE NOTICE 'Refreshed records.search_doc_mv';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to refresh records.search_doc_mv: %', SQLERRM;
    END;
  END IF;
END $$;

-- Run VACUUM ANALYZE on main table and partitions
VACUUM ANALYZE records.records;

-- Analyze partitions separately to avoid memory issues
DO $$
DECLARE
  part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname LIKE 'records_p%' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
    RAISE NOTICE 'Analyzed partition: %', part_name;
  END LOOP;
END $$;
SQL

echo ""
echo "=== Restore complete ==="
echo "Verifying..."
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
-- Check main records table count
SELECT 
  'records.records' as table_name,
  COUNT(*) as row_count
FROM records.records;

-- Check partition distribution
SELECT 
  CASE 
    WHEN relname = 'records' THEN 'main_table'
    ELSE relname 
  END as partition_name,
  n_live_tup as row_count,
  pg_size_pretty(pg_total_relation_size('records.'||relname)) as size
FROM pg_stat_user_tables
WHERE schemaname = 'records' 
  AND (relname = 'records' OR relname LIKE 'records_p%')
ORDER BY n_live_tup DESC
LIMIT 10;

-- Total summary
SELECT 
  schemaname, 
  COUNT(*) as table_count,
  SUM(n_live_tup) as total_rows,
  pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||relname))) as total_size
FROM pg_stat_user_tables
WHERE schemaname = 'records'
GROUP BY schemaname;
SQL

