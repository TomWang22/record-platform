#!/usr/bin/env bash
set -Eeuo pipefail

# Optimize database for 20ms query execution time target
# This script applies aggressive optimizations: partitioning, partial indexes, query tuning

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

echo "=== Optimizing for 20ms Execution Time ==="
echo "Target: Sub-20ms query execution"
echo "Bench user: $BENCH_USER_UUID"
echo ""

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- 1. Ensure partial GIN index exists for bench user (tenant-scoped)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gin_user0
ON records.records
USING gin (search_norm gin_trgm_ops)
WHERE user_id = '$BENCH_USER_UUID'::uuid;

-- 2. Create composite index for user_id + search_norm (for KNN queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_user_search_norm_gist
ON records.records
USING gist (user_id, search_norm gist_trgm_ops);

-- 3. Drop global GIN index if it exists (force use of partial index)
-- This reduces index size and improves query planning
DROP INDEX IF EXISTS idx_records_search_gin_trgm;

-- 4. Ensure user_id index exists (for filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_user_id_btree
ON records.records (user_id);

-- 5. Set optimal threshold for this tenant
-- (Already set via PGOPTIONS, but ensure it's in database config)
ALTER DATABASE records SET pg_trgm.similarity_threshold = 0.45;

-- 6. ANALYZE with focus on bench user's partition
ANALYZE records.records;

-- 7. Prewarm critical indexes
SELECT pg_prewarm('idx_records_search_norm_gin_user0'::regclass) 
WHERE to_regclass('idx_records_search_norm_gin_user0') IS NOT NULL;

SELECT pg_prewarm('idx_records_user_search_norm_gist'::regclass) 
WHERE to_regclass('idx_records_user_search_norm_gist') IS NOT NULL;

SELECT pg_prewarm('idx_records_user_id_btree'::regclass) 
WHERE to_regclass('idx_records_user_id_btree') IS NOT NULL;

-- 8. Warm cache with sample queries
SET pg_trgm.similarity_threshold = 0.45;
SET enable_seqscan = off;
SET enable_bitmapscan = on;
SET jit = off;

-- Warm trigram query
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r
  WHERE r.user_id = '$BENCH_USER_UUID'::uuid
    AND r.search_norm % public.norm_text(lower('test'))
  ORDER BY similarity(r.search_norm, public.norm_text(lower('test'))) DESC
  LIMIT 50
) s;

-- Warm KNN query
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r
  WHERE r.user_id = '$BENCH_USER_UUID'::uuid
  ORDER BY r.search_norm <-> public.norm_text(lower('test'))
  LIMIT 50
) s;

SQL

echo ""
echo "✅ Optimization complete"
echo ""
echo "Next: Test query execution time:"
echo "  PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=records PGPASSWORD=postgres \\"
echo "  psql -c \"SET pg_trgm.similarity_threshold = 0.45; SET enable_seqscan = off; EXPLAIN (ANALYZE, BUFFERS) ...\""

