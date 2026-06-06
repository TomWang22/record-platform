#!/usr/bin/env bash
# Start live monitoring in background and show status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

say "=== Starting Live Test Monitoring ==="

# Find the most recent test results directory
RESULTS_DIR=$(ls -td /Users/tom/record-platform/test-results/*-preflight-and-tests 2>/dev/null | head -1 || echo "")

if [[ -z "$RESULTS_DIR" ]]; then
  echo "❌ No test results directory found"
  echo "Run './scripts/run-preflight-and-test-suite.sh' first"
  exit 1
fi

ok "Monitoring: $RESULTS_DIR"
info "Press Ctrl+C to stop monitoring"
echo ""

# Run live monitor
exec "$SCRIPT_DIR/live-monitor-test-run.sh"
