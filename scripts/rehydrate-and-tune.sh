#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Ensure kubectl shim (automatic retries for TLS handshake timeouts) is first in PATH
if [[ -z "${KUBECTL_REAL_BIN:-}" ]]; then
  export KUBECTL_REAL_BIN="$(command -v kubectl)"
fi
export PATH="$ROOT/scripts/shims:$PATH"
export KUBECTL_MAX_RETRIES="${KUBECTL_MAX_RETRIES:-5}"
export KUBECTL_RETRY_SLEEP="${KUBECTL_RETRY_SLEEP:-2}"
export KUBECTL_REQUEST_TIMEOUT="${KUBECTL_REQUEST_TIMEOUT:-10s}"

BUNDLE_PATH="${BUNDLE_PATH:-$ROOT/backups/records_final_20251113_060218.tar.gz}"
DB_NAME="${DB_NAME:-records}"

echo "== Rehydrating $DB_NAME from $BUNDLE_PATH =="
cp "$BUNDLE_PATH" /tmp/pg_bundle.pkg
./scripts/restore-run.sh "$DB_NAME"

echo "== Applying tuning scripts (tail latency, system, DB) =="
./scripts/optimize-tail-latency.sh
./scripts/optimize-tail-latency-aggressive.sh
./scripts/optimize-tail-latency-ultra.sh
./scripts/optimize-system-level.sh
./scripts/optimize-db-for-performance.sh
./scripts/fix-knn-performance.sh
./scripts/create-knn-function.sh

echo "== Warming caches and hot slice =="
./scripts/warm_cache.sh
./scripts/dbpack.sh --ensure-app --prep-hot --prewarm

echo "== Running benchmark sweep =="
./scripts/run_pgbench_sweep.sh

echo "All done. Latest CSVs are in repo root (bench_sweep*.csv)." 



