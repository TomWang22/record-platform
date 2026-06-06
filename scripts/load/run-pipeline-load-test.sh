#!/usr/bin/env bash
# Run comprehensive pipeline load test with tail latency metrics

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
VUS="${VUS:-50}"
DURATION="${DURATION:-5m}"
MODE="${MODE:-mixed}"

echo "🚀 Starting Pipeline Load Test"
echo "================================"
echo "Base URL: $BASE_URL"
echo "Virtual Users: $VUS"
echo "Duration: $DURATION"
echo "Mode: $MODE"
echo ""

# Run k6 test
k6 run \
  --env BASE_URL="$BASE_URL" \
  --env ANALYTICS_URL="$BASE_URL/api/analytics" \
  --env AI_URL="$BASE_URL/api/ai" \
  --env VUS="$VUS" \
  --env DURATION="$DURATION" \
  --env MODE="$MODE" \
  --out json=results-$(date +%Y%m%d-%H%M%S).json \
  scripts/load/k6-pipeline-tail-latency.js

echo ""
echo "✅ Test complete! Check results-*.json for detailed metrics"
