#!/usr/bin/env bash
set -euo pipefail

# Script to compare HTTP/2 vs HTTP/3 performance
# Runs both tests and generates comparison report

NS="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
TEST_DURATION="${TEST_DURATION:-3m}"
VUS="${VUS:-20}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="test-results/${TIMESTAMP}-http2-vs-http3-comparison"
mkdir -p "$RESULTS_DIR"
LOG_FILE="$RESULTS_DIR/comparison.log"

say "=== HTTP/2 vs HTTP/3 Performance Comparison ==="

# Test 1: HTTP/2
say "Test 1: Running HTTP/2 test (${TEST_DURATION}, ${VUS} VUs)..."
BASE_URL="https://${HOST}:${PORT}" HOST="$HOST" HTTP_VERSION=HTTP/2 \
  k6 run --vus "$VUS" --duration "$TEST_DURATION" \
  --out json="$RESULTS_DIR/http2-results.json" \
  scripts/load/k6-all-services-comprehensive.js \
  > "$RESULTS_DIR/http2-output.log" 2>&1 || warn "HTTP/2 test completed with warnings"

# Test 2: HTTP/3
say "Test 2: Running HTTP/3 test (${TEST_DURATION}, ${VUS} VUs)..."
BASE_URL="https://${HOST}:${PORT}" HOST="$HOST" HTTP_VERSION=HTTP/3 \
  k6 run --vus "$VUS" --duration "$TEST_DURATION" \
  --out json="$RESULTS_DIR/http3-results.json" \
  scripts/load/k6-all-services-comprehensive.js \
  > "$RESULTS_DIR/http3-output.log" 2>&1 || warn "HTTP/3 test completed with warnings"

# Extract metrics
say "Extracting metrics..."

extract_metrics() {
  local log_file="$1"
  local output_file="$2"
  
  {
    echo "=== Service Success Rates ==="
    grep -E "(success_rate|_errors)" "$log_file" | grep -E "(auth|records|listings|social|shopping|analytics|python_ai)" | head -20
    
    echo ""
    echo "=== Latency Metrics ==="
    grep -E "(latency_ms|p\(95\)|p\(99\)|avg|med)" "$log_file" | grep -E "(auth|records|listings|social|shopping|analytics|python_ai)" | head -20
    
    echo ""
    echo "=== Overall Metrics ==="
    grep -E "(http_req_duration|http_req_failed|iterations|http_reqs)" "$log_file" | head -10
  } > "$output_file" 2>/dev/null || true
}

extract_metrics "$RESULTS_DIR/http2-output.log" "$RESULTS_DIR/http2-metrics.txt"
extract_metrics "$RESULTS_DIR/http3-output.log" "$RESULTS_DIR/http3-metrics.txt"

# Generate comparison report
say "Generating comparison report..."
cat > "$RESULTS_DIR/COMPARISON_REPORT.md" <<EOF
# HTTP/2 vs HTTP/3 Performance Comparison

**Test Date**: $(date)
**Test Duration**: ${TEST_DURATION}
**Virtual Users**: ${VUS}
**Host**: ${HOST}:${PORT}

## Test Configuration

- **HTTP/2**: Explicitly set \`HTTP_VERSION=HTTP/2\`
- **HTTP/3**: Explicitly set \`HTTP_VERSION=HTTP/3\`
- **Test Script**: \`scripts/load/k6-all-services-comprehensive.js\`
- **Protocol Verification**: Use \`scripts/verify-http3-with-tcpdump.sh\` to verify QUIC usage

## Results

### HTTP/2 Results
\`\`\`
$(cat "$RESULTS_DIR/http2-metrics.txt")
\`\`\`

### HTTP/3 Results
\`\`\`
$(cat "$RESULTS_DIR/http3-metrics.txt")
\`\`\`

## Analysis

### Success Rates
- Compare service success rates between HTTP/2 and HTTP/3
- Look for improvements in error rates

### Latency
- Compare p95, p99 latencies
- HTTP/3 should show lower latency, especially on lossy networks
- 0-RTT connection establishment in HTTP/3

### Throughput
- Compare request rates and throughput
- HTTP/3 multiplexing without head-of-line blocking

## Protocol Verification

To verify HTTP/3 is actually using QUIC (UDP), run:
\`\`\`bash
./scripts/verify-http3-with-tcpdump.sh
\`\`\`

This will:
1. Capture network traffic during k6 HTTP/3 test
2. Analyze pcap file for UDP packets on port 443 (QUIC)
3. Generate verification report

## Files

- \`http2-results.json\`: k6 JSON results (HTTP/2)
- \`http3-results.json\`: k6 JSON results (HTTP/3)
- \`http2-output.log\`: k6 console output (HTTP/2)
- \`http3-output.log\`: k6 console output (HTTP/3)
- \`http2-metrics.txt\`: Extracted metrics (HTTP/2)
- \`http3-metrics.txt\`: Extracted metrics (HTTP/3)
- \`COMPARISON_REPORT.md\`: This report

## Next Steps

1. Analyze JSON results for detailed percentile breakdowns
2. Use Wireshark to inspect pcap files for protocol verification
3. Compare tail latencies (p99, p999) for extreme cases
4. Test on lossy network conditions to see HTTP/3 benefits
EOF

ok "Comparison report generated: $RESULTS_DIR/COMPARISON_REPORT.md"
say ""
say "=== Test Complete ==="
say "Results saved to: $RESULTS_DIR"
say ""
say "To view comparison:"
say "  cat $RESULTS_DIR/COMPARISON_REPORT.md"
say ""
say "To verify HTTP/3 with tcpdump:"
say "  ./scripts/verify-http3-with-tcpdump.sh"

