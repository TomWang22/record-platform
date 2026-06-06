#!/usr/bin/env bash
set -euo pipefail

# Script to find VU limit and performance metrics for Python AI pipeline
# Gradually increases VUs until error rate exceeds threshold or performance degrades
# Usage: ./scripts/find-vu-limit-python-ai.sh

NS="${NS:-record-platform}"
K6_POD_NAME="k6-python-ai-vu-test"
SCRIPT_PATH="scripts/load/k6-python-ai-pipeline.js"
OUTPUT_DIR="/tmp/k6-vu-limit-results"
mkdir -p "$OUTPUT_DIR"

# Configuration
START_VUS=10
MAX_VUS=200
STEP_VUS=10
ERROR_THRESHOLD=10.0  # Stop if error rate exceeds 10%
P95_THRESHOLD=30000   # Stop if P95 latency exceeds 30s
DURATION_PER_STEP="2m"  # Test duration for each VU level

echo "🔍 Finding VU Limit for Python AI Pipeline"
echo "==========================================="
echo ""
echo "Configuration:"
echo "  Start VUs: $START_VUS"
echo "  Max VUs: $MAX_VUS"
echo "  Step: $STEP_VUS"
echo "  Duration per step: $DURATION_PER_STEP"
echo "  Error threshold: ${ERROR_THRESHOLD}%"
echo "  P95 threshold: ${P95_THRESHOLD}ms"
echo ""

# Create modified k6 script with variable VUs
cat > /tmp/k6-vu-test.js << 'K6_SCRIPT'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const PYTHON_AI_URL = __ENV.PYTHON_AI_URL || 'http://python-ai-service.record-platform.svc.cluster.local:5005';
const API_GATEWAY_URL = __ENV.API_GATEWAY_URL || 'http://api-gateway.record-platform.svc.cluster.local:4000';
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || '10');

const errorRate = new Rate('errors');
const pipelineLatency = new Trend('pipeline_latency_ms');
const pipelineSuccess = new Rate('pipeline_success');

const testQueries = [
  'Beatles Abbey Road',
  'Pink Floyd Dark Side of the Moon',
  'Led Zeppelin IV',
  'Radiohead OK Computer',
];

function randomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

export const options = {
  stages: [
    { duration: '30s', target: TARGET_VUS },
    { duration: __ENV.DURATION || '2m', target: TARGET_VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_failed': ['rate<0.10'],  // 10% error threshold
    'http_req_duration': ['p(95)<30000'],  // 30s P95 threshold
    'pipeline_success': ['rate>0.80'],  // 80% success rate
  },
};

export default function() {
  const query = randomQuery();
  const pipelineStart = Date.now();
  
  // Part 1: Analytics → Python AI
  const analyticsRes = http.post(`${PYTHON_AI_URL}/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: 'NM',
    sleeve_grade: 'NM',
    user_id: '00000000-0000-0000-0000-000000000000',
    current_price: 50,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'analytics_to_ai', pipeline: 'part1' },
    timeout: '60s',
  });
  
  const analyticsCheck = check(analyticsRes, {
    'analytics status is 200': (r) => r.status === 200,
  });
  
  if (!analyticsCheck) {
    errorRate.add(1);
    return;
  }
  
  // Part 2: Python AI → API Gateway
  const gatewayRes = http.post(`${API_GATEWAY_URL}/api/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: 'NM',
    sleeve_grade: 'NM',
    user_id: '00000000-0000-0000-0000-000000000000',
    current_price: 50,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'gateway_ai_advice', pipeline: 'part2' },
    timeout: '60s',
  });
  
  const gatewayCheck = check(gatewayRes, {
    'gateway status is 200': (r) => r.status === 200,
    'gateway has recommended_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  const totalLatency = Date.now() - pipelineStart;
  pipelineLatency.add(totalLatency);
  
  if (gatewayCheck) {
    pipelineSuccess.add(1);
  } else {
    errorRate.add(1);
  }
  
  sleep(1);
}
K6_SCRIPT

# Test different VU levels
RESULTS_FILE="$OUTPUT_DIR/vu-limit-results.csv"
echo "VUs,Total Requests,Error Rate (%),P95 Latency (ms),P99 Latency (ms),Avg Latency (ms),Pipeline Success (%),Status" > "$RESULTS_FILE"

CURRENT_VUS=$START_VUS
LAST_SUCCESSFUL_VUS=0

while [ $CURRENT_VUS -le $MAX_VUS ]; do
  echo "🧪 Testing with $CURRENT_VUS VUs..."
  
  # Cleanup any existing pod
  kubectl -n "$NS" delete pod "$K6_POD_NAME" --ignore-not-found=true --wait=false 2>/dev/null || true
  sleep 2
  
  # Run k6 test
  OUTPUT_FILE="$OUTPUT_DIR/k6-output-${CURRENT_VUS}vus.log"
  (
    kubectl -n "$NS" run "$K6_POD_NAME" \
      --rm -i --restart=Never \
      --image=grafana/k6:latest \
      --env="TARGET_VUS=$CURRENT_VUS" \
      --env="DURATION=$DURATION_PER_STEP" \
      -- run - < /tmp/k6-vu-test.js 2>&1 | tee "$OUTPUT_FILE"
  ) || true
  
  # Ensure pod cleanup
  kubectl -n "$NS" delete pod "$K6_POD_NAME" --ignore-not-found=true --wait=false 2>/dev/null || true
  sleep 2
  
  # Extract metrics from output (using sed for macOS compatibility)
  ERROR_RATE=$(grep -E 'http_req_failed.*rate=' "$OUTPUT_FILE" | sed -E 's/.*rate=([0-9.]+).*/\1/' | head -1 || echo "0")
  ERROR_RATE_PCT=$(echo "$ERROR_RATE * 100" | bc -l 2>/dev/null || echo "0")
  
  P95=$(grep -E 'http_req_duration.*p\(95\)=' "$OUTPUT_FILE" | sed -E 's/.*p\(95\)=([0-9.]+).*/\1/' | head -1 || echo "0")
  P99=$(grep -E 'http_req_duration.*p\(99\)=' "$OUTPUT_FILE" | sed -E 's/.*p\(99\)=([0-9.]+).*/\1/' | head -1 || echo "0")
  AVG=$(grep -E 'http_req_duration.*avg=' "$OUTPUT_FILE" | sed -E 's/.*avg=([0-9.]+).*/\1/' | head -1 || echo "0")
  
  TOTAL_REQS=$(grep -E 'http_reqs.*count=' "$OUTPUT_FILE" | sed -E 's/.*count=([0-9]+).*/\1/' | head -1 || echo "0")
  
  PIPELINE_SUCCESS=$(grep -E 'pipeline_success.*rate=' "$OUTPUT_FILE" | sed -E 's/.*rate=([0-9.]+).*/\1/' | head -1 || echo "0")
  PIPELINE_SUCCESS_PCT=$(echo "$PIPELINE_SUCCESS * 100" | bc -l 2>/dev/null || echo "0")
  
  # Determine status
  if (( $(echo "$ERROR_RATE_PCT > $ERROR_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
    STATUS="ERROR_THRESHOLD_EXCEEDED"
  elif (( $(echo "$P95 > $P95_THRESHOLD" | bc -l 2>/dev/null || echo 0) )); then
    STATUS="LATENCY_THRESHOLD_EXCEEDED"
  else
    STATUS="PASS"
    LAST_SUCCESSFUL_VUS=$CURRENT_VUS
  fi
  
  echo "$CURRENT_VUS,$TOTAL_REQS,$ERROR_RATE_PCT,$P95,$P99,$AVG,$PIPELINE_SUCCESS_PCT,$STATUS" >> "$RESULTS_FILE"
  
  echo "  Results: Error Rate=${ERROR_RATE_PCT}%, P95=${P95}ms, Success=${PIPELINE_SUCCESS_PCT}% - $STATUS"
  echo ""
  
  # Stop if threshold exceeded
  if [ "$STATUS" != "PASS" ]; then
    echo "⚠️  Threshold exceeded at $CURRENT_VUS VUs. Stopping test."
    break
  fi
  
  CURRENT_VUS=$((CURRENT_VUS + STEP_VUS))
done

# Generate summary
echo "📊 VU Limit Test Summary"
echo "========================"
echo ""
echo "Last Successful VU Level: $LAST_SUCCESSFUL_VUS"
echo "Results saved to: $RESULTS_FILE"
echo ""
echo "Top 5 VU Levels by Performance:"
tail -n +2 "$RESULTS_FILE" | sort -t',' -k3 -n | head -5 | while IFS=',' read -r vus reqs err p95 p99 avg success status; do
  echo "  ${vus} VUs: Error=${err}%, P95=${p95}ms, Success=${success}%"
done
echo ""
echo "✅ VU limit test complete"

