#!/usr/bin/env bash
# Monitor test suites running in background
# Usage: ./scripts/monitor-test-suites.sh

set -euo pipefail

LOG_FILE="${1:-/tmp/test-suites-run.log}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "❌ Log file not found: $LOG_FILE"
  echo "Test suites may not be running."
  exit 1
fi

echo "=== Monitoring Test Suites ==="
echo "Log file: $LOG_FILE"
echo ""
echo "Press Ctrl+C to stop monitoring"
echo ""

tail -f "$LOG_FILE" 2>/dev/null || {
  echo "⚠️  Cannot tail log file. Showing last 50 lines:"
  tail -50 "$LOG_FILE"
}
