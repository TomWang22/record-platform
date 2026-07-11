#!/usr/bin/env bash
# Phase 32H — host power/network telemetry collector.
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
INTERVAL="${2:-1}"
TELEM="$OUT/telemetry"
mkdir -p "$TELEM"

pmset -g log > "$TELEM/pmset-log-before.txt" 2>/dev/null || echo "BLOCKED: pmset log" > "$TELEM/pmset-log-before.txt"

{
  date -u
  uptime
  pmset -g 2>/dev/null || true
  pmset -g assertions 2>/dev/null || true
  pmset -g custom 2>/dev/null || true
  pmset -g batt 2>/dev/null || true
  scutil --nwi 2>/dev/null || true
} > "$TELEM/host-baseline.txt" 2>&1

HOST_JSONL="$TELEM/host-telemetry.jsonl"
POWER_JSONL="$TELEM/power-events.jsonl"

log stream --style json --predicate 'process == "powerd" OR eventMessage CONTAINS[c] "sleep" OR eventMessage CONTAINS[c] "wake" OR eventMessage CONTAINS[c] "DarkWake"' \
  >> "$POWER_JSONL" 2>"$TELEM/power-events-status.txt" &
POWER_PID=$!

trap 'kill $POWER_PID 2>/dev/null || true' EXIT

while true; do
  ROW=$(node -e "
const os=require('os');
console.log(JSON.stringify({
  ts: new Date().toISOString(),
  monotonic_ms: Date.now(),
  uptime_sec: os.uptime(),
  loadavg: os.loadavg(),
  freemem: os.freemem(),
  totalmem: os.totalmem(),
}));
")
  echo "$ROW" >> "$HOST_JSONL"
  sleep "$INTERVAL"
done
