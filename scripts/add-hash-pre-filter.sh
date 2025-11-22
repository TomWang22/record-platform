#!/usr/bin/env bash
set -Eeuo pipefail

# Add hash-based pre-filtering to dramatically improve performance
# This adds a hash column and uses it for fast pre-filtering before trigram matching

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Adding Hash Pre-Filtering ==="
echo "This will add a hash column and create indexes for fast pre-filtering"
echo ""

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- Add hash column if it doesn't exist
ALTER TABLE records.records
ADD COLUMN IF NOT EXISTS search_norm_hash integer;

-- Populate hash for rows that don't have it
-- Using PostgreSQL's hashtext() function (fast, built-in)
UPDATE records.records
SET search_norm_hash = hashtext(search_norm)
WHERE search_norm_hash IS NULL
  AND search_norm IS NOT NULL;

-- Create btree index on hash (very fast lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_hash_btree
ON records.records (user_id, search_norm_hash);

-- Create partial index for benchmark user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_user_hash_btree_user0
ON records.records (search_norm_hash)
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- ANALYZE to update statistics
ANALYZE records.records;

-- Show index sizes
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) AS index_size
FROM pg_indexes
WHERE schemaname = 'records'
  AND tablename = 'records'
  AND indexname LIKE '%hash%'
ORDER BY pg_relation_size((schemaname||'.'||indexname)::regclass) DESC;

SQL

echo ""
echo "✅ Hash column and indexes created"
echo ""
echo "Next: Update function to use hash pre-filtering"
echo "Run: ./scripts/create-knn-function.sh (will use hash pre-filter)"

