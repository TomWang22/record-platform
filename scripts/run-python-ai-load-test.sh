#!/usr/bin/env bash
set -euo pipefail

# Run Python AI Pipeline Load Test with Visualization
# This script runs the k6 test, extracts results, and generates latency graphs

NS="record-platform"
TEST_SCRIPT="scripts/load/k6-python-ai-pipeline.js"
OUTPUT_DIR="/tmp/k6-python-ai-results"
SUMMARY_JSON="${OUTPUT_DIR}/summary.json"
HTML_REPORT="${OUTPUT_DIR}/latency-report.html"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Create output directory
mkdir -p "$OUTPUT_DIR"

say "=== Python AI Pipeline Load Test with Visualization ==="

# Step 1: Run k6 test and capture summary JSON
say "Step 1: Running k6 load test..."
say "This will take ~6 minutes (test duration)..."

# Create a temporary script that outputs JSON summary
TEMP_SCRIPT="${OUTPUT_DIR}/k6-test.js"
cat > "$TEMP_SCRIPT" << 'K6_SCRIPT_EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics for pipeline tracking
const errorRate = new Rate('errors');
const pipelineLatency = new Trend('pipeline_latency_ms');
const analyticsToAILatency = new Trend('analytics_to_ai_latency_ms');
const aiAdviceLatency = new Trend('ai_advice_latency_ms');
const gatewayLatency = new Trend('gateway_latency_ms');

// Per-endpoint latencies
const sellingAdviceLatency = new Trend('selling_advice_latency_ms');
const buyingAdviceLatency = new Trend('buying_advice_latency_ms');
const negotiationAdviceLatency = new Trend('negotiation_advice_latency_ms');
const biddingAdviceLatency = new Trend('bidding_advice_latency_ms');

// Pipeline success tracking
const pipelineSuccess = new Rate('pipeline_success');
const analyticsSuccess = new Rate('analytics_success');
const aiSuccess = new Rate('ai_success');

// Test queries
const testQueries = [
  'Beatles Abbey Road',
  'Pink Floyd Dark Side of the Moon',
  'Led Zeppelin IV',
  'Radiohead OK Computer',
  'The Doors L.A. Woman',
  'Jimi Hendrix Are You Experienced',
  'Bob Dylan Highway 61',
  'The Rolling Stones Sticky Fingers',
  'Queen A Night at the Opera',
  'David Bowie Ziggy Stardust',
];

function randomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

function randomGrade() {
  const grades = ['M', 'NM', 'EX', 'VG+', 'VG'];
  return grades[Math.floor(Math.random() * grades.length)];
}

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': [
      'p(1)<50', 'p(5)<100', 'p(10)<150', 'p(25)<200', 'p(50)<300',
      'p(75)<400', 'p(90)<500', 'p(95)<600', 'p(99)<1000',
      'p(99.9)<2000', 'p(99.99)<5000', 'p(99.999)<10000',
      'p(99.9999)<20000', 'p(99.99999)<50000', 'p(99.999999)<100000',
      'p(100)<200000',
    ],
    'http_req_failed': ['rate<0.05'],
    'errors': ['rate<0.05'],
    'pipeline_success': ['rate>0.90'],
    'analytics_success': ['rate>0.85'],
    'ai_success': ['rate>0.90'],
  },
};

const PYTHON_AI_URL = __ENV.PYTHON_AI_URL || 'http://python-ai-service.record-platform.svc.cluster.local:5005';
const API_GATEWAY_URL = __ENV.API_GATEWAY_URL || 'http://api-gateway.record-platform.svc.cluster.local:4000';
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://analytics-service.record-platform.svc.cluster.local:4004';

export default function () {
  const query = randomQuery();
  const userId = `user-${Math.floor(Math.random() * 1000)}`;
  const pipelineStart = Date.now();
  
  // PART 1: Analytics Service → Python AI Pipeline
  const analyticsStart = Date.now();
  const analyticsRes = http.get(`${ANALYTICS_URL}/analytics/recommendations/similar`, {
    params: { q: query, userId: userId, limit: 10 },
    tags: { name: 'analytics_recommendations', pipeline: 'part1' },
    timeout: '10s',
  });
  const analyticsLatency = Date.now() - analyticsStart;
  analyticsToAILatency.add(analyticsLatency);
  
  const analyticsCheck = check(analyticsRes, {
    'analytics status is 200': (r) => r.status === 200,
    'analytics has recommendations': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommendations !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (analyticsCheck) {
    analyticsSuccess.add(1);
  } else {
    analyticsSuccess.add(0);
    errorRate.add(1);
  }
  
  sleep(0.3);
  
  // Test all 4 AI advisor endpoints
  const sellingStart = Date.now();
  const sellingRes = http.post(`${PYTHON_AI_URL}/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: randomGrade(),
    sleeve_grade: randomGrade(),
    user_id: userId,
    current_price: Math.random() * 100 + 20,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'selling_advice', pipeline: 'part1', endpoint: 'selling-advice' },
    timeout: '10s',
  });
  const sellingLatency = Date.now() - sellingStart;
  sellingAdviceLatency.add(sellingLatency);
  aiAdviceLatency.add(sellingLatency);
  
  const sellingCheck = check(sellingRes, {
    'selling advice status is 200': (r) => r.status === 200,
    'selling advice has recommended_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!sellingCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  const buyingStart = Date.now();
  const buyingRes = http.post(`${PYTHON_AI_URL}/ai/buying-advice`, JSON.stringify({
    query: query,
    max_budget: Math.random() * 200 + 50,
    user_id: userId,
    urgency: ['normal', 'high', 'low'][Math.floor(Math.random() * 3)],
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'buying_advice', pipeline: 'part1', endpoint: 'buying-advice' },
    timeout: '10s',
  });
  const buyingLatency = Date.now() - buyingStart;
  buyingAdviceLatency.add(buyingLatency);
  aiAdviceLatency.add(buyingLatency);
  
  const buyingCheck = check(buyingRes, {
    'buying advice status is 200': (r) => r.status === 200,
    'buying advice has fair_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.fair_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!buyingCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  const role = Math.random() > 0.5 ? 'buyer' : 'seller';
  const negotiationStart = Date.now();
  const negotiationRes = http.post(`${PYTHON_AI_URL}/ai/negotiation-advice`, JSON.stringify({
    query: query,
    role: role,
    current_price: Math.random() * 100 + 30,
    target_price: Math.random() * 100 + 25,
    user_id: userId,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'negotiation_advice', pipeline: 'part1', endpoint: 'negotiation-advice' },
    timeout: '10s',
  });
  const negotiationLatency = Date.now() - negotiationStart;
  negotiationAdviceLatency.add(negotiationLatency);
  aiAdviceLatency.add(negotiationLatency);
  
  const negotiationCheck = check(negotiationRes, {
    'negotiation advice status is 200': (r) => r.status === 200,
    'negotiation advice has strategy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.strategy !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!negotiationCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  const biddingStart = Date.now();
  const biddingRes = http.post(`${PYTHON_AI_URL}/ai/bidding-advice`, JSON.stringify({
    query: query,
    current_bid: Math.random() * 80 + 20,
    auction_end_time: new Date(Date.now() + Math.random() * 86400000).toISOString(),
    user_id: userId,
    max_budget: Math.random() * 150 + 50,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'bidding_advice', pipeline: 'part1', endpoint: 'bidding-advice' },
    timeout: '10s',
  });
  const biddingLatency = Date.now() - biddingStart;
  biddingAdviceLatency.add(biddingLatency);
  aiAdviceLatency.add(biddingLatency);
  
  const biddingCheck = check(biddingRes, {
    'bidding advice status is 200': (r) => r.status === 200,
    'bidding advice has should_bid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.should_bid !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!biddingCheck) {
    errorRate.add(1);
  }
  
  // Track Part 1 pipeline success
  if (analyticsCheck && sellingCheck && buyingCheck && negotiationCheck && biddingCheck) {
    pipelineSuccess.add(1);
    aiSuccess.add(1);
  } else {
    pipelineSuccess.add(0);
    aiSuccess.add(0);
  }
  
  const part1Latency = Date.now() - pipelineStart;
  pipelineLatency.add(part1Latency);
  
  sleep(0.5);
  
  // PART 2: Python AI → API Gateway (End-to-End)
  const gatewayStart = Date.now();
  
  const gatewayRes = http.post(`${API_GATEWAY_URL}/api/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: randomGrade(),
    sleeve_grade: randomGrade(),
    user_id: userId,
    current_price: Math.random() * 100 + 20,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'gateway_ai_advice', pipeline: 'part2' },
    timeout: '10s',
  });
  const gatewayLatencyMs = Date.now() - gatewayStart;
  gatewayLatency.add(gatewayLatencyMs);
  
  const gatewayCheck = check(gatewayRes, {
    'gateway status is 200': (r) => r.status === 200,
    'gateway routes to Python AI': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!gatewayCheck) {
    errorRate.add(1);
  }
  
  const totalPipelineLatency = Date.now() - pipelineStart;
  pipelineLatency.add(totalPipelineLatency);
  
  sleep(1);
}

export function handleSummary(data) {
  // Return JSON summary for processing
  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
K6_SCRIPT_EOF

# Run k6 test and capture JSON output
say "Running k6 test (this may take ~6 minutes)..."
kubectl -n "$NS" run k6-python-ai-test --rm -i --restart=Never \
  --image=grafana/k6:latest \
  -- sh -c "cat > /tmp/test.js && k6 run /tmp/test.js" < "$TEMP_SCRIPT" \
  2>&1 | tee "${OUTPUT_DIR}/k6-output.txt" | \
  grep -A 10000 '^{' | head -10000 > "${OUTPUT_DIR}/k6-json-output.txt" || true

# Extract JSON from output
say "Step 2: Extracting test results..."
if [[ -f "${OUTPUT_DIR}/k6-json-output.txt" ]]; then
  # Try to extract valid JSON
  python3 << 'PYTHON_EOF'
import json
import sys
import re

try:
    with open('/tmp/k6-python-ai-results/k6-json-output.txt', 'r') as f:
        content = f.read()
    
    # Try to find JSON object
    # Look for first { and last }
    start = content.find('{')
    if start != -1:
        # Find matching closing brace
        brace_count = 0
        end = start
        for i in range(start, len(content)):
            if content[i] == '{':
                brace_count += 1
            elif content[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    end = i + 1
                    break
        
        json_str = content[start:end]
        try:
            data = json.loads(json_str)
            with open('/tmp/k6-python-ai-results/summary.json', 'w') as out:
                json.dump(data, out, indent=2)
            print("✅ Extracted JSON summary")
            sys.exit(0)
        except json.JSONDecodeError as e:
            print(f"⚠️  JSON parse error: {e}")
            sys.exit(1)
    else:
        print("⚠️  No JSON found in output")
        sys.exit(1)
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
PYTHON_EOF
else
  warn "Could not extract JSON from k6 output"
fi

# Step 3: Generate HTML report
if [[ -f "$SUMMARY_JSON" ]]; then
  say "Step 3: Generating latency graphs and HTML report..."
  python3 scripts/load/generate-latency-graph.py "$SUMMARY_JSON" "$HTML_REPORT" 2>&1 || {
    warn "Failed to generate HTML report, creating basic summary..."
    # Create a basic summary if Python script fails
    cat > "$HTML_REPORT" << 'HTML_EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Python AI Service - Load Test Results</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; }
    </style>
</head>
<body>
    <h1>Python AI Service Pipeline Load Test</h1>
    <div class="summary">
        <p>Test completed. Check the k6 output for detailed results.</p>
        <p>Output file: /tmp/k6-python-ai-results/k6-output.txt</p>
    </div>
</body>
</html>
HTML_EOF
  }
  
  if [[ -f "$HTML_REPORT" ]]; then
    ok "HTML report generated: $HTML_REPORT"
    say "Open the report in your browser:"
    echo "  open $HTML_REPORT"
    echo "  or: file://$HTML_REPORT"
  fi
else
  warn "Summary JSON not found, skipping graph generation"
fi

# Step 4: Display summary
say "Step 4: Test Summary"
if [[ -f "${OUTPUT_DIR}/k6-output.txt" ]]; then
  echo ""
  echo "📊 Key Metrics (from test output):"
  grep -E "(Total Requests|Test Duration|Error Rate|Pipeline Success|P95|P99)" "${OUTPUT_DIR}/k6-output.txt" | head -20 || true
  echo ""
  echo "📁 Results saved to: $OUTPUT_DIR"
  echo "  - k6-output.txt: Full test output"
  echo "  - summary.json: JSON summary (if extracted)"
  echo "  - latency-report.html: HTML visualization (if generated)"
fi

say "=== Load Test Complete ==="

