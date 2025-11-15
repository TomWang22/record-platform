#!/usr/bin/env bash
set -Eeuo pipefail

# Fix KNN performance issues
# Usage: ./scripts/fix-knn-performance.sh

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Fixing KNN Performance ==="
echo "Pod: $PGPOD"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- 1. Check if search_norm column exists
SELECT 'Checking search_norm column...' as step;
SELECT column_name FROM information_schema.columns 
WHERE table_schema='records' AND table_name='records' AND column_name='search_norm';

-- 2. Create GiST index for KNN (if missing)
SELECT 'Creating GiST index on search_norm...' as step;
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

-- 3. Create hot tenant partial index
SELECT 'Creating hot tenant partial index...' as step;
CREATE INDEX IF NOT EXISTS records_hot_knn_main
  ON records.records USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- 4. Optimize TRGM indexes (fastupdate=off for better query performance)
SELECT 'Optimizing TRGM indexes...' as step;
DROP INDEX IF EXISTS idx_records_artist_trgm;
CREATE INDEX idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops) WITH (fastupdate=off);

DROP INDEX IF EXISTS idx_records_name_trgm;
CREATE INDEX idx_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops) WITH (fastupdate=off);

-- 5. Run VACUUM ANALYZE
SELECT 'Running VACUUM ANALYZE...' as step;
VACUUM ANALYZE records.records;

-- 6. Verify indexes
SELECT 'Verifying indexes...' as step;
SELECT 
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'records' 
  AND tablename = 'records'
  AND (indexname LIKE '%search_norm%' OR indexname LIKE '%trgm%' OR indexname LIKE '%hot%')
ORDER BY indexname;

SELECT 'Done!' as status;
SQL

echo ""
echo "=== Testing KNN query plan ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM records.records
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  AND search_norm IS NOT NULL
ORDER BY search_norm <-> 'test'
LIMIT 10;
SQL

echo ""
echo "=== Fix complete ==="

