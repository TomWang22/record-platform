#!/usr/bin/env bash
set -euo pipefail

# Run k6 load tests for listings service with comprehensive latency reporting
# Generates latency reports with all percentiles: p1 to p99, p999, p9999, p99999, p999999, p9999999, p99999999, p100

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# Configuration
BASE_URL="${BASE_URL:-}"
IN_CLUSTER="${IN_CLUSTER:-false}"
VUS="${VUS:-50}"
DURATION="${DURATION:-5m}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/results}"
TIMESTAMP=$(date +%s)
OUTPUT_FILE="$OUTPUT_DIR/listings-comprehensive-${TIMESTAMP}.json"
REPORT_FILE="$OUTPUT_DIR/listings-latency-report-${TIMESTAMP}.html"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

# Create output directory
mkdir -p "$OUTPUT_DIR"

say "=== Running Listings Service Load Test ==="

# Determine BASE_URL if not set
if [[ -z "$BASE_URL" ]]; then
  if [[ "$IN_CLUSTER" == "true" ]]; then
    BASE_URL="http://api-gateway.record-platform.svc.cluster.local:4000"
    ok "Using in-cluster URL: $BASE_URL"
  else
    # Try to detect if we're in a cluster
    if kubectl get svc api-gateway -n record-platform >/dev/null 2>&1; then
      # We can use port-forward or NodePort
      BASE_URL="https://record.local:30443"
      ok "Using NodePort URL: $BASE_URL"
    else
      BASE_URL="http://localhost:8080"
      warn "Using default localhost URL: $BASE_URL"
    fi
  fi
fi

# Run k6 test
say "Running k6 test (VUs: $VUS, Duration: $DURATION)..."
k6 run \
  --vus "$VUS" \
  --duration "$DURATION" \
  --summary-export="$OUTPUT_FILE" \
  --out json="$OUTPUT_FILE" \
  -e BASE_URL="$BASE_URL" \
  -e IN_CLUSTER="$IN_CLUSTER" \
  "$SCRIPT_DIR/k6-listings-service-comprehensive.js" 2>&1 | tee "$OUTPUT_DIR/listings-test-output-${TIMESTAMP}.txt"

if [[ ! -f "$OUTPUT_FILE" ]]; then
  fail "k6 test failed or output file not created"
  exit 1
fi

ok "k6 test completed. Output: $OUTPUT_FILE"

# Generate latency report
say "Generating latency report..."
if [[ -f "$SCRIPT_DIR/generate-latency-graph.py" ]]; then
  python3 "$SCRIPT_DIR/generate-latency-graph.py" "$OUTPUT_FILE" "$REPORT_FILE" 2>&1
  if [[ -f "$REPORT_FILE" ]]; then
    ok "Latency report generated: $REPORT_FILE"
    echo "   Open in browser: file://$(realpath "$REPORT_FILE")"
  else
    warn "Latency report generation failed"
  fi
else
  warn "generate-latency-graph.py not found, skipping report generation"
fi

# Extract and display key metrics
say "=== Test Summary ==="
if command -v jq >/dev/null 2>&1; then
  echo "Total Requests: $(jq -r '.metrics.http_reqs.values.count // 0' "$OUTPUT_FILE")"
  echo "Test Duration: $(jq -r '(.state.testRunDurationMs // 0) / 1000' "$OUTPUT_FILE")s"
  echo "HTTP Error Rate: $(jq -r '(.metrics.http_req_failed.values.rate // 0) * 100' "$OUTPUT_FILE")%"
  
  # Extract percentiles
  echo ""
  echo "HTTP Latency Percentiles:"
  echo "  p1: $(jq -r '(.metrics.http_req_duration.values["p(1)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p50: $(jq -r '(.metrics.http_req_duration.values["p(50)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p95: $(jq -r '(.metrics.http_req_duration.values["p(95)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p99: $(jq -r '(.metrics.http_req_duration.values["p(99)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p999: $(jq -r '(.metrics.http_req_duration.values["p(99.9)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p9999: $(jq -r '(.metrics.http_req_duration.values["p(99.99)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p99999: $(jq -r '(.metrics.http_req_duration.values["p(99.999)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p999999: $(jq -r '(.metrics.http_req_duration.values["p(99.9999)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p9999999: $(jq -r '(.metrics.http_req_duration.values["p(99.99999)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p99999999: $(jq -r '(.metrics.http_req_duration.values["p(99.999999)"] // 0) | . * 1000' "$OUTPUT_FILE")ms"
  echo "  p100 (max): $(jq -r '(.metrics.http_req_duration.values.max // 0) | . * 1000' "$OUTPUT_FILE")ms"
else
  warn "jq not found, skipping detailed metrics extraction"
fi

say "=== Test Complete ==="
ok "Results saved to: $OUTPUT_FILE"
if [[ -f "$REPORT_FILE" ]]; then
  ok "Report saved to: $REPORT_FILE"
fi

