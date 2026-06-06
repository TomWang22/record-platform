#!/usr/bin/env bash
# Thin wrapper: run preflight with optional single-log and env defaults.
# Telemetry is built into run-preflight-scale-and-all-suites.sh (PREFLIGHT_TELEMETRY=1 by default).
# This script is for convenience when you want one combined log file and/or RUN_FULL_LOAD=0.
#
# Usage: ./scripts/run-preflight-with-telemetry.sh
#
# Env (passed through to main script):
#   RUN_FULL_LOAD=0     Default here: preflight only (no pgbench/k6/suites). Set 1 for full pipeline.
#   PREFLIGHT_MAIN_LOG  Set to LOG so all output tees to one file; Ctrl+C leaves it for analysis.
#   TELEMETRY_PERF=1    Record perf during run (main script handles it when PREFLIGHT_TELEMETRY=1).
#   TELEMETRY_HTOP=1    Run htop --batch once after preflight (main script handles it).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TS=$(date +%Y%m%d-%H%M%S)
LOG="preflight-run-${TS}.log"

echo "=== Preflight (telemetry is automatic in main script) ==="
echo "  Single log: $LOG"
echo ""

METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH="${REISSUE_STEP2_VIA_SSH:-0}" \
  RUN_FULL_LOAD="${RUN_FULL_LOAD:-0}" PREFLIGHT_MAIN_LOG="$REPO_ROOT/$LOG" \
  "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"
exit $?
