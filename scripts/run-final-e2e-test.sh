#!/usr/bin/env bash
set -euo pipefail

# Final E2E Test Script
# Runs comprehensive k6 tests for all services including webapp
# Supports both HTTP/2 and HTTP/3 testing

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
BASE_URL="${BASE_URL:-https://record.local:30443}"
HOST="${HOST:-record.local}"
VUS="${VUS:-50}"
DURATION="${DURATION:-5m}"
HTTP_VERSION="${HTTP_VERSION:-HTTP/2}" # HTTP/2 or HTTP/3
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-final-e2e-${HTTP_VERSION//\//-}"
mkdir -p "$RESULTS_DIR"

say "=== Final E2E Test Suite ==="
echo "Protocol: $HTTP_VERSION"
echo "Base URL: $BASE_URL"
echo "VUs: $VUS"
echo "Duration: $DURATION"
echo "Results: $RESULTS_DIR"

# Check if port-forward is needed (for local testing)
if [[ "$BASE_URL" == *"localhost"* ]] || [[ "$BASE_URL" == *"127.0.0.1"* ]]; then
  say "Checking port-forward for webapp..."
  if ! curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
    warn "Port-forward not running. Starting it..."
    export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"
    kubectl port-forward -n default svc/webapp 3001:3001 > /tmp/webapp-portforward.log 2>&1 &
    sleep 3
    if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
      ok "Port-forward started"
    else
      warn "Port-forward may not be working. Continuing anyway..."
    fi
  else
    ok "Port-forward is running"
  fi
fi

# Check if services are ready
say "Checking service health..."
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

# Check Caddy
if curl -k -s "${BASE_URL}/_caddy/healthz" >/dev/null 2>&1; then
  ok "Caddy is healthy"
else
  fail "Caddy is not responding. Check: curl -k ${BASE_URL}/_caddy/healthz"
fi

# Check webapp
if curl -k -s "${BASE_URL}/api/health" >/dev/null 2>&1; then
  ok "Webapp is reachable via Caddy"
else
  warn "Webapp may not be ready. Continuing anyway..."
fi

# Determine which k6 binary to use
K6_BIN="k6"
if [[ "$HTTP_VERSION" == "HTTP/3" ]]; then
  K6_HTTP3_BIN="$PROJECT_ROOT/.k6-build/bin/k6-http3"
  if [[ -f "$K6_HTTP3_BIN" ]]; then
    K6_BIN="$K6_HTTP3_BIN"
    ok "Using custom k6-http3 binary for HTTP/3 testing"
  else
    warn "Custom k6-http3 binary not found at $K6_HTTP3_BIN"
    warn "Building it now..."
    if "$SCRIPT_DIR/build-k6-http3.sh"; then
      K6_BIN="$K6_HTTP3_BIN"
      ok "Built and using custom k6-http3 binary"
    else
      warn "Failed to build k6-http3. Will use standard k6 (may fall back to HTTP/2)"
    fi
  fi
fi

# Run the comprehensive test
say "Running comprehensive E2E test ($HTTP_VERSION)..."

"$K6_BIN" run \
  --vus "$VUS" \
  --duration "$DURATION" \
  --env BASE_URL="$BASE_URL" \
  --env HOST="$HOST" \
  --env HTTP_VERSION="$HTTP_VERSION" \
  --out json="$RESULTS_DIR/k6-results.json" \
  --summary-export="$RESULTS_DIR/k6-summary.json" \
  "$SCRIPT_DIR/load/k6-all-services-comprehensive.js" \
  > "$RESULTS_DIR/k6-output.log" 2>&1

TEST_EXIT=$?

# Extract summary
if [[ -f "$RESULTS_DIR/k6-summary.json" ]]; then
  say "Test Summary:"
  cat "$RESULTS_DIR/k6-summary.json" | jq -r '
    "Total Requests: \(.metrics.http_reqs.values.count // 0)",
    "Success Rate: \((1 - (.metrics.http_req_failed.values.rate // 0)) * 100 | floor)%",
    "Error Rate: \((.metrics.http_req_failed.values.rate // 0) * 100 | floor)%",
    "",
    "Service Success Rates:",
    (.metrics | to_entries | map(select(.key | endswith("_success_rate"))) | .[] | 
      "  \(.key | split("_")[0]): \((.value.values.rate // 0) * 100 | floor)%"),
    "",
    "Latency (p95):",
    (.metrics | to_entries | map(select(.key | endswith("_latency_ms"))) | .[] | 
      "  \(.key | split("_")[0]): \(.value.values["p(95)"] // "N/A")ms")
  ' || cat "$RESULTS_DIR/k6-output.log" | tail -50
fi

if [[ $TEST_EXIT -eq 0 ]]; then
  ok "E2E test completed successfully"
  say "Results saved to: $RESULTS_DIR"
  echo ""
  echo "Files:"
  echo "  - k6-results.json: Full k6 results"
  echo "  - k6-summary.json: Summary metrics"
  echo "  - k6-output.log: Test output"
  echo "  - k6-service-metrics.json: Service-specific metrics (if generated)"
  echo "  - k6-report.html: HTML report (if generated)"
else
  warn "E2E test completed with errors (exit code: $TEST_EXIT)"
  say "Check logs: $RESULTS_DIR/k6-output.log"
  exit $TEST_EXIT
fi

