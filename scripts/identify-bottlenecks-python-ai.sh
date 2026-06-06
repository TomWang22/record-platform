#!/usr/bin/env bash
set -euo pipefail

# Script to automatically identify bottlenecks in Python AI pipeline
# Analyzes k6 test results and system metrics to identify issues
# Usage: ./scripts/identify-bottlenecks-python-ai.sh [k6-output-file]

NS="${NS:-record-platform}"
K6_OUTPUT="${1:-/tmp/k6-python-ai-output.log}"

echo "🔍 Identifying Bottlenecks in Python AI Pipeline"
echo "================================================"
echo ""

if [ ! -f "$K6_OUTPUT" ]; then
  echo "❌ k6 output file not found: $K6_OUTPUT"
  echo "   Run a k6 test first or provide output file path"
  exit 1
fi

# Extract metrics from k6 output (handle both formatted summary and raw metrics)
echo "📊 Extracting Metrics..."

# Try formatted summary first (from handleSummary output)
ERROR_RATE_PCT=$(grep -E 'HTTP Error Rate:|Error Rate:' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)%.*/\1/' | head -1 || echo "0")
if [ "$ERROR_RATE_PCT" = "0" ]; then
  # Fallback to raw metrics
  ERROR_RATE=$(grep -E 'http_req_failed.*rate=' "$K6_OUTPUT" | sed -E 's/.*rate=([0-9.]+).*/\1/' | head -1 || echo "0")
  ERROR_RATE_PCT=$(echo "$ERROR_RATE * 100" | bc -l 2>/dev/null || echo "0")
fi

# Extract P95, P99, AVG from formatted output
P95=$(grep -E 'p95|P95.*Latency' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")
P99=$(grep -E 'p99|P99.*Latency' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")
AVG=$(grep -E 'Avg.*Latency|Average' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")

# Extract component latencies from formatted output
ANALYTICS_P95=$(grep -E 'Analytics.*AI.*P95' "$K6_OUTPUT" | sed -E 's/.*P95: ([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")
AI_P95=$(grep -E 'AI Advice.*P95' "$K6_OUTPUT" | sed -E 's/.*P95: ([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")
GATEWAY_P95=$(grep -E 'API Gateway.*P95|Gateway.*P95' "$K6_OUTPUT" | sed -E 's/.*P95: ([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")
PIPELINE_P95=$(grep -E 'Pipeline.*P95|TOTAL PIPELINE.*P95' "$K6_OUTPUT" | sed -E 's/.*P95: ([0-9]+\.[0-9]+)ms.*/\1/' | head -1 || echo "0")

# Extract success rates from formatted output
PIPELINE_SUCCESS_PCT=$(grep -E 'Pipeline Success Rate|Pipeline Success:' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)%.*/\1/' | head -1 || echo "0")
ANALYTICS_SUCCESS_PCT=$(grep -E 'Analytics Success Rate|Analytics Success:' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)%.*/\1/' | head -1 || echo "0")
AI_SUCCESS_PCT=$(grep -E 'AI Success Rate|AI Success:' "$K6_OUTPUT" | sed -E 's/.*([0-9]+\.[0-9]+)%.*/\1/' | head -1 || echo "0")

# Convert percentages to rates (0-1) for comparison
PIPELINE_SUCCESS=$(echo "scale=4; $PIPELINE_SUCCESS_PCT / 100" | bc -l 2>/dev/null || echo "0")
ANALYTICS_SUCCESS=$(echo "scale=4; $ANALYTICS_SUCCESS_PCT / 100" | bc -l 2>/dev/null || echo "0")
AI_SUCCESS=$(echo "scale=4; $AI_SUCCESS_PCT / 100" | bc -l 2>/dev/null || echo "0")

TOTAL_REQS=$(grep -E 'Total Requests:' "$K6_OUTPUT" | sed -E 's/.*([0-9,]+).*/\1/' | tr -d ',' | head -1 || echo "0")

echo "✅ Metrics extracted"
echo ""

# Analyze bottlenecks
echo "🔎 Bottleneck Analysis"
echo "----------------------"
echo ""

BOTTLENECKS=()

# 1. Error Rate Analysis
if (( $(echo "$ERROR_RATE_PCT > 5" | bc -l 2>/dev/null || echo 0) )); then
  BOTTLENECKS+=("HIGH_ERROR_RATE: ${ERROR_RATE_PCT}% error rate (threshold: 5%)")
  echo "⚠️  HIGH ERROR RATE: ${ERROR_RATE_PCT}%"
  echo "   Possible causes:"
  echo "   - Connection pool exhaustion"
  echo "   - Service overload"
  echo "   - Network timeouts"
  echo "   - Database connection issues"
  echo ""
fi

# 2. Component Latency Analysis
echo "📈 Component Latency Breakdown:"
echo "  Analytics → AI: ${ANALYTICS_P95}ms (P95)"
echo "  AI Advice: ${AI_P95}ms (P95)"
echo "  API Gateway: ${GATEWAY_P95}ms (P95)"
echo "  Total Pipeline: ${PIPELINE_P95}ms (P95)"
echo ""

# Identify slowest component
SLOWEST=""
SLOWEST_VALUE=0

if (( $(echo "$ANALYTICS_P95 > $SLOWEST_VALUE" | bc -l 2>/dev/null || echo 0) )); then
  SLOWEST="Analytics → AI"
  SLOWEST_VALUE=$ANALYTICS_P95
fi

if (( $(echo "$AI_P95 > $SLOWEST_VALUE" | bc -l 2>/dev/null || echo 0) )); then
  SLOWEST="AI Advice"
  SLOWEST_VALUE=$AI_P95
fi

if (( $(echo "$GATEWAY_P95 > $SLOWEST_VALUE" | bc -l 2>/dev/null || echo 0) )); then
  SLOWEST="API Gateway"
  SLOWEST_VALUE=$GATEWAY_P95
fi

if [ -n "$SLOWEST" ]; then
  echo "🐌 Slowest Component: $SLOWEST (P95: ${SLOWEST_VALUE}ms)"
  BOTTLENECKS+=("SLOW_COMPONENT: $SLOWEST (${SLOWEST_VALUE}ms P95)")
  
  if [ "$SLOWEST" = "Analytics → AI" ]; then
    echo "   Recommendations:"
    echo "   - Check analytics service DB pool (current: 50)"
    echo "   - Verify Redis caching is working"
    echo "   - Check analytics query performance (run EXPLAIN ANALYZE)"
    echo "   - Consider increasing analytics service replicas"
  elif [ "$SLOWEST" = "AI Advice" ]; then
    echo "   Recommendations:"
    echo "   - Check Python AI service DB pool (current: 50)"
    echo "   - Verify Redis singleflight is working"
    echo "   - Check external API calls (Discogs, eBay) latency"
    echo "   - Consider increasing Python AI service replicas"
  elif [ "$SLOWEST" = "API Gateway" ]; then
    echo "   Recommendations:"
    echo "   - Check API Gateway proxy timeouts"
    echo "   - Verify upstream service health"
    echo "   - Check network connectivity"
  fi
  echo ""
fi

# 3. Success Rate Analysis
if (( $(echo "$ANALYTICS_SUCCESS < 0.85" | bc -l 2>/dev/null || echo 0) )); then
  ANALYTICS_SUCCESS_PCT=$(echo "$ANALYTICS_SUCCESS * 100" | bc -l 2>/dev/null || echo "0")
  BOTTLENECKS+=("LOW_ANALYTICS_SUCCESS: ${ANALYTICS_SUCCESS_PCT}% (threshold: 85%)")
  echo "⚠️  LOW ANALYTICS SUCCESS RATE: ${ANALYTICS_SUCCESS_PCT}%"
  echo "   Possible causes:"
  echo "   - Analytics service overload"
  echo "   - Database connection issues"
  echo "   - Slow queries"
  echo ""
fi

if (( $(echo "$AI_SUCCESS < 0.90" | bc -l 2>/dev/null || echo 0) )); then
  AI_SUCCESS_PCT=$(echo "$AI_SUCCESS * 100" | bc -l 2>/dev/null || echo "0")
  BOTTLENECKS+=("LOW_AI_SUCCESS: ${AI_SUCCESS_PCT}% (threshold: 90%)")
  echo "⚠️  LOW AI SUCCESS RATE: ${AI_SUCCESS_PCT}%"
  echo "   Possible causes:"
  echo "   - Python AI service overload"
  echo "   - External API timeouts"
  echo "   - Database connection issues"
  echo ""
fi

# 4. P95 Latency Analysis
if (( $(echo "$P95 > 5000" | bc -l 2>/dev/null || echo 0) )); then
  BOTTLENECKS+=("HIGH_P95_LATENCY: ${P95}ms (threshold: 5000ms)")
  echo "⚠️  HIGH P95 LATENCY: ${P95}ms"
  echo "   Recommendations:"
  echo "   - Optimize slowest component (see above)"
  echo "   - Add more caching"
  echo "   - Scale up services"
  echo ""
fi

# 5. Check for connection errors in logs
CONNECTION_ERRORS=$(grep -iE "(connection refused|connection reset|timeout|EOF)" "$K6_OUTPUT" | wc -l || echo "0")
if [ "$CONNECTION_ERRORS" -gt 0 ]; then
  BOTTLENECKS+=("CONNECTION_ERRORS: $CONNECTION_ERRORS occurrences")
  echo "⚠️  CONNECTION ERRORS: $CONNECTION_ERRORS occurrences"
  echo "   Possible causes:"
  echo "   - Service overload (connection pool exhaustion)"
  echo "   - Network issues"
  echo "   - Service restarts"
  echo ""
fi

# Summary
echo "📋 Bottleneck Summary"
echo "===================="
if [ ${#BOTTLENECKS[@]} -eq 0 ]; then
  echo "✅ No major bottlenecks identified"
  echo "   All metrics within acceptable thresholds"
else
  echo "⚠️  Identified ${#BOTTLENECKS[@]} bottleneck(s):"
  for i in "${!BOTTLENECKS[@]}"; do
    echo "   $((i+1)). ${BOTTLENECKS[$i]}"
  done
fi
echo ""

# Recommendations
echo "💡 General Recommendations"
echo "=========================="
echo "1. Run query analysis: ./scripts/analyze-analytics-queries.sh"
echo "2. Check DB connection pools: ./scripts/investigate-pipeline-bottlenecks.sh"
echo "3. Monitor cache hit rates in service logs"
echo "4. Consider scaling services if bottlenecks persist"
echo ""

