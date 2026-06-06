#!/bin/bash
# Run comprehensive auth test and extract granular percentiles

set -e

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
JSON_OUTPUT="test-results/k6-auth-comprehensive-${TIMESTAMP}.json"
LOG_OUTPUT="test-results/k6-auth-comprehensive-${TIMESTAMP}.log"

echo "=== Running Comprehensive Auth Test ==="
echo "JSON output: $JSON_OUTPUT"
echo "Log output: $LOG_OUTPUT"
echo ""

# Run k6 test with JSON output
k6 run \
  --env DEBUG=false \
  --out json="$JSON_OUTPUT" \
  scripts/load/k6-auth-comprehensive.js \
  2>&1 | tee "$LOG_OUTPUT"

echo ""
echo "=== Test Complete ==="
echo ""

# Extract percentiles
if [ -f "$JSON_OUTPUT" ]; then
  echo "=== Extracting Granular Percentiles ==="
  node scripts/load/calculate-granular-percentiles.js "$JSON_OUTPUT"
else
  echo "⚠️  JSON output file not found: $JSON_OUTPUT"
  echo "   Percentile extraction skipped"
fi

echo ""
echo "=== Results ==="
echo "  Log: $LOG_OUTPUT"
echo "  JSON: $JSON_OUTPUT"
if [ -f "$JSON_OUTPUT-percentiles.json" ]; then
  echo "  Percentiles JSON: $JSON_OUTPUT-percentiles.json"
fi
if [ -f "$JSON_OUTPUT-percentiles.md" ]; then
  echo "  Percentiles Report: $JSON_OUTPUT-percentiles.md"
fi

