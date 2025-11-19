#!/usr/bin/env bash
set -Eeuo pipefail

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

echo "=== Aggressive Tail Latency Optimization ==="
echo "Target: p95-pmax < 20ms"
echo ""

# 1. Increase work_mem aggressively for sorting
echo "=== 1. Increasing work_mem to 64MB ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
SELECT pg_reload_conf();
SQL

# 2. Reduce parallelism for lower variance
echo ""
echo "=== 2. Reducing parallelism for lower latency variance ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET max_parallel_workers = 8;
SELECT pg_reload_conf();
SQL

# 3. Optimize checkpoint settings
echo ""
echo "=== 3. Optimizing checkpoint settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
SELECT pg_reload_conf();
SQL

# 4. Ensure indexes are optimized
echo ""
echo "=== 4. Verifying critical indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;
-- Ensure TRGM indexes exist with fastupdate=off
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm ON records.records USING gin(artist gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_name_trgm ON records.records USING gin(name gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm ON records.records USING gin(catalog_number gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_records_user_updated_desc ON records.records(user_id, updated_at DESC);
SQL

# 5. Prewarm critical data
echo ""
echo "=== 5. Prewarming critical indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;
SELECT pg_prewarm('idx_records_artist_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_artist_trgm');
SELECT pg_prewarm('idx_records_name_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_name_trgm');
SELECT pg_prewarm('idx_records_user_updated_desc', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_user_updated_desc');
SQL

echo ""
echo "=== Optimization Complete ==="
echo "✅ work_mem = 64MB (reduces disk spills)"
echo "✅ Reduced parallelism (lower variance)"
echo "✅ Optimized checkpoints"
echo "✅ Indexes verified and prewarmed"
