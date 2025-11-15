#!/usr/bin/env bash
set -Eeuo pipefail

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

echo "=== Extreme Tail Latency Optimization ==="
echo "Target: p95-pmax < 20ms at ALL client counts"
echo "Target: TPS > 30k"
echo ""

# 1. Increase work_mem even more for better sorting
echo "=== 1. Increasing work_mem to 128MB ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET work_mem = '128MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
SELECT pg_reload_conf();
SHOW work_mem;
SQL

# 2. Disable parallelism completely for lower variance
echo ""
echo "=== 2. Disabling parallelism for lower latency variance ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET max_parallel_workers_per_gather = 0;
ALTER SYSTEM SET max_parallel_workers = 0;
ALTER SYSTEM SET max_parallel_maintenance_workers = 0;
SELECT pg_reload_conf();
SQL

# 3. Optimize checkpoint settings for lower latency spikes
echo ""
echo "=== 3. Optimizing checkpoint settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '30min';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET commit_delay = 0;
ALTER SYSTEM SET commit_siblings = 0;
SELECT pg_reload_conf();
SQL

# 4. Increase shared_buffers and optimize memory
echo ""
echo "=== 4. Optimizing memory settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET shared_buffers = '1GB';
ALTER SYSTEM SET effective_cache_size = '16GB';
ALTER SYSTEM SET temp_buffers = '32MB';
SELECT pg_reload_conf();
SQL

# 5. Disable autovacuum during benchmarks (reduce interference)
echo ""
echo "=== 5. Optimizing autovacuum ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET autovacuum = on;
ALTER SYSTEM SET autovacuum_naptime = '60s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.1;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.05;
SELECT pg_reload_conf();
SQL

# 6. Optimize for low latency queries
echo ""
echo "=== 6. Setting low-latency query settings ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
ALTER SYSTEM SET lock_timeout = '500ms';
ALTER SYSTEM SET statement_timeout = '2s';
ALTER SYSTEM SET tcp_keepalives_idle = 600;
ALTER SYSTEM SET tcp_keepalives_interval = 30;
ALTER SYSTEM SET tcp_keepalives_count = 3;
SELECT pg_reload_conf();
SQL

# 7. Prewarm critical indexes
echo ""
echo "=== 7. Prewarming critical indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SET search_path = records, public;
SELECT pg_prewarm('idx_records_artist_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_artist_trgm');
SELECT pg_prewarm('idx_records_name_trgm', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_name_trgm');
SELECT pg_prewarm('idx_records_user_updated_desc', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_user_updated_desc');
SELECT pg_prewarm('idx_records_search_norm_gin', 'buffer') WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_search_norm_gin');
SQL

echo ""
echo "=== Optimization Complete ==="
echo "✅ work_mem = 128MB (reduces disk spills)"
echo "✅ Parallelism disabled (lower variance)"
echo "✅ Checkpoints optimized"
echo "✅ Memory settings increased"
echo "✅ Low-latency query settings"
echo "✅ Indexes prewarmed"
