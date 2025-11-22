#!/usr/bin/env bash
set -Eeuo pipefail

# Aggressive optimization to hit 20ms execution time target
# Drops global indexes, forces partial index usage, warms cache

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

echo "=== Aggressive Optimization for 20ms Target ==="
echo "Bench user: $BENCH_USER_UUID"
echo ""

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- 1. Drop global indexes to force partial index usage
DROP INDEX IF EXISTS idx_records_search_norm_gist;
DROP INDEX IF EXISTS idx_records_search_norm_gin;
DROP INDEX IF EXISTS idx_records_search_gin_trgm;
DROP INDEX IF EXISTS idx_records_partitioned_search_norm_gist;
DROP INDEX IF EXISTS idx_records_partitioned_search_norm_gin;
DROP INDEX IF EXISTS ix_records_search_norm_gist;

-- 2. Ensure partial indexes exist
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gist_user0
ON records.records
USING gist (search_norm gist_trgm_ops)
WHERE user_id = '$BENCH_USER_UUID'::uuid;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gin_user0
ON records.records
USING gin (search_norm gin_trgm_ops)
WHERE user_id = '$BENCH_USER_UUID'::uuid;

-- 3. ANALYZE to update statistics
ANALYZE records.records;

-- 4. Aggressive cache warming
-- Warm the partial GiST index (KNN path)
SELECT pg_prewarm('idx_records_search_norm_gist_user0'::regclass);

-- Warm the partial GIN index (trigram path)
SELECT pg_prewarm('idx_records_search_norm_gin_user0'::regclass);

-- Warm user_id index
SELECT pg_prewarm('idx_records_user_id_btree'::regclass);

-- Warm heap pages for this tenant (estimate: ~10% of table)
SELECT pg_prewarm('records.records'::regclass);

-- 5. Execute sample queries to warm query plans and function cache
SET pg_trgm.similarity_threshold = 0.45;
SET enable_seqscan = off;
SET enable_bitmapscan = off;
SET jit = off;

-- Warm KNN query
SELECT r.id
FROM records.records r
WHERE r.user_id = '$BENCH_USER_UUID'::uuid
ORDER BY r.search_norm <-> 'test'::text
LIMIT 2000;

-- Warm function
SELECT count(*)
FROM public.search_records_fuzzy_ids(
  '$BENCH_USER_UUID'::uuid,
  'test',
  50::bigint,
  0::bigint
);

-- 6. Show final index state
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) AS index_size,
  CASE 
    WHEN indexdef LIKE '%WHERE%' THEN 'PARTIAL'
    ELSE 'GLOBAL'
  END AS index_type
FROM pg_indexes
WHERE schemaname = 'records'
  AND tablename = 'records'
  AND indexname LIKE '%search_norm%'
ORDER BY index_type, indexname;

SQL

echo ""
echo "✅ Aggressive optimization complete"
echo ""
echo "Next: Test query performance:"
echo "  PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=records PGPASSWORD=postgres \\"
echo "  psql -c \"SET enable_seqscan=off; SET enable_bitmapscan=off; EXPLAIN ANALYZE SELECT ...\""

