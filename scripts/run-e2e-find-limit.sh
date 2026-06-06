#!/usr/bin/env bash
set -euo pipefail

# E2E Limit Finding Test Script
# Runs ramping load tests to find maximum capacity for both HTTP/2 and HTTP/3
# Excludes webapp (frontend) - tests backend services only

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
BASE_URL="${BASE_URL:-https://record.local:30443}"
HOST="${HOST:-record.local}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-e2e-find-limit"
mkdir -p "$RESULTS_DIR"

say "=== E2E Limit Finding Test Suite ==="
echo "Base URL: $BASE_URL"
echo "Results: $RESULTS_DIR"
echo ""
echo "This will run ramping tests for both HTTP/2 and HTTP/3"
echo "to find the maximum capacity of the system."

# Check service health
say "Checking service health..."
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

if curl -k -s "${BASE_URL}/_caddy/healthz" >/dev/null 2>&1; then
  ok "Caddy is healthy"
else
  fail "Caddy is not responding. Check: curl -k ${BASE_URL}/_caddy/healthz"
fi

# Determine which k6 binary to use
K6_STD_BIN="k6"
K6_HTTP3_BIN="$PROJECT_ROOT/.k6-build/bin/k6-http3"

# Check if HTTP/3 binary exists
if [[ ! -f "$K6_HTTP3_BIN" ]]; then
  warn "Custom k6-http3 binary not found. Building it..."
  if "$SCRIPT_DIR/build-k6-http3.sh"; then
    ok "Built custom k6-http3 binary"
  else
    warn "Failed to build k6-http3. HTTP/3 test will use standard k6 (may fall back to HTTP/2)"
  fi
fi

# Function to run limit finding test
run_limit_test() {
  local protocol=$1
  local k6_bin=$2
  local results_file="$RESULTS_DIR/${protocol}-limit-analysis.json"
  local output_file="$RESULTS_DIR/${protocol}-output.log"
  
  say "Running ${protocol} limit finding test..."
  
  "$k6_bin" run \
    --env BASE_URL="$BASE_URL" \
    --env HOST="$HOST" \
    --env HTTP_VERSION="$protocol" \
    --out json="$RESULTS_DIR/${protocol}-results.json" \
    --summary-export="$RESULTS_DIR/${protocol}-summary.json" \
    "$SCRIPT_DIR/load/k6-e2e-find-limit.js" \
    > "$output_file" 2>&1
  
  local exit_code=$?
  
  if [[ -f "$results_file" ]]; then
    ok "${protocol} test completed (exit code: $exit_code)"
  else
    warn "${protocol} test completed but no results file found"
  fi
  
  return $exit_code
}

# Run HTTP/2 test
say "=== HTTP/2 Limit Finding Test ==="
run_limit_test "HTTP/2" "$K6_STD_BIN"
HTTP2_EXIT=$?

# Wait a bit between tests
sleep 10

# Run HTTP/3 test
say "=== HTTP/3 Limit Finding Test ==="
if [[ -f "$K6_HTTP3_BIN" ]]; then
  run_limit_test "HTTP/3" "$K6_HTTP3_BIN"
  HTTP3_EXIT=$?
else
  warn "Skipping HTTP/3 test - binary not available"
  HTTP3_EXIT=0
fi

# Compare results
say "=== Limit Finding Results Comparison ==="

if [[ -f "$RESULTS_DIR/HTTP-2-limit-analysis.json" ]] && [[ -f "$RESULTS_DIR/HTTP-3-limit-analysis.json" ]]; then
  echo ""
  echo "HTTP/2 Results:"
  cat "$RESULTS_DIR/HTTP-2-limit-analysis.json" | jq -r '
    "  Protocol: \(.protocol)",
    "  Max VUs: \(.max_vus)",
    "  Total Requests: \(.total_requests)",
    "  Error Rate: \((.overall_error_rate * 100) | floor)%",
    "  Services:",
    (.services | to_entries | .[] | "    \(.key): \((.value.success_rate * 100) | floor)% success, p95: \(.value.latency.p95 // "N/A")ms")
  ' || cat "$RESULTS_DIR/HTTP-2-output.log" | tail -30
  
  echo ""
  echo "HTTP/3 Results:"
  cat "$RESULTS_DIR/HTTP-3-limit-analysis.json" | jq -r '
    "  Protocol: \(.protocol)",
    "  Max VUs: \(.max_vus)",
    "  Total Requests: \(.total_requests)",
    "  Error Rate: \((.overall_error_rate * 100) | floor)%",
    "  Services:",
    (.services | to_entries | .[] | "    \(.key): \((.value.success_rate * 100) | floor)% success, p95: \(.value.latency.p95 // "N/A")ms")
  ' || cat "$RESULTS_DIR/HTTP-3-output.log" | tail -30
else
  warn "Could not generate comparison - check individual output logs"
fi

# Summary
say "=== Test Summary ==="
if [[ $HTTP2_EXIT -eq 0 ]] && [[ $HTTP3_EXIT -eq 0 ]]; then
  ok "Both HTTP/2 and HTTP/3 limit finding tests completed"
  say "Results saved to: $RESULTS_DIR"
  echo ""
  echo "Files:"
  echo "  - HTTP-2-results.json: Full HTTP/2 k6 results"
  echo "  - HTTP-3-results.json: Full HTTP/3 k6 results"
  echo "  - HTTP-2-limit-analysis.json: HTTP/2 limit analysis"
  echo "  - HTTP-3-limit-analysis.json: HTTP/3 limit analysis"
  echo "  - HTTP-2-output.log: HTTP/2 test output"
  echo "  - HTTP-3-output.log: HTTP/3 test output"
else
  warn "Some tests failed (HTTP/2: $HTTP2_EXIT, HTTP/3: $HTTP3_EXIT)"
  say "Check logs in: $RESULTS_DIR"
  exit 1
fi

