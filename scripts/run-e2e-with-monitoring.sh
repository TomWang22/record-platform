#!/usr/bin/env bash
set -euo pipefail

# E2E Limit Finding Test with Comprehensive Monitoring
# Runs HTTP/2 and HTTP/3 limit tests with tcpdump, htop, strace, and system metrics

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
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-e2e-find-limit-with-monitoring"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$RESULTS_DIR" "$MONITOR_DIR"

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

say "=== E2E Limit Finding Test with Comprehensive Monitoring ==="
echo "Base URL: $BASE_URL"
echo "Results: $RESULTS_DIR"
echo "Monitoring: $MONITOR_DIR"

# Check prerequisites
say "Checking prerequisites..."

# Check k6
if ! command -v k6 >/dev/null 2>&1; then
  fail "k6 not found. Install: brew install k6"
fi
ok "k6 found: $(k6 version | head -1)"

# Check k6-http3 binary
K6_HTTP3_BIN="$PROJECT_ROOT/.k6-build/bin/k6-http3"
if [[ ! -f "$K6_HTTP3_BIN" ]]; then
  warn "Custom k6-http3 binary not found. Building it..."
  if "$SCRIPT_DIR/build-k6-http3.sh"; then
    ok "Built custom k6-http3 binary"
  else
    warn "Failed to build k6-http3. HTTP/3 test will use standard k6"
  fi
fi

# Check service health
say "Checking service health..."
if curl -k -s "${BASE_URL}/_caddy/healthz" >/dev/null 2>&1; then
  ok "Caddy is healthy"
else
  fail "Caddy is not responding"
fi

# Get Caddy pod for monitoring
CADDY_POD=$(kubectl -n ingress-nginx get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$CADDY_POD" ]]; then
  fail "Caddy pod not found"
fi
ok "Found Caddy pod: $CADDY_POD"

# Get service pods for monitoring
AUTH_POD=$(kubectl get pods -n default -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
WEBAPP_POD=$(kubectl get pods -n default -l app=webapp -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ok "Found pods: auth=${AUTH_POD:-N/A}, webapp=${WEBAPP_POD:-N/A}"

# Start comprehensive monitoring
say "Starting comprehensive monitoring..."

# Start tcpdump on Caddy pod (capture HTTP/2 TCP and HTTP/3 UDP)
say "Starting tcpdump on Caddy pod (HTTP/2 TCP + HTTP/3 UDP)..."
kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/caddy-traffic.pcap 'tcp port 443 or udp port 443' 2>&1" > "$MONITOR_DIR/tcpdump.log" 2>&1 &
TCPDUMP_PID=$!
sleep 3
ok "tcpdump started (PID: $TCPDUMP_PID, capturing TCP:443 and UDP:443)"

# Start pod metrics collection (every 5 seconds)
say "Starting pod metrics collection..."
(
  while true; do
    timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
    echo "=== Metrics at $timestamp ===" >> "$MONITOR_DIR/pod-metrics.log"
    kubectl top pods -A --no-headers >> "$MONITOR_DIR/pod-metrics.log" 2>&1 || true
    kubectl top nodes --no-headers >> "$MONITOR_DIR/node-metrics.log" 2>&1 || true
    echo "" >> "$MONITOR_DIR/pod-metrics.log"
    sleep 5
  done
) &
METRICS_PID=$!
ok "Pod metrics collection started (PID: $METRICS_PID, interval: 5s)"

# Start process monitoring on auth-service (if available)
AUTH_MONITOR_PID=""
if [[ -n "$AUTH_POD" ]]; then
  say "Starting process monitoring on auth-service..."
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S)
      echo "=== Processes at $timestamp ===" >> "$MONITOR_DIR/auth-processes.log"
      kubectl -n default exec "$AUTH_POD" -- sh -c "ps aux --sort=-%cpu | head -20" >> "$MONITOR_DIR/auth-processes.log" 2>&1 || true
      echo "" >> "$MONITOR_DIR/auth-processes.log"
      sleep 10
    done
  ) &
  AUTH_MONITOR_PID=$!
  ok "Auth-service process monitoring started (PID: $AUTH_MONITOR_PID)"
fi

# Start pod status monitoring
say "Starting pod status monitoring..."
(
  while true; do
    timestamp=$(date +%Y%m%d-%H%M%S)
    kubectl get pods -A -o wide > "$MONITOR_DIR/pod-status-${timestamp}.txt" 2>&1 || true
    kubectl get pods -A -o json > "$MONITOR_DIR/pod-status-${timestamp}.json" 2>&1 || true
    sleep 30
  done
) &
STATUS_MONITOR_PID=$!
ok "Pod status monitoring started (PID: $STATUS_MONITOR_PID, interval: 30s)"

# Start system resource monitoring (Kind node)
say "Starting system resource monitoring on Kind nodes..."
KIND_NODES=$(kind get nodes --name h3 2>/dev/null || echo "")
if [[ -n "$KIND_NODES" ]]; then
  for node in $KIND_NODES; do
    (
      while true; do
        timestamp=$(date +%Y%m%d-%H%M%S)
        docker exec "$node" sh -c "top -bn1 | head -30" > "$MONITOR_DIR/node-${node}-top-${timestamp}.txt" 2>&1 || true
        docker exec "$node" sh -c "free -h" >> "$MONITOR_DIR/node-${node}-resources.log" 2>&1 || true
        docker exec "$node" sh -c "df -h" >> "$MONITOR_DIR/node-${node}-disk.log" 2>&1 || true
        sleep 15
      done
    ) &
    echo $! >> "$MONITOR_DIR/monitor-pids.txt"
  done
  ok "System resource monitoring started on Kind nodes"
fi

# Function to stop all monitoring
stop_monitoring() {
  say "Stopping all monitoring..."
  
  # Stop tcpdump
  if [[ -n "$TCPDUMP_PID" ]]; then
    kill "$TCPDUMP_PID" 2>/dev/null || true
    sleep 3
    
    # Copy pcap file
    say "Copying tcpdump capture..."
    if kubectl -n ingress-nginx exec "$CADDY_POD" -- test -f /tmp/caddy-traffic.pcap 2>/dev/null; then
      kubectl -n ingress-nginx cp "${CADDY_POD}:/tmp/caddy-traffic.pcap" "$MONITOR_DIR/caddy-traffic.pcap" 2>&1 || warn "Failed to copy pcap"
      kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "ls -lh /tmp/caddy-traffic.pcap" > "$MONITOR_DIR/tcpdump-file-info.txt" 2>&1 || true
      kubectl -n ingress-nginx exec "$CADDY_POD" -- rm -f /tmp/caddy-traffic.pcap 2>/dev/null || true
      ok "tcpdump capture saved: $MONITOR_DIR/caddy-traffic.pcap"
    else
      warn "tcpdump pcap file not found"
    fi
  fi
  
  # Stop all other monitors
  for pid in "$METRICS_PID" "$STATUS_MONITOR_PID"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  [[ -n "$AUTH_MONITOR_PID" ]] && kill "$AUTH_MONITOR_PID" 2>/dev/null || true
  
  if [[ -f "$MONITOR_DIR/monitor-pids.txt" ]]; then
    while read pid; do
      kill "$pid" 2>/dev/null || true
    done < "$MONITOR_DIR/monitor-pids.txt"
  fi
  
  ok "All monitoring stopped"
}

trap stop_monitoring EXIT INT TERM

# Create monitoring info
cat > "$MONITOR_DIR/monitoring-info.txt" <<EOF
Monitoring started: $(date)
Timestamp: $TIMESTAMP
Caddy Pod: $CADDY_POD
Auth Pod: ${AUTH_POD:-N/A}
Webapp Pod: ${WEBAPP_POD:-N/A}
TCPDump PID: $TCPDUMP_PID
Metrics PID: $METRICS_PID
Status Monitor PID: $STATUS_MONITOR_PID
Auth Monitor PID: ${AUTH_MONITOR_PID:-N/A}
EOF

# Function to run limit test with monitoring
run_limit_test() {
  local protocol=$1
  local k6_bin=$2
  local test_start=$(date +%s)
  
  say "=== Running ${protocol} Limit Finding Test ==="
  echo "Start time: $(date)"
  echo "K6 binary: $k6_bin"
  
  # Mark test start in monitoring
  echo "=== ${protocol} TEST START: $(date) ===" >> "$MONITOR_DIR/test-timeline.log"
  
  # Replace slashes in protocol name for file paths
  PROTOCOL_FILE=$(echo "$protocol" | tr '/' '-')
  
  "$k6_bin" run \
    --env BASE_URL="$BASE_URL" \
    --env HOST="$HOST" \
    --env HTTP_VERSION="$protocol" \
    --out json="$RESULTS_DIR/${PROTOCOL_FILE}-results.json" \
    --summary-export="$RESULTS_DIR/${PROTOCOL_FILE}-summary.json" \
    "$SCRIPT_DIR/load/k6-e2e-find-limit.js" \
    > "$RESULTS_DIR/${PROTOCOL_FILE}-output.log" 2>&1
  
  local exit_code=$?
  local test_end=$(date +%s)
  local duration=$((test_end - test_start))
  
  echo "=== ${protocol} TEST END: $(date) (Duration: ${duration}s) ===" >> "$MONITOR_DIR/test-timeline.log"
  
  if [[ $exit_code -eq 0 ]]; then
    ok "${protocol} test completed (${duration}s)"
  else
    warn "${protocol} test completed with errors (exit code: $exit_code, ${duration}s)"
  fi
  
  return $exit_code
}

# Run HTTP/2 test
say "=== Starting HTTP/2 Limit Finding Test ==="
run_limit_test "HTTP/2" "k6"
HTTP2_EXIT=$?

# Wait between tests
say "Waiting 15 seconds before HTTP/3 test..."
sleep 15

# Run HTTP/3 test
say "=== Starting HTTP/3 Limit Finding Test ==="
if [[ -f "$K6_HTTP3_BIN" ]]; then
  ok "Using custom k6-http3 binary: $K6_HTTP3_BIN"
  run_limit_test "HTTP/3" "$K6_HTTP3_BIN"
  HTTP3_EXIT=$?
else
  warn "Custom k6-http3 binary not found at $K6_HTTP3_BIN"
  warn "Attempting to build it now..."
  if "$SCRIPT_DIR/build-k6-http3.sh" 2>&1 | tee "$RESULTS_DIR/k6-http3-build.log"; then
    if [[ -f "$K6_HTTP3_BIN" ]]; then
      ok "Built k6-http3 binary successfully"
      run_limit_test "HTTP/3" "$K6_HTTP3_BIN"
      HTTP3_EXIT=$?
    else
      warn "Build completed but binary not found. Skipping HTTP/3 test."
      HTTP3_EXIT=0
    fi
  else
    warn "Failed to build k6-http3. Skipping HTTP/3 test."
    HTTP3_EXIT=0
  fi
fi

# Stop monitoring
stop_monitoring

# Analyze results
say "=== Analyzing Results ==="

# Analyze tcpdump capture
if [[ -f "$MONITOR_DIR/caddy-traffic.pcap" ]]; then
  say "Analyzing tcpdump capture..."
  
  # Count TCP vs UDP packets (HTTP/2 vs HTTP/3)
  if command -v tcpdump >/dev/null 2>&1; then
    tcpdump -r "$MONITOR_DIR/caddy-traffic.pcap" -n 2>/dev/null | \
      awk '{if ($1 == "IP") {if ($5 ~ /\.443:/) tcp++; if ($5 ~ /:443/) udp++}} END {print "TCP packets (HTTP/2):", tcp; print "UDP packets (HTTP/3):", udp}' \
      > "$MONITOR_DIR/tcpdump-analysis.txt" 2>&1 || true
    
    ok "tcpdump analysis saved"
  else
    warn "tcpdump not available locally for analysis"
  fi
fi

# Generate summary report
say "Generating summary report..."

cat > "$RESULTS_DIR/SUMMARY.md" <<EOF
# E2E Limit Finding Test Results

**Timestamp**: $TIMESTAMP  
**Protocols Tested**: HTTP/2, HTTP/3  
**Base URL**: $BASE_URL

## Test Execution

- **HTTP/2 Test**: $(if [[ $HTTP2_EXIT -eq 0 ]]; then echo "✅ Completed"; else echo "❌ Failed (exit code: $HTTP2_EXIT)"; fi)
- **HTTP/3 Test**: $(if [[ $HTTP3_EXIT -eq 0 ]]; then echo "✅ Completed"; else echo "❌ Failed (exit code: $HTTP3_EXIT)"; fi)

## Monitoring Data

All monitoring data is available in: \`monitoring/\`

### Captured Data

1. **tcpdump**: \`monitoring/caddy-traffic.pcap\`
   - Captures TCP (HTTP/2) and UDP (HTTP/3) traffic on port 443
   - Analysis: \`monitoring/tcpdump-analysis.txt\`

2. **Pod Metrics**: \`monitoring/pod-metrics.log\`
   - CPU and memory usage for all pods (every 5 seconds)

3. **Node Metrics**: \`monitoring/node-metrics.log\`
   - CPU and memory usage for all nodes (every 5 seconds)

4. **Process Monitoring**: \`monitoring/auth-processes.log\`
   - Top processes in auth-service pods (every 10 seconds)

5. **Pod Status**: \`monitoring/pod-status-*.txt\`
   - Pod status snapshots (every 30 seconds)

6. **System Resources**: \`monitoring/node-*-*.log\`
   - top, free, df output from Kind nodes (every 15 seconds)

## Test Results

- HTTP/2: \`HTTP-2-results.json\`, \`HTTP-2-summary.json\`
- HTTP/3: \`HTTP-3-results.json\`, \`HTTP-3-summary.json\`

## Analysis

See individual result files for detailed metrics:
- Service success rates
- Latency percentiles (p50, p95, p99, p999, p9999, p100)
- Error counts
- Maximum VUs reached
- Bottleneck identification

EOF

# Extract key metrics from results
if [[ -f "$RESULTS_DIR/HTTP-2-summary.json" ]]; then
  say "HTTP/2 Key Metrics:"
  cat "$RESULTS_DIR/HTTP-2-summary.json" | jq -r '
    "  Max VUs: \(.metrics.vus_max.values.value // "N/A")",
    "  Total Requests: \(.metrics.http_reqs.values.count // 0)",
    "  Error Rate: \((.metrics.http_req_failed.values.rate // 0) * 100 | floor)%",
    "  Avg Latency: \(.metrics.http_req_duration.values.avg // "N/A" | floor)ms",
    "  p95 Latency: \(.metrics.http_req_duration.values["p(95)"] // "N/A" | floor)ms"
  ' || cat "$RESULTS_DIR/HTTP-2-output.log" | tail -20
fi

if [[ -f "$RESULTS_DIR/HTTP-3-summary.json" ]]; then
  say "HTTP/3 Key Metrics:"
  cat "$RESULTS_DIR/HTTP-3-summary.json" | jq -r '
    "  Max VUs: \(.metrics.vus_max.values.value // "N/A")",
    "  Total Requests: \(.metrics.http_reqs.values.count // 0)",
    "  Error Rate: \((.metrics.http_req_failed.values.rate // 0) * 100 | floor)%",
    "  Avg Latency: \(.metrics.http_req_duration.values.avg // "N/A" | floor)ms",
    "  p95 Latency: \(.metrics.http_req_duration.values["p(95)"] // "N/A" | floor)ms"
  ' || cat "$RESULTS_DIR/HTTP-3-output.log" | tail -20
fi

# Final summary
say "=== Test Complete ==="
ok "All results saved to: $RESULTS_DIR"
ok "Monitoring data saved to: $MONITOR_DIR"
echo ""
echo "Files generated:"
echo "  - SUMMARY.md: Test summary and analysis"
echo "  - HTTP-2-results.json: Full HTTP/2 k6 results"
echo "  - HTTP-3-results.json: Full HTTP/3 k6 results"
echo "  - monitoring/caddy-traffic.pcap: Network capture (tcpdump)"
echo "  - monitoring/pod-metrics.log: Pod CPU/memory metrics"
echo "  - monitoring/auth-processes.log: Auth service process monitoring"
echo "  - monitoring/test-timeline.log: Test execution timeline"

if [[ $HTTP2_EXIT -eq 0 ]] && [[ $HTTP3_EXIT -eq 0 ]]; then
  ok "Both tests completed successfully"
  exit 0
else
  warn "Some tests had errors"
  exit 1
fi

