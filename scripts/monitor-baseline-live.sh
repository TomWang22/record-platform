#!/usr/bin/env bash
# Live monitoring for baseline test run
# Usage: ./scripts/monitor-baseline-live.sh [log-file]

set -euo pipefail

LOG="${1:-/tmp/baseline-run-$(ls -t /tmp/baseline-run-*.log 2>/dev/null | head -1 | xargs basename)}"
[[ ! -f "$LOG" ]] && LOG="/tmp/baseline-run-$(date +%Y%m%d)-*.log"
LOG=$(ls -t $LOG 2>/dev/null | head -1 || echo "")

if [[ -z "$LOG" ]] || [[ ! -f "$LOG" ]]; then
  echo "❌ No baseline log found. Start with: ./scripts/run-baseline-and-log.sh"
  exit 1
fi

echo "📊 Monitoring: $LOG"
echo "Press Ctrl+C to stop"
echo ""

LAST_SIZE=0
STUCK_COUNT=0

while true; do
  clear
  echo "=== BASELINE RUN MONITOR ==="
  echo "Log: $LOG"
  echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  
  # Check if process is running
  RUNNING=$(ps aux | grep -E "run-baseline-and-log|run-all-test-suites" | grep -v grep | wc -l | tr -d ' ')
  if [[ "$RUNNING" -gt 0 ]]; then
    echo "✅ Process running ($RUNNING processes)"
  else
    echo "⚠️  No baseline processes detected"
  fi
  
  # Log size and growth
  CURRENT_SIZE=$(stat -f%z "$LOG" 2>/dev/null || stat -c%s "$LOG" 2>/dev/null || echo 0)
  SIZE_KB=$((CURRENT_SIZE / 1024))
  if [[ $CURRENT_SIZE -gt $LAST_SIZE ]]; then
    GROWTH=$((CURRENT_SIZE - LAST_SIZE))
    GROWTH_KB=$((GROWTH / 1024))
    echo "📈 Size: ${SIZE_KB}KB (+${GROWTH_KB}KB since last check)"
    STUCK_COUNT=0
  else
    STUCK_COUNT=$((STUCK_COUNT + 1))
    echo "⚠️  Size: ${SIZE_KB}KB (no growth for ${STUCK_COUNT}x5s = $((STUCK_COUNT * 5))s)"
    if [[ $STUCK_COUNT -ge 12 ]]; then
      echo "❌ STUCK for 60s+ - may need restart"
    fi
  fi
  LAST_SIZE=$CURRENT_SIZE
  
  echo ""
  echo "--- Last 15 lines ---"
  tail -15 "$LOG" | sed 's/\x1b\[[0-9;]*m//g'
  
  echo ""
  echo "--- Progress Summary ---"
  grep -E "^(✅|⚠️|❌|PASSED|FAILED)" "$LOG" 2>/dev/null | tail -10 || echo "(no results yet)"
  
  sleep 5
done
