#!/usr/bin/env bash
# Run all 8 pgbench sweeps (standalone, deep) once, save results to a timestamped dir, and write a short summary.
# Use from host cron for daily runs, e.g.: 0 5 * * * /path/to/scripts/run-daily-pgbench-standalone-with-results.sh
#
# Optional: PGBENCH_RESULTS_PARENT=/var/log/record-platform ./scripts/run-daily-pgbench-standalone-with-results.sh
# Requires: Postgres 5433–5440 up, migrations applied. Same prereqs as run-all-8-pgbench-standalone.sh.
# Automatically ensures DBs are up (starts docker compose postgres* if needed) via ensure-pgbench-dbs-ready.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Ensure all 8 Postgres instances are up (start via docker compose if needed)
if [[ -x "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh" ]]; then
  "$SCRIPT_DIR/ensure-pgbench-dbs-ready.sh" || exit 1
else
  echo "⚠️  ensure-pgbench-dbs-ready.sh not found; proceeding (pgbench may fail if DBs are down)."
fi

PGBENCH_RESULTS_PARENT="${PGBENCH_RESULTS_PARENT:-/tmp}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$PGBENCH_RESULTS_PARENT/daily-pgbench-$TS"
mkdir -p "$OUT_DIR"
FULL_LOG="$OUT_DIR/full.log"
SUMMARY="$OUT_DIR/summary.txt"
EXPLAIN_LOG="$OUT_DIR/explain-all-schemas-dbs.log"

echo "=== Daily pgbench run: $TS ==="
echo "Results: $OUT_DIR"

export PGBENCH_LOG="$OUT_DIR/pgbench.log"
export RUN_EXPLAIN_ALL=1
export RUN_PLAN_DUMP=1
export PGBENCH_MODE="${PGBENCH_MODE:-deep}"
export PGBENCH_PARALLEL="${PGBENCH_PARALLEL:-0}"

if [[ ! -x "$SCRIPT_DIR/run-all-8-pgbench-standalone.sh" ]]; then
  echo "FAIL" > "$SUMMARY"
  echo "Not found or not executable: run-all-8-pgbench-standalone.sh" >> "$SUMMARY"
  exit 1
fi

exitcode=0
if "$SCRIPT_DIR/run-all-8-pgbench-standalone.sh" 2>&1 | tee "$FULL_LOG"; then
  echo "PASS" > "$SUMMARY"
  echo "All 8 pgbench sweeps completed." >> "$SUMMARY"
else
  exitcode=$?
  echo "FAIL" > "$SUMMARY"
  echo "One or more pgbench sweeps failed or had issues (exit $exitcode)." >> "$SUMMARY"
fi

# Copy combined EXPLAIN log if produced
if [[ -f "${PGBENCH_LOG%.log}-explain-all-schemas-dbs.log" ]]; then
  cp "${PGBENCH_LOG%.log}-explain-all-schemas-dbs.log" "$EXPLAIN_LOG" 2>/dev/null || true
fi

# One-line summary: TPS / failures from full log
echo "" >> "$SUMMARY"
echo "--- Run summary ---" >> "$SUMMARY"
grep -E '^(✅|⚠️|All 8 pgbench|Some pgbench|Elapsed:)' "$FULL_LOG" 2>/dev/null | tail -20 >> "$SUMMARY" || true
echo "" >> "$SUMMARY"
echo "Artifacts: full.log, pgbench.log, explain-all-schemas-dbs.log (if RUN_EXPLAIN_ALL=1), summary.txt" >> "$SUMMARY"

echo ""
echo "Summary: $SUMMARY"
cat "$SUMMARY"
echo ""
echo "Results dir: $OUT_DIR"

exit $exitcode
