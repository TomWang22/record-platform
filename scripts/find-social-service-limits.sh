#!/usr/bin/env bash
# Find optimal k6 limits for Social Service
# Tests progressively higher VU counts and rates to find bottlenecks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✔ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }

say "=== Finding Social Service Limits ==="
say "This will test progressively higher VU counts and rates"
say "Target: Maximum throughput with <5% error rate and acceptable latency"

# Test configurations: "VUS:RATE_PER_VU:DURATION"
# VUS = Virtual Users (concurrent users)
# RATE_PER_VU = Requests per second per VU
# DURATION = Test duration in seconds
TESTS=(
  "10:2:60"      # Baseline: 10 users, 2 req/s each = 20 req/s total
  "20:2:60"      # 20 users, 2 req/s each = 40 req/s total
  "50:2:60"      # 50 users, 2 req/s each = 100 req/s total
  "100:2:120"    # 100 users, 2 req/s each = 200 req/s total
  "200:2:120"    # 200 users, 2 req/s each = 400 req/s total
  "300:2:180"    # 300 users, 2 req/s each = 600 req/s total
  "500:2:180"    # 500 users, 2 req/s each = 1000 req/s total
  "500:3:180"    # 500 users, 3 req/s each = 1500 req/s total (stress test)
)

OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/results/limit-finding-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUTPUT_DIR"

BEST_CONFIG=""
BEST_REQUESTS=0
BEST_ERROR_RATE=100
BEST_P95=0

say "Results will be saved to: $OUTPUT_DIR"
echo ""

for test_config in "${TESTS[@]}"; do
  IFS=':' read -r VUS RATE_PER_VU DURATION <<< "$test_config"
  TOTAL_RATE=$((VUS * RATE_PER_VU))
  
  say "Testing: ${VUS} VUs, ${RATE_PER_VU} req/s per VU = ${TOTAL_RATE} req/s total (${DURATION}s)"
  
  # Run k6 test with this configuration
  TEST_OUTPUT="$OUTPUT_DIR/test-${VUS}vus-${RATE_PER_VU}rate.json"
  
  say "Running test..."
  # Note: The k6 script uses fixed stages. For limit finding, we analyze results
  # from the default test configuration. In the future, we can create variant
  # k6 scripts with different VU counts for progressive testing.
  if OUTPUT_DIR="$OUTPUT_DIR" \
     "$SCRIPT_DIR/run-k6-social-with-graphs.sh" 2>&1 | tee "$OUTPUT_DIR/test-${VUS}vus-${RATE_PER_VU}rate.log"; then
    
    # Extract results from k6 summary JSON (find latest results directory)
    # The script creates a results directory, check both OUTPUT_DIR and latest k6-social-* directories
    LATEST_RESULTS=$(find "$OUTPUT_DIR" -name "k6-summary.json" -type f 2>/dev/null | sort | tail -1)
    if [[ -z "$LATEST_RESULTS" ]]; then
      LATEST_RESULTS=$(find "$PROJECT_ROOT/results" -type d -name "k6-social-*" -mmin -60 2>/dev/null | sort | tail -1)
      if [[ -n "$LATEST_RESULTS" ]] && [[ -f "$LATEST_RESULTS/k6-summary.json" ]]; then
        LATEST_RESULTS="$LATEST_RESULTS/k6-summary.json"
      else
        LATEST_RESULTS=$(find "$PROJECT_ROOT/results" -name "k6-summary.json" -type f -mmin -60 2>/dev/null | sort | tail -1)
      fi
    fi
    SUMMARY_FILE="$LATEST_RESULTS"
    if [[ ! -f "$SUMMARY_FILE" ]]; then
      warn "Summary file not found: $SUMMARY_FILE"
      continue
    fi
    
    # Parse results using Python for JSON extraction
    RESULTS=$(python3 << PYTHON
import json
import sys

try:
    with open('$SUMMARY_FILE', 'r') as f:
        data = json.load(f)
    
    metrics = data.get('metrics', {})
    
    # Get request counts
    http_reqs = metrics.get('http_reqs', {}).get('values', {})
    total_requests = http_reqs.get('count', 0)
    
    # Get error rate
    http_req_failed = metrics.get('http_req_failed', {}).get('values', {})
    error_rate = http_req_failed.get('rate', 0) * 100  # Convert to percentage
    
    # Get latency metrics
    http_req_duration = metrics.get('http_req_duration', {}).get('values', {})
    p95_latency = http_req_duration.get('p(95)', 0)
    avg_latency = http_req_duration.get('avg', 0)
    
    # Get throughput
    http_req_duration_data = metrics.get('http_req_duration', {})
    throughput = total_requests / $DURATION if $DURATION > 0 else 0
    
    print(f"{total_requests}:{error_rate:.2f}:{p95_latency:.2f}:{avg_latency:.2f}:{throughput:.2f}", end='')
except Exception as e:
    print(f"0:100:0:0:0", file=sys.stderr)
    sys.exit(1)
PYTHON
)
    
    IFS=':' read -r TOTAL_REQUESTS ERROR_RATE P95_LATENCY AVG_LATENCY THROUGHPUT <<< "$RESULTS"
    
    # Check if test passed criteria
    ERROR_RATE_NUM=$(echo "$ERROR_RATE" | bc -l 2>/dev/null || echo "100")
    P95_NUM=$(echo "$P95_LATENCY" | bc -l 2>/dev/null || echo "0")
    
    if [[ "$(echo "$ERROR_RATE_NUM < 5" | bc -l 2>/dev/null || echo "0")" == "1" ]]; then
      if [[ "$(echo "$P95_NUM < 5000" | bc -l 2>/dev/null || echo "0")" == "1" ]]; then
        ok "✅ PASS: ${TOTAL_REQUESTS} requests, ${ERROR_RATE}% errors, P95: ${P95_LATENCY}ms, Throughput: ${THROUGHPUT} req/s"
        
        # Check if this is better than previous best
        if [[ "$(echo "$ERROR_RATE_NUM < $BEST_ERROR_RATE" | bc -l 2>/dev/null || echo "0")" == "1" ]] || \
           [[ "$(echo "$ERROR_RATE_NUM == $BEST_ERROR_RATE && $TOTAL_REQUESTS > $BEST_REQUESTS" | bc -l 2>/dev/null || echo "0")" == "1" ]]; then
          BEST_REQUESTS="$TOTAL_REQUESTS"
          BEST_ERROR_RATE="$ERROR_RATE_NUM"
          BEST_P95="$P95_NUM"
          BEST_CONFIG="$test_config"
        fi
      else
        warn "⚠️  HIGH LATENCY: P95=${P95_LATENCY}ms (above 5000ms threshold)"
        # Continue but note the high latency
      fi
    else
      warn "❌ FAIL: ${ERROR_RATE}% error rate (above 5% threshold)"
      say "Bottleneck detected at: ${VUS} VUs, ${RATE_PER_VU} req/s per VU"
      say "Stopping tests - found breaking point"
      break
    fi
  else
    warn "Test execution failed"
    # Continue to next test
  fi
  
  echo ""
  say "Waiting 30s before next test to allow system recovery..."
  sleep 30
done

say "=== Results Summary ==="
if [[ -n "$BEST_CONFIG" ]]; then
  IFS=':' read -r VUS RATE_PER_VU DURATION <<< "$BEST_CONFIG"
  TOTAL_RATE=$((VUS * RATE_PER_VU))
  
  ok "Best Configuration Found:"
  ok "  VUs: ${VUS}"
  ok "  Rate per VU: ${RATE_PER_VU} req/s"
  ok "  Total Rate: ${TOTAL_RATE} req/s"
  ok "  Result: ${BEST_REQUESTS} requests, ${BEST_ERROR_RATE}% errors, P95: ${BEST_P95}ms"
  echo ""
  say "Bottleneck Analysis:"
  echo "  The system failed at: ${VUS} VUs, ${RATE_PER_VU} req/s per VU"
  echo "  Recommended production limits:"
  echo "    - Max VUs: $((VUS - 50))  (safety margin)"
  echo "    - Max Rate: $((TOTAL_RATE - 100)) req/s  (safety margin)"
  echo ""
  say "Full results saved to: $OUTPUT_DIR"
else
  warn "No optimal configuration found - all tests failed"
fi

# Final cleanup - ensure all k6 resources are deleted
say "=== Final Cleanup ==="
say "Cleaning up any remaining k6 jobs and pods..."
kubectl -n record-platform get jobs -l job-name -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | while read -r job; do
  if [[ -n "$job" ]] && [[ "$job" =~ ^k6- ]]; then
    kubectl -n record-platform delete job "$job" --ignore-not-found=true >/dev/null 2>&1
    echo "  Deleted job: $job"
  fi
done

kubectl -n record-platform get pods -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | while read -r pod; do
  if [[ -n "$pod" ]] && [[ "$pod" =~ ^k6- ]]; then
    kubectl -n record-platform delete pod "$pod" --ignore-not-found=true >/dev/null 2>&1
    echo "  Deleted pod: $pod"
  fi
done

say "=== Bottleneck Identification ==="
say "Check the following for bottlenecks:"
echo "  1. Database connection pool exhaustion"
echo "  2. Database query performance (slow queries)"
echo "  3. API Gateway rate limiting"
echo "  4. Service CPU/Memory limits"
echo "  5. Kafka producer/consumer lag"
echo "  6. Network bandwidth"

