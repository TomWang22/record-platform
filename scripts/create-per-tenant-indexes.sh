#!/usr/bin/env bash
set -Eeuo pipefail

# Create per-tenant indexes for optimal KNN and trigram performance
# This creates partial indexes scoped to the benchmark user

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

echo "=== Creating Per-Tenant Indexes ==="
echo "Bench user: $BENCH_USER_UUID"
echo ""

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- Per-tenant GIN for legacy/% path (if needed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gin_user0
ON records.records
USING gin (search_norm gin_trgm_ops)
WHERE user_id = '$BENCH_USER_UUID'::uuid;

-- Per-tenant GiST trigram index for KNN (<->) - PRIMARY PATH
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gist_user0
ON records.records
USING gist (search_norm gist_trgm_ops)
WHERE user_id = '$BENCH_USER_UUID'::uuid;

-- Ensure user_id btree index exists (for filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_user_id_btree
ON records.records (user_id);

-- ANALYZE to update planner statistics
ANALYZE records.records;

-- Show index sizes
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) AS index_size
FROM pg_indexes
WHERE schemaname = 'records'
  AND (indexname LIKE '%user0%' OR indexname LIKE '%user_id%')
ORDER BY pg_relation_size((schemaname||'.'||indexname)::regclass) DESC;

SQL

echo ""
echo "✅ Per-tenant indexes created"
echo ""
echo "Optional: Drop global indexes to force planner to use partial indexes:"
echo "  DROP INDEX IF EXISTS idx_records_search_norm_gist;"
echo "  DROP INDEX IF EXISTS idx_records_search_norm_gin;"

