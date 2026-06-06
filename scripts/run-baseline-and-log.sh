#!/usr/bin/env bash
# Run full preflight + test suite, pipe to timestamped log for baseline/reference/regression.
# Usage: ./scripts/run-baseline-and-log.sh
# Log: /tmp/baseline-run-YYYYMMDD-HHMMSS.log
# Analyze: ./scripts/analyze-baseline-log.sh /tmp/baseline-run-*.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASELINE_LOG="/tmp/baseline-run-$(date +%Y%m%d-%H%M%S).log"
echo "Logging to: $BASELINE_LOG"
echo "=== Preflight + Full Test Suite Baseline Run ===" | tee "$BASELINE_LOG"
echo "Started: $(date -Iseconds)" | tee -a "$BASELINE_LOG"

SKIP_FULL_PREFLIGHT=0 "$SCRIPT_DIR/run-all-test-suites.sh" 2>&1 | tee -a "$BASELINE_LOG"

echo "Completed: $(date -Iseconds)" | tee -a "$BASELINE_LOG"
echo ""
echo "✅ Log saved: $BASELINE_LOG"
echo "Analyze: ./scripts/analyze-baseline-log.sh $BASELINE_LOG"
