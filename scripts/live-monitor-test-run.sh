#!/usr/bin/env bash
# Live monitor test run with auto-refresh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the most recent test results directory
RESULTS_DIR=$(ls -td /Users/tom/record-platform/test-results/*-preflight-and-tests 2>/dev/null | head -1 || echo "")

if [[ -z "$RESULTS_DIR" ]]; then
  echo "❌ No test results directory found"
  exit 1
fi

MAIN_LOG="$RESULTS_DIR/main.log"
INVESTIGATION_LOG="$RESULTS_DIR/investigation.log"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

clear
say "=== Live Test Run Monitor ==="
echo "Monitoring: $RESULTS_DIR"
echo "Press Ctrl+C to exit"
echo ""

# Function to show current status
show_status() {
  clear
  say "=== Live Test Run Monitor ==="
  echo "Last updated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Monitoring: $RESULTS_DIR"
  echo ""
  
  # Show last 30 lines of main log
  if [[ -f "$MAIN_LOG" ]]; then
    say "=== Recent Test Output (last 30 lines) ==="
    tail -30 "$MAIN_LOG" 2>/dev/null | sed 's/^\[[0-9-]* [0-9:]*\] //' || echo "No output yet"
  else
    warn "Main log not found: $MAIN_LOG"
  fi
  
  echo ""
  say "=== Key Status Checks ==="
  
  # Check if preflight is done
  if grep -q "Preflight.*complete\|Preflight.*done\|Running.*test.*suite" "$MAIN_LOG" 2>/dev/null; then
    ok "Preflight appears complete"
  else
    info "Preflight in progress..."
  fi
  
  # Check for errors
  ERROR_COUNT=$(grep -ciE "error|failed|❌" "$MAIN_LOG" 2>/dev/null | tail -1 || echo "0")
  if [[ "$ERROR_COUNT" -gt 0 ]]; then
    warn "Found $ERROR_COUNT potential errors in log"
  fi
  
  # Check social service status
  if grep -qi "social.*502\|social.*upstream.*error" "$MAIN_LOG" 2>/dev/null; then
    warn "Social service errors detected"
  fi
  
  # Check DB connection status
  if grep -qi "database.*connection.*failed\|db.*connection.*failed" "$MAIN_LOG" 2>/dev/null; then
    warn "Database connection issues detected"
  fi
  
  echo ""
  say "=== Investigation Summary ==="
  if [[ -f "$INVESTIGATION_LOG" ]]; then
    # Extract key findings
    if grep -q "Social service.*targetPort.*http" "$INVESTIGATION_LOG" 2>/dev/null; then
      warn "Social service targetPort issue detected"
    fi
    if grep -q "Port 4006.*Not listening" "$INVESTIGATION_LOG" 2>/dev/null; then
      warn "Social service port 4006 not listening"
    fi
    if grep -q "Database.*Connection failed" "$INVESTIGATION_LOG" 2>/dev/null; then
      warn "Social service database connection failed"
    fi
  fi
  
  echo ""
  info "Refreshing in 5 seconds... (Ctrl+C to exit)"
}

# Main monitoring loop
while true; do
  show_status
  sleep 5
done
