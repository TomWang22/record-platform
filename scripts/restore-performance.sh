#!/usr/bin/env bash
set -Eeuo pipefail

# Restore PostgreSQL to 15k+ TPS performance level
# Usage: ./scripts/restore-performance.sh

NS="${NS:-record-platform}"
USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Restoring PostgreSQL Performance Configuration ==="
echo "Pod: $PGPOD"
echo ""

# 1. Apply deployment changes (max_connections, etc.)
echo "=== 1. Applying Deployment Configuration ==="
kubectl -n "$NS" apply -f infra/k8s/base/postgres/deploy.yaml
echo "✅ Deployment updated - restarting pod..."
kubectl -n "$NS" rollout restart deploy/postgres
echo "Waiting for pod to be ready..."
kubectl -n "$NS" wait --for=condition=ready pod -l app=postgres --timeout=120s

# Get new pod name
sleep 5
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

# 2. Verify configuration
echo ""
echo "=== 2. Verifying Configuration ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records <<'SQL'
SHOW max_connections;
SHOW shared_buffers;
SHOW effective_cache_size;
SHOW work_mem;
SHOW random_page_cost;
SHOW cpu_index_tuple_cost;
SHOW track_io_timing;
SQL

# 3. Run optimization script
echo ""
echo "=== 3. Running Optimization ==="
./scripts/optimize-and-verify.sh

# 4. Warm cache
echo ""
echo "=== 4. Warming Cache ==="
./scripts/warm_cache.sh

echo ""
echo "=== Performance Restoration Complete ==="
echo "✅ Configuration restored"
echo "✅ Indexes optimized"
echo "✅ Cache warmed"
echo ""
echo "Ready for benchmark: ./scripts/run_pgbench_sweep.sh"
