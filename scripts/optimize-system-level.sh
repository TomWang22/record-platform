#!/usr/bin/env bash
set -Eeuo pipefail

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

echo "=== Applying System-Level Optimizations for <20ms Tail Latency ==="
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
-- Apply system-level settings (persist across restarts)
ALTER SYSTEM SET work_mem = '128MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET max_parallel_workers = 0;
ALTER SYSTEM SET max_parallel_workers_per_gather = 0;
ALTER SYSTEM SET commit_delay = 0;
ALTER SYSTEM SET commit_siblings = 0;
ALTER SYSTEM SET lock_timeout = '500ms';
ALTER SYSTEM SET statement_timeout = '2s';
SELECT pg_reload_conf();

-- Show current settings
SHOW work_mem;
SHOW max_parallel_workers_per_gather;
SHOW commit_delay;
SQL

echo ""
echo "✅ System-level optimizations applied"
echo "   These settings will persist across pod restarts"
