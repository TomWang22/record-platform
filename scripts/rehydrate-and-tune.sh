#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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
echo "== Copying benchmark CSVs to docs/bench/sweeps =="
mkdir -p docs/bench/sweeps
for f in ./bench_sweep_*.csv ./bench_export_*.csv; do
  if [[ -f "$f" ]]; then
    cp "$f" "docs/bench/sweeps/${f##*/}"
  fi
done

echo "All done. Latest CSVs are in repo root (bench_sweep*.csv)." 

