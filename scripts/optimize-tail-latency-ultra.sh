#!/usr/bin/env bash
set -Eeuo pipefail

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

echo "=== Ultra-Aggressive Tail Latency Optimization ==="
echo "Target: p95-pmax < 20ms"
echo ""

# 1. Increase work_mem to eliminate disk spills
echo "=== 1. Increasing work_mem to 128MB ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET work_mem = '128MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
SELECT pg_reload_conf();
SQL

# 2. Disable parallelism completely for lowest variance
echo ""
echo "=== 2. Disabling parallelism for lowest latency variance ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET max_parallel_workers_per_gather = 0;
ALTER SYSTEM SET max_parallel_workers = 0;
SELECT pg_reload_conf();
SQL

# 3. Aggressive checkpoint settings
echo ""
echo "=== 3. Optimizing checkpoint settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
SELECT pg_reload_conf();
SQL

# 4. Prewarm critical indexes
echo ""
echo "=== 4. Prewarming critical indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;
SELECT pg_prewarm('idx_records_partitioned_artist_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_partitioned_artist_trgm');
SELECT pg_prewarm('idx_records_partitioned_name_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_partitioned_name_trgm');
SELECT pg_prewarm('idx_records_partitioned_catalog_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_partitioned_catalog_trgm');
SELECT pg_prewarm('idx_records_user_updated_desc', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_user_updated_desc');
SQL

echo ""
echo "=== Optimization Complete ==="
echo "✅ work_mem = 128MB (eliminates disk spills)"
echo "✅ Parallelism disabled (lowest variance)"
echo "✅ Checkpoints optimized"
echo "✅ Indexes prewarmed"
