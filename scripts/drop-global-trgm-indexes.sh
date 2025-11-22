#!/usr/bin/env bash
# Drop global trigram indexes to force use of per-tenant partial indexes
# This ensures benchmarks test the optimized per-tenant index strategy

set -Eeuo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Dropping Global Trigram Indexes ==="
echo "This forces use of per-tenant partial indexes (e.g., idx_records_search_norm_gin_bench)"
echo "Using Postgres at ${PGHOST}:${PGPORT}..."

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- Drop global GiST indexes (interfere with GIN selection)
-- These are created by optimize-db-for-performance.sh and other scripts
DROP INDEX IF EXISTS records.idx_records_partitioned_search_norm_gist;
DROP INDEX IF EXISTS records.ix_records_search_norm_gist;
DROP INDEX IF EXISTS records.idx_records_search_norm_gist_bench;

-- Drop global GIN indexes (forces use of per-tenant partial GIN)
-- These are created by optimize-db-for-performance.sh and other scripts
DROP INDEX IF EXISTS records.idx_records_partitioned_search_norm_gin;

-- Show remaining search indexes
SELECT 
  indexrelname AS indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'records' 
  AND relname = 'records'
  AND (indexrelname LIKE '%search%' OR indexrelname LIKE '%gin%' OR indexrelname LIKE '%gist%')
ORDER BY pg_relation_size((schemaname||'.'||indexrelname)::regclass) DESC;
SQL

echo ""
echo "✅ Global trigram indexes dropped!"
echo "Queries should now use per-tenant partial indexes (much faster)"

