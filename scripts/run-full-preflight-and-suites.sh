#!/usr/bin/env bash
# One command to run the full control plane: pgbench + k6 + all suites.
# Usage: ./scripts/run-full-preflight-and-suites.sh
#   Optional: --background  (nohup + log; then tail -f preflight-full-*.log)
#   Optional: --suites-only (skip pgbench/k6)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG="$REPO_ROOT/preflight-full-$(date +%Y%m%d-%H%M%S).log"

if [[ "${1:-}" == "--background" ]]; then
  echo "Running in background. Log: $LOG"
  echo "  tail -f $LOG"
  nohup bash -c 'RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 "'"$SCRIPT_DIR"'/run-preflight-scale-and-all-suites.sh"' >> "$LOG" 2>&1 &
  echo "PID: $!"
  exit 0
fi

if [[ "${1:-}" == "--suites-only" ]]; then
  RUN_FULL_LOAD=0 KILL_STALE_FIRST=1 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee "$LOG"
  exit $?
fi

RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee "$LOG"
