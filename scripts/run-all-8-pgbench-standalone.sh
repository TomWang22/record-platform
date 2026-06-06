#!/usr/bin/env bash
# Run all 8 pgbench sweeps (records + 7 services) without preflight.
# Deep mode by default: clients 8..256, EXPLAIN ANALYZE for all schemas/DBs, Little's Law (lat_est_ms).
# Use when control-plane is broken or you only need DB tuning metrics; survives disconnect when run with nohup.
#
# Prerequisites: Postgres on 5433–5440 (e.g. docker-compose up), migrations applied (infra/db/*.sql).
# Same 8 DBs as preflight step 8: records, social, auth, shopping, listings, analytics, auction-monitor, python-ai.
#
# Usage:
#   ./scripts/run-all-8-pgbench-standalone.sh
#   nohup ./scripts/run-all-8-pgbench-standalone.sh >> /tmp/pgbench-standalone.log 2>&1 &
#   tail -f /tmp/pgbench-standalone.log   # progress survives closing terminal
#
# Env:
#   PGBENCH_MODE       — deep (default): clients 8,16,24,32,48,64,96,128,192,256; quick = shorter sweep
#   PGBENCH_LOG        — main run log (default: /tmp/pgbench-standalone-<timestamp>.log)
#   PGBENCH_PARALLEL   — 1 = run 8 sweeps in parallel; 0 (default) = sequential (clear progress in log)
#   RUN_PLAN_DUMP      — 1 (default): each sweep runs EXPLAIN ANALYZE for its schema(s)
#   RUN_EXPLAIN_ALL    — 1 (default): at end, run EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs/schemas and write combined log
#   PLAN_CACHE_MODE    — force_generic_plan (default): no custom plans; all statements count for Little's Law
#   COLD_FIRST=1, RUN_COLD_CACHE=true — set by default (cold then warm per client count)
#
# Outputs:
#   $PGBENCH_LOG — full run log (progress, TPS, latencies, per-sweep output).
#   ${PGBENCH_LOG%.log}-explain-all-schemas-dbs.log — EXPLAIN ANALYZE for all 8 DBs/schemas (when RUN_EXPLAIN_ALL=1).
#   Little's Law: lat_est_ms = 1000 * clients / tps in each sweep CSV (records and others where implemented).
#
# See scripts/PGBENCH_HARDENING.md and scripts/DB_TUNING_7_SERVICES.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

# Deep by default: 8..256 clients, full EXPLAIN, plan_cache_mode so no rogue prepared statements
PGBENCH_MODE="${PGBENCH_MODE:-deep}"
PGBENCH_LOG="${PGBENCH_LOG:-/tmp/pgbench-standalone-$(date +%Y%m%d-%H%M%S).log}"
PGBENCH_PARALLEL="${PGBENCH_PARALLEL:-0}"
export RUN_PLAN_DUMP="${RUN_PLAN_DUMP:-1}"
export RUN_EXPLAIN_ALL="${RUN_EXPLAIN_ALL:-1}"
export PLAN_CACHE_MODE="${PLAN_CACHE_MODE:-force_generic_plan}"
export COLD_FIRST=1
export RUN_COLD_CACHE=true
export CHECK_RECORDS_DB="${CHECK_RECORDS_DB:-1}"

# Optional: run detached (nohup) so closing the terminal doesn't kill the run
RUN_DETACHED="${RUN_DETACHED:-0}"
if [[ "${RUN_DETACHED}" == "1" ]]; then
  say "RUN_DETACHED=1: starting in background (nohup); progress in $PGBENCH_LOG"
  nohup "$SCRIPT_DIR/run-all-8-pgbench-standalone.sh" >> "$PGBENCH_LOG" 2>&1 &
  echo "  PID: $!"
  echo "  tail -f $PGBENCH_LOG"
  exit 0
fi

say "All 8 pgbench sweeps (standalone, no preflight)"
echo "  Mode: $PGBENCH_MODE (deep = 8..256 clients)"
echo "  Log:  $PGBENCH_LOG"
echo "  Parallel: $PGBENCH_PARALLEL"
echo "  RUN_PLAN_DUMP=$RUN_PLAN_DUMP, PLAN_CACHE_MODE=$PLAN_CACHE_MODE (no rogue prepared statements)"
echo "  Little's Law: lat_est_ms = 1000*clients/tps in sweep CSVs"
echo ""

failed=0
_start_ts=$(date +%s)

_run_one() {
  local name="$1"
  local script="$2"
  local extra_env="${3:-}"
  if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
    warn "Skip $name ($script not found)"
    return 1
  fi
  say "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $name..."
  if [[ -n "$extra_env" ]]; then
    eval "export $extra_env"
  fi
  MODE="$PGBENCH_MODE" "$SCRIPT_DIR/$script" 2>&1 | tee -a "$PGBENCH_LOG" || return 1
  return 0
}

if [[ "$PGBENCH_PARALLEL" == "1" ]]; then
  _run_one "Records (5433)" "run_pgbench_sweep.sh" "" &
  _run_one "Social (5434)" "run_social_pgbench_sweep.sh" "" &
  _run_one "Auth (5437)" "run_auth_pgbench_sweep.sh" "" &
  _run_one "Shopping (5436)" "run_shopping_pgbench_sweep.sh" "" &
  _run_one "Listings (5435)" "run_listings_pgbench_sweep.sh" "" &
  _run_one "Analytics (5439)" "run_analytics_pgbench_sweep.sh" "" &
  _run_one "Auction-monitor (5438)" "run_auction-monitor_pgbench_sweep.sh" "" &
  _run_one "Python-AI (5440)" "run_python-ai_pgbench_sweep.sh" "" &
  wait
  failed=0
else
  _run_one "Records (5433)" "run_pgbench_sweep.sh" "CHECK_RECORDS_DB=$CHECK_RECORDS_DB" || failed=$((failed + 1))
  _run_one "Social (5434)" "run_social_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Auth (5437)" "run_auth_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Shopping (5436)" "run_shopping_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Listings (5435)" "run_listings_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Analytics (5439)" "run_analytics_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Auction-monitor (5438)" "run_auction-monitor_pgbench_sweep.sh" "" || failed=$((failed + 1))
  _run_one "Python-AI (5440)" "run_python-ai_pgbench_sweep.sh" "" || failed=$((failed + 1))
fi

_end_ts=$(date +%s)
_elapsed=$((_end_ts - _start_ts))
info "Elapsed: ${_elapsed}s"

# Combined EXPLAIN ANALYZE log for all 8 DBs/schemas
EXPLAIN_COMBINED="${PGBENCH_LOG%.log}-explain-all-schemas-dbs.log"
if [[ "${RUN_EXPLAIN_ALL}" == "1" ]] && [[ -f "$SCRIPT_DIR/apply-tune-and-explain-all-dbs.sh" ]]; then
  say "Gathering EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs/schemas..."
  RUN_EXPLAIN_ONLY=1 RUN_FULL_PGBENCH=0 RUN_QUICK_PGBENCH=0 "$SCRIPT_DIR/apply-tune-and-explain-all-dbs.sh" >> "$PGBENCH_LOG" 2>&1 || true
  EXPLAIN_DIR=$(ls -td "$REPO_ROOT/bench_logs/explain-all-"* 2>/dev/null | head -1 || true)
  if [[ -n "$EXPLAIN_DIR" ]] && [[ -d "$EXPLAIN_DIR" ]]; then
    {
      echo "=== EXPLAIN (ANALYZE, BUFFERS) for all schemas and DBs ==="
      echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "Source: $EXPLAIN_DIR"
      echo "Little's Law: lat_est_ms = 1000 * clients / tps (in sweep CSVs); plan_cache_mode=$PLAN_CACHE_MODE (no custom plans)"
      echo ""
      for f in "$EXPLAIN_DIR"/*.txt; do
        [[ -f "$f" ]] || continue
        echo "=== $(basename "$f" .txt) ==="
        cat "$f"
        echo ""
      done
    } > "$EXPLAIN_COMBINED"
    ok "EXPLAIN for all schemas/DBs -> $EXPLAIN_COMBINED"
  else
    warn "No explain-all-* dir found; combined EXPLAIN log not written"
  fi
fi

echo ""
if [[ "$failed" -eq 0 ]]; then
  ok "All 8 pgbench sweeps complete (log: $PGBENCH_LOG)"
  [[ -n "${EXPLAIN_COMBINED:-}" ]] && [[ -f "${EXPLAIN_COMBINED}" ]] && echo "  EXPLAIN log: $EXPLAIN_COMBINED"
else
  warn "Some pgbench sweeps had issues (failures: $failed); see $PGBENCH_LOG and PGBENCH_HARDENING.md"
fi
exit $failed
