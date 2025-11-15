#!/usr/bin/env bash
set -Eeuo pipefail

# Optimize for tail latency (p95, p99, etc.)
NS="${NS:-record-platform}"
USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Optimizing for Tail Latency ==="
echo "Pod: $PGPOD"
echo ""

# 1. Increase work_mem for better sorting (reduces disk spills)
echo "=== 1. Setting work_mem for better sorting ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET work_mem = '32MB';
SELECT pg_reload_conf();
SHOW work_mem;
SQL

# 2. Ensure indexes exist and are optimized
echo ""
echo "=== 2. Ensuring TRGM indexes exist ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;

-- TRGM indexes on individual columns (for ILIKE queries)
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm ON records.records USING gin(artist gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_name_trgm ON records.records USING gin(name gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm ON records.records USING gin(catalog_number gin_trgm_ops) WITH (fastupdate=off);

-- Composite index for user_id + updated_at (for ORDER BY)
CREATE INDEX IF NOT EXISTS idx_records_user_updated_desc ON records.records(user_id, updated_at DESC);

-- GIN index on search_norm (for KNN)
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin ON records.records USING gin(search_norm gin_trgm_ops) WITH (fastupdate=off);

-- GiST index on search_norm (for KNN distance)
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist ON records.records USING gist(search_norm gist_trgm_ops);
SQL

# 3. VACUUM ANALYZE to refresh statistics
echo ""
echo "=== 3. Running VACUUM ANALYZE ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;
VACUUM ANALYZE records.records;

-- Analyze partitions
DO $$
DECLARE part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname LIKE 'records_p%' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
  END LOOP;
END $$;
SQL

# 4. Set aggressive planner settings for index preference
echo ""
echo "=== 4. Setting Aggressive Planner Settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET random_page_cost = 0.8;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_cache_size = '8GB';
SELECT pg_reload_conf();
SQL

# 5. Prewarm critical indexes
echo ""
echo "=== 5. Prewarming Critical Indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;

-- Prewarm TRGM indexes
SELECT pg_prewarm('idx_records_artist_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_artist_trgm');
SELECT pg_prewarm('idx_records_name_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_name_trgm');
SELECT pg_prewarm('idx_records_catalog_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_catalog_trgm');
SELECT pg_prewarm('idx_records_user_updated_desc', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_user_updated_desc');
SELECT pg_prewarm('idx_records_search_norm_gin', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_search_norm_gin');
SELECT pg_prewarm('idx_records_search_norm_gist', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_search_norm_gist');
SQL

echo ""
echo "=== Tail Latency Optimization Complete ==="
echo "✅ work_mem increased to 32MB (better sorting)"
echo "✅ TRGM indexes created/verified"
echo "✅ Statistics refreshed"
echo "✅ Planner settings optimized"
echo "✅ Indexes prewarmed"
