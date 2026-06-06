#!/bin/bash
# Run e2e k6 test with optional tcpdump packet capture
# Usage: ./run-e2e-with-tcpdump.sh [--tcpdump]

set -e

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
JSON_OUTPUT="test-results/k6-e2e-${TIMESTAMP}.json"
LOG_OUTPUT="test-results/k6-e2e-${TIMESTAMP}.log"
TCPDUMP_OUTPUT="test-results/k6-e2e-${TIMESTAMP}.pcap"

ENABLE_TCPDUMP=false
if [[ "$1" == "--tcpdump" ]]; then
  ENABLE_TCPDUMP=true
fi

echo "=== Running E2E k6 Test Suite ==="
echo "JSON output: $JSON_OUTPUT"
echo "Log output: $LOG_OUTPUT"
if [ "$ENABLE_TCPDUMP" = true ]; then
  echo "TCPDUMP output: $TCPDUMP_OUTPUT"
fi
echo ""

# Check if tcpdump is available
if [ "$ENABLE_TCPDUMP" = true ]; then
  if ! command -v tcpdump &> /dev/null; then
    echo "⚠️  tcpdump not found. Install with: brew install tcpdump"
    echo "   Continuing without packet capture..."
    ENABLE_TCPDUMP=false
  fi
fi

# Start tcpdump in background if enabled
TCPDUMP_PID=""
if [ "$ENABLE_TCPDUMP" = true ]; then
  echo "=== Starting tcpdump packet capture ==="
  sudo tcpdump -i any -w "$TCPDUMP_OUTPUT" \
    -s 0 \
    'tcp port 30443 or tcp port 443 or tcp port 4000' \
    > /dev/null 2>&1 &
  TCPDUMP_PID=$!
  echo "tcpdump PID: $TCPDUMP_PID"
  sleep 2
fi

# Run k6 test with JSON output
echo "=== Running k6 E2E Test ==="
k6 run \
  --env DEBUG=false \
  --out json="$JSON_OUTPUT" \
  scripts/load/k6-all-services-comprehensive.js \
  2>&1 | tee "$LOG_OUTPUT"

K6_EXIT_CODE=${PIPESTATUS[0]}

# Stop tcpdump if running
if [ -n "$TCPDUMP_PID" ]; then
  echo ""
  echo "=== Stopping tcpdump ==="
  sudo kill $TCPDUMP_PID 2>/dev/null || true
  wait $TCPDUMP_PID 2>/dev/null || true
  if [ -f "$TCPDUMP_OUTPUT" ]; then
    echo "Packet capture saved to: $TCPDUMP_OUTPUT"
    echo "Analyze with: tcpdump -r $TCPDUMP_OUTPUT -A -n"
  fi
fi

echo ""
echo "=== Test Complete ==="
echo "Exit code: $K6_EXIT_CODE"

# Extract percentiles if JSON exists
if [ -f "$JSON_OUTPUT" ]; then
  echo ""
  echo "=== Extracting Granular Percentiles ==="
  if [ -f "scripts/load/calculate-granular-percentiles.js" ]; then
    node scripts/load/calculate-granular-percentiles.js "$JSON_OUTPUT" || echo "⚠️  Percentile extraction failed"
  else
    echo "⚠️  Percentile calculation script not found"
  fi
else
  echo "⚠️  JSON output file not found: $JSON_OUTPUT"
fi

# Check for errors in log
if grep -q "ERROR\|Failed\|error" "$LOG_OUTPUT"; then
  echo ""
  echo "=== Errors Found in Log ==="
  grep -E "ERROR|Failed|error" "$LOG_OUTPUT" | tail -20
fi

exit $K6_EXIT_CODE

