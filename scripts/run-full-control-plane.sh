#!/usr/bin/env bash
# Run the full control plane (pgbench + k6 + all suites) in a terminal-friendly way.
# Use this if the terminal hangs or drops output when running run-preflight-scale-and-all-suites.sh directly.
#
# Options:
#   No args: run in foreground with tee to a log (you see output and have a log file).
#   --background: run in background with nohup; output only to log (no terminal). Then: tail -f <log>.
#   --suites-only: RUN_FULL_LOAD=0 (skip pgbench/k6, run suites only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG="${CONTROL_PLANE_LOG:-$REPO_ROOT/preflight-full-$(date +%Y%m%d-%H%M%S).log}"
SUITES_ONLY=0
BACKGROUND=0
for arg in "$@"; do
  case "$arg" in
    --background) BACKGROUND=1 ;;
    --suites-only) SUITES_ONLY=1 ;;
  esac
done

export RUN_FULL_LOAD=1
export KILL_STALE_FIRST=1
[[ "$SUITES_ONLY" -eq 1 ]] && export RUN_FULL_LOAD=0

echo "Log file: $LOG"
echo ""

if [[ "$BACKGROUND" -eq 1 ]]; then
  echo "Running in background (nohup). To watch: tail -f $LOG"
  nohup bash -c "RUN_FULL_LOAD=$RUN_FULL_LOAD KILL_STALE_FIRST=$KILL_STALE_FIRST '$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh'" >> "$LOG" 2>&1 &
  echo "PID: $!"
  exit 0
fi

RUN_FULL_LOAD=$RUN_FULL_LOAD KILL_STALE_FIRST=$KILL_STALE_FIRST "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee "$LOG"
