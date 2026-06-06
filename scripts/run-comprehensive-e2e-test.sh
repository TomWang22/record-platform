#!/usr/bin/env bash
set -euo pipefail

# Comprehensive E2E Test Suite
# 1. Smoke test (HTTP/2 and HTTP/3)
# 2. Normal k6 test
# 3. Find the limit test (with per-pod monitoring)
# 4. Document bottlenecks and findings

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
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-comprehensive-e2e"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$RESULTS_DIR" "$MONITOR_DIR"

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

say "=== Comprehensive E2E Test Suite ==="
echo "Results: $RESULTS_DIR"
echo "Monitoring: $MONITOR_DIR"

# Get pods for monitoring
CADDY_POD=$(kubectl -n ingress-nginx get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=$(kubectl get pods -n default -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$CADDY_POD" ]]; then
  fail "Caddy pod not found"
fi

ok "Found pods: Caddy=$CADDY_POD, Auth=$(echo $AUTH_PODS | wc -w | tr -d ' ') pods"

# Function to start comprehensive monitoring
start_monitoring() {
  local test_name=$1
  say "Starting monitoring for: $test_name"
  
  # Start tcpdump on Caddy (HTTP/2 TCP + HTTP/3 UDP)
  say "Starting tcpdump on Caddy pod..."
  kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/caddy-${test_name}.pcap 'tcp port 443 or udp port 443' 2>&1" > "$MONITOR_DIR/tcpdump-${test_name}.log" 2>&1 &
  echo $! > "$MONITOR_DIR/tcpdump-${test_name}.pid"
  sleep 2
  ok "tcpdump started (capturing TCP:443 and UDP:443)"
  
  # Start pod metrics collection
  say "Starting pod metrics collection..."
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
      echo "=== Metrics at $timestamp ===" >> "$MONITOR_DIR/pod-metrics-${test_name}.log"
      kubectl top pods -A --no-headers >> "$MONITOR_DIR/pod-metrics-${test_name}.log" 2>&1 || true
      echo "" >> "$MONITOR_DIR/pod-metrics-${test_name}.log"
      sleep 5
    done
  ) &
  echo $! > "$MONITOR_DIR/metrics-${test_name}.pid"
  ok "Pod metrics collection started (every 5s)"
  
  # Start process monitoring on auth pods (htop/strace equivalent)
  if [[ -n "$AUTH_PODS" ]]; then
    say "Starting process monitoring on auth-service pods..."
    for pod in $AUTH_PODS; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S)
          echo "=== Processes at $timestamp ===" >> "$MONITOR_DIR/auth-${pod}-processes-${test_name}.log"
          kubectl -n default exec "$pod" -- sh -c "ps aux --sort=-%cpu | head -30" >> "$MONITOR_DIR/auth-${pod}-processes-${test_name}.log" 2>&1 || true
          echo "" >> "$MONITOR_DIR/auth-${pod}-processes-${test_name}.log"
          sleep 10
        done
      ) &
      echo $! >> "$MONITOR_DIR/auth-monitors-${test_name}.pid"
    done
    ok "Auth service process monitoring started (every 10s)"
  fi
  
  # Start system resource monitoring (Kind nodes)
  say "Starting system resource monitoring..."
  KIND_NODES=$(kind get nodes --name h3 2>/dev/null || echo "")
  if [[ -n "$KIND_NODES" ]]; then
    for node in $KIND_NODES; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S)
          docker exec "$node" sh -c "top -bn1 | head -40" > "$MONITOR_DIR/node-${node}-top-${test_name}-${timestamp}.txt" 2>&1 || true
          docker exec "$node" sh -c "free -h" >> "$MONITOR_DIR/node-${node}-resources-${test_name}.log" 2>&1 || true
          sleep 15
        done
      ) &
      echo $! >> "$MONITOR_DIR/node-monitors-${test_name}.pid"
    done
    ok "System resource monitoring started (every 15s)"
  fi
}

# Function to stop monitoring
stop_monitoring() {
  local test_name=$1
  say "Stopping monitoring for: $test_name"
  
  # Stop tcpdump
  if [[ -f "$MONITOR_DIR/tcpdump-${test_name}.pid" ]]; then
    TCPDUMP_PID=$(cat "$MONITOR_DIR/tcpdump-${test_name}.pid")
    kill "$TCPDUMP_PID" 2>/dev/null || true
    sleep 3
    
    # Copy pcap file
    if kubectl -n ingress-nginx exec "$CADDY_POD" -- test -f "/tmp/caddy-${test_name}.pcap" 2>/dev/null; then
      kubectl -n ingress-nginx cp "${CADDY_POD}:/tmp/caddy-${test_name}.pcap" "$MONITOR_DIR/caddy-${test_name}.pcap" 2>&1 || warn "Failed to copy pcap"
      kubectl -n ingress-nginx exec "$CADDY_POD" -- rm -f "/tmp/caddy-${test_name}.pcap" 2>/dev/null || true
      ok "tcpdump capture saved: $MONITOR_DIR/caddy-${test_name}.pcap"
    fi
  fi
  
  # Stop all other monitors
  for pid_file in "$MONITOR_DIR/metrics-${test_name}.pid" "$MONITOR_DIR/auth-monitors-${test_name}.pid" "$MONITOR_DIR/node-monitors-${test_name}.pid"; do
    if [[ -f "$pid_file" ]]; then
      while read pid; do
        kill "$pid" 2>/dev/null || true
      done < "$pid_file"
    fi
  done
  
  ok "Monitoring stopped for: $test_name"
}

# Step 1: Smoke Test
say "=== Step 1: Smoke Test (HTTP/2 and HTTP/3) ==="
start_monitoring "smoke-test"

if "$SCRIPT_DIR/test-microservices-http2-http3.sh" > "$RESULTS_DIR/smoke-test-output.log" 2>&1; then
  ok "Smoke test completed"
else
  warn "Smoke test had errors (check $RESULTS_DIR/smoke-test-output.log)"
fi

stop_monitoring "smoke-test"
sleep 5

# Step 2: Normal k6 Test
say "=== Step 2: Normal k6 E2E Test ==="
start_monitoring "k6-normal"

say "Running normal k6 E2E test (HTTP/2)..."
k6 run \
  --vus 50 \
  --duration 2m \
  --env BASE_URL="$BASE_URL" \
  --env HOST="$HOST" \
  --env HTTP_VERSION="HTTP/2" \
  --out json="$RESULTS_DIR/k6-normal-http2-results.json" \
  --summary-export="$RESULTS_DIR/k6-normal-http2-summary.json" \
  "$SCRIPT_DIR/load/k6-all-services-comprehensive.js" \
  > "$RESULTS_DIR/k6-normal-http2-output.log" 2>&1 || warn "k6 normal test had errors"

ok "Normal k6 test completed"

stop_monitoring "k6-normal"
sleep 10

# Step 3: Find the Limit Test (HTTP/2)
say "=== Step 3: Find the Limit Test (HTTP/2) ==="
start_monitoring "k6-limit-http2"

say "Running limit finding test (HTTP/2) - ramping 10→500 VUs..."
k6 run \
  --env BASE_URL="$BASE_URL" \
  --env HOST="$HOST" \
  --env HTTP_VERSION="HTTP/2" \
  --out json="$RESULTS_DIR/k6-limit-http2-results.json" \
  --summary-export="$RESULTS_DIR/k6-limit-http2-summary.json" \
  "$SCRIPT_DIR/load/k6-e2e-find-limit.js" \
  > "$RESULTS_DIR/k6-limit-http2-output.log" 2>&1 || warn "k6 limit test had errors"

ok "Limit finding test (HTTP/2) completed"

stop_monitoring "k6-limit-http2"
sleep 15

# Step 4: Find the Limit Test (HTTP/3)
say "=== Step 4: Find the Limit Test (HTTP/3) ==="
K6_HTTP3_BIN="$PROJECT_ROOT/.k6-build/bin/k6-http3"
if [[ ! -f "$K6_HTTP3_BIN" ]]; then
  warn "k6-http3 binary not found, building..."
  "$SCRIPT_DIR/build-k6-http3.sh" || warn "Failed to build k6-http3"
fi

if [[ -f "$K6_HTTP3_BIN" ]]; then
  start_monitoring "k6-limit-http3"
  
  say "Running limit finding test (HTTP/3) - ramping 10→500 VUs..."
  "$K6_HTTP3_BIN" run \
    --env BASE_URL="$BASE_URL" \
    --env HOST="$HOST" \
    --env HTTP_VERSION="HTTP/3" \
    --out json="$RESULTS_DIR/k6-limit-http3-results.json" \
    --summary-export="$RESULTS_DIR/k6-limit-http3-summary.json" \
    "$SCRIPT_DIR/load/k6-e2e-find-limit.js" \
    > "$RESULTS_DIR/k6-limit-http3-output.log" 2>&1 || warn "k6 limit test (HTTP/3) had errors"
  
  ok "Limit finding test (HTTP/3) completed"
  
  stop_monitoring "k6-limit-http3"
else
  warn "Skipping HTTP/3 limit test - binary not available"
fi

# Step 5: Analyze Results and Document
say "=== Step 5: Analyzing Results and Documenting Bottlenecks ==="

# Analyze tcpdump captures
say "Analyzing tcpdump captures..."
for pcap in "$MONITOR_DIR"/caddy-*.pcap; do
  if [[ -f "$pcap" ]]; then
    test_name=$(basename "$pcap" .pcap | sed 's/caddy-//')
    if command -v tcpdump >/dev/null 2>&1; then
      say "Analyzing $test_name..."
      tcpdump -r "$pcap" -n 2>/dev/null | \
        awk 'BEGIN{tcp=0;udp=0} /IP.*\.443:/ {tcp++} /IP.*:443/ {udp++} END {print "TCP packets (HTTP/2):", tcp; print "UDP packets (HTTP/3):", udp}' \
        > "$MONITOR_DIR/tcpdump-analysis-${test_name}.txt" 2>&1 || true
    fi
  fi
done

# Generate comprehensive report
say "Generating comprehensive report..."
cat > "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF
# Comprehensive E2E Test Report

**Date**: $(date)  
**Timestamp**: $TIMESTAMP  
**Base URL**: $BASE_URL

## Test Execution Summary

### 1. Smoke Test
- **Status**: $(if [[ -f "$RESULTS_DIR/smoke-test-output.log" ]]; then grep -q "✅" "$RESULTS_DIR/smoke-test-output.log" && echo "✅ Passed" || echo "⚠️  Had errors"; else echo "⏳ Not run"; fi)
- **Output**: \`smoke-test-output.log\`
- **Monitoring**: \`monitoring/caddy-smoke-test.pcap\`

### 2. Normal k6 Test (HTTP/2)
- **Status**: $(if [[ -f "$RESULTS_DIR/k6-normal-http2-summary.json" ]]; then echo "✅ Completed"; else echo "⏳ Not completed"; fi)
- **VUs**: 50
- **Duration**: 2 minutes
- **Results**: \`k6-normal-http2-results.json\`
- **Summary**: \`k6-normal-http2-summary.json\`

### 3. Find the Limit Test (HTTP/2)
- **Status**: $(if [[ -f "$RESULTS_DIR/k6-limit-http2-summary.json" ]]; then echo "✅ Completed"; else echo "⏳ Not completed"; fi)
- **Ramp**: 10 → 50 → 100 → 200 → 300 → 500 VUs
- **Results**: \`k6-limit-http2-results.json\`
- **Summary**: \`k6-limit-http2-summary.json\`

### 4. Find the Limit Test (HTTP/3)
- **Status**: $(if [[ -f "$RESULTS_DIR/k6-limit-http3-summary.json" ]]; then echo "✅ Completed"; else echo "⏳ Not completed"; fi)
- **Ramp**: 10 → 50 → 100 → 200 → 300 → 500 VUs
- **Results**: \`k6-limit-http3-results.json\`
- **Summary**: \`k6-limit-http3-summary.json\`

## Protocol Verification (tcpdump)

EOF

# Add tcpdump analysis to report
for analysis in "$MONITOR_DIR"/tcpdump-analysis-*.txt; do
  if [[ -f "$analysis" ]]; then
    test_name=$(basename "$analysis" .txt | sed 's/tcpdump-analysis-//')
    echo "### $test_name" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    cat "$analysis" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    echo "" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
  fi
done

# Add limit finding analysis
cat >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF
## Limit Finding Analysis

### HTTP/2 Limits

EOF

if [[ -f "$RESULTS_DIR/k6-limit-http2-summary.json" ]]; then
  jq -r '.metrics | "
**Max VUs Reached**: \(.vus_max.values.value // "N/A")
**Total Requests**: \(.http_reqs.values.count // 0)
**Error Rate**: \((.http_req_failed.values.rate // 0) * 100 | floor)%
**Average Latency**: \(.http_req_duration.values.avg // "N/A" | floor)ms
**p95 Latency**: \(.http_req_duration.values["p(95)"] // "N/A" | floor)ms
**p99 Latency**: \(.http_req_duration.values["p(99)"] // "N/A" | floor)ms
"' "$RESULTS_DIR/k6-limit-http2-summary.json" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" 2>/dev/null || echo "Could not parse HTTP/2 results" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
fi

cat >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF

### HTTP/3 Limits

EOF

if [[ -f "$RESULTS_DIR/k6-limit-http3-summary.json" ]]; then
  jq -r '.metrics | "
**Max VUs Reached**: \(.vus_max.values.value // "N/A")
**Total Requests**: \(.http_reqs.values.count // 0)
**Error Rate**: \((.http_req_failed.values.rate // 0) * 100 | floor)%
**Average Latency**: \(.http_req_duration.values.avg // "N/A" | floor)ms
**p95 Latency**: \(.http_req_duration.values["p(95)"] // "N/A" | floor)ms
**p99 Latency**: \(.http_req_duration.values["p(99)"] // "N/A" | floor)ms
"' "$RESULTS_DIR/k6-limit-http3-summary.json" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" 2>/dev/null || echo "Could not parse HTTP/3 results" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
fi

# Add per-pod bottleneck analysis
cat >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF

## Per-Pod Bottleneck Analysis

### Auth Service Pods

EOF

if [[ -n "$AUTH_PODS" ]]; then
  for pod in $AUTH_PODS; do
    echo "#### Pod: $pod" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    echo "" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    
    # Find peak CPU usage from process logs
    for log in "$MONITOR_DIR"/auth-${pod}-processes-*.log; do
      if [[ -f "$log" ]]; then
        test_name=$(basename "$log" .log | sed "s/auth-${pod}-processes-//")
        echo "**$test_name test:**" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
        echo "\`\`\`" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
        grep -E "node|bcrypt|CPU" "$log" | head -10 >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" || echo "No process data" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
        echo "\`\`\`" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
        echo "" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
      fi
    done
  done
fi

# Add pod metrics analysis
cat >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF

### Pod Metrics (CPU/Memory)

Peak resource usage during limit finding tests:

EOF

for metrics_log in "$MONITOR_DIR"/pod-metrics-k6-limit-*.log; do
  if [[ -f "$metrics_log" ]]; then
    test_name=$(basename "$metrics_log" .log | sed 's/pod-metrics-//')
    echo "#### $test_name" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    echo "\`\`\`" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    grep -E "auth-service|records-service|listings-service" "$metrics_log" | tail -20 >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" || echo "No metrics data" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    echo "\`\`\`" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
    echo "" >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md"
  fi
done

cat >> "$RESULTS_DIR/COMPREHENSIVE_REPORT.md" <<EOF

## Key Findings

1. **Max Concurrent Users**: Based on limit finding tests
2. **Max Ramping Rate**: How fast we can ramp up VUs before services fail
3. **Bottleneck Services**: Which service fails first under load
4. **Protocol Comparison**: HTTP/2 vs HTTP/3 performance characteristics

## Files Generated

- \`COMPREHENSIVE_REPORT.md\`: This report
- \`smoke-test-output.log\`: Smoke test results
- \`k6-normal-http2-*.json\`: Normal k6 test results
- \`k6-limit-http2-*.json\`: Limit finding test results (HTTP/2)
- \`k6-limit-http3-*.json\`: Limit finding test results (HTTP/3)
- \`monitoring/\`: All monitoring data (tcpdump, pod metrics, process monitoring)

---

**Generated**: $(date)
EOF

ok "Comprehensive report generated: $RESULTS_DIR/COMPREHENSIVE_REPORT.md"

say "=== Test Suite Complete ==="
ok "All results saved to: $RESULTS_DIR"
ok "Report: $RESULTS_DIR/COMPREHENSIVE_REPORT.md"
echo ""
echo "Next steps:"
echo "  1. Review $RESULTS_DIR/COMPREHENSIVE_REPORT.md"
echo "  2. Analyze bottlenecks in monitoring data"
echo "  3. Check tcpdump captures to verify HTTP/2 vs HTTP/3 usage"
echo "  4. Review per-pod CPU/memory usage"

