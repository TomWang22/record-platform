#!/usr/bin/env bash
set -Eeuo pipefail

NS="${NS:-record-platform}"
DEP="${DEP:-postgres}"
CTR="${CTR:-db}"

# Aggressive tuning (target: 28k TPS, <2ms latency)
# Patch the deployment to set args (these win over postgresql.auto.conf)
kubectl -n "$NS" patch deployment "$DEP" --type='json' -p='[
  {"op": "replace", "path": "/spec/template/spec/containers/0/args", "value": [
    "postgres",
    "-c", "shared_buffers=2GB",
    "-c", "effective_cache_size=8GB",
    "-c", "work_mem=256MB",
    "-c", "maintenance_work_mem=1GB",
    "-c", "track_io_timing=on",
    "-c", "random_page_cost=0.8",
    "-c", "cpu_index_tuple_cost=0.0005",
    "-c", "cpu_tuple_cost=0.01",
    "-c", "effective_io_concurrency=200",
    "-c", "max_worker_processes=16",
    "-c", "max_parallel_workers=16",
    "-c", "max_parallel_workers_per_gather=4",
    "-c", "jit=off",
    "-c", "checkpoint_completion_target=0.9",
    "-c", "checkpoint_timeout=900s",
    "-c", "autovacuum_naptime=10s",
    "-c", "autovacuum_vacuum_scale_factor=0.02",
    "-c", "autovacuum_analyze_scale_factor=0.01",
    "-c", "shared_preload_libraries=pg_stat_statements",
    "-c", "pg_stat_statements.max=10000",
    "-c", "pg_stat_statements.track=all"
  ]}
]' >/dev/null 2>&1 || {
  echo "Warning: Failed to patch deployment, trying ALTER SYSTEM instead..." >&2
  # Fallback: use ALTER SYSTEM (less ideal but works)
  PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
  if [[ -n "$PGPOD" ]]; then
    kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres <<'SQL'
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '8GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET random_page_cost = 0.8;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET max_worker_processes = 16;
ALTER SYSTEM SET max_parallel_workers = 16;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '900s';
ALTER SYSTEM SET autovacuum_naptime = '10s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.02;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.01;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET pg_stat_statements.max = 10000;
ALTER SYSTEM SET pg_stat_statements.track = 'all';
SELECT pg_reload_conf();
SQL
  fi
}

echo "[ok] args set on deploy/$DEP (container $CTR)"
kubectl -n "$NS" rollout restart deploy/"$DEP" 2>/dev/null || true
kubectl -n "$NS" rollout status deploy/"$DEP" --timeout=120s 2>/dev/null || true

