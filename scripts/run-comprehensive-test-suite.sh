#!/usr/bin/env bash
set -euo pipefail

# Comprehensive Test Suite
# 1. Smoke Test (gRPC health checks with strict TLS)
# 2. Comprehensive k6 Test (100 VUs, HTTP/2)
# 3. Comprehensive k6 Test (100 VUs, HTTP/3)
# All with full monitoring (tcpdump, strace, htop-style CPU)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-comprehensive"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$RESULTS_DIR" "$MONITOR_DIR"

NS="record-platform"
NS_INGRESS="ingress-nginx"

# Get pods
CADDY_POD=$(kubectl -n "$NS_INGRESS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=($(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

say "=== Comprehensive Test Suite ==="
echo "Results: $RESULTS_DIR"
echo ""

# Set BASE_URL and HOST for k6 tests
BASE_URL="${BASE_URL:-https://record.local:30443}"
HOST="${HOST:-record.local}"

# Function to start comprehensive monitoring
start_monitoring() {
  local protocol="$1"
  local test_name="$2"
  local monitor_subdir="$MONITOR_DIR/$test_name"
  mkdir -p "$monitor_subdir"
  
  say "Starting monitoring for $protocol..."
  
  local pids=()
  
  # 1. tcpdump (background, redirect output)
  if [[ -n "$CADDY_POD" ]]; then
    if [[ "$protocol" == "HTTP/3" ]]; then
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http3-comprehensive.pcap 'udp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
    else
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http2-comprehensive.pcap 'tcp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
    fi
    pids+=($!)
    ok "tcpdump started (PID: ${pids[-1]})"
  fi
  
  # 2. strace on auth pods (background, redirect output)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S)
          echo "=== strace at $timestamp ===" >> "$monitor_subdir/strace-${auth_pod}.log" 2>&1
          NODE_PID=$(kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux | grep node | grep -v grep | head -1 | awk '{print \$2}'" 2>/dev/null || echo "1")
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "timeout 5 strace -c -p $NODE_PID 2>&1 || true" >> "$monitor_subdir/strace-${auth_pod}.log" 2>&1 || true
          sleep 10
        done
      ) &
      pids+=($!)
      ok "strace started on $auth_pod (PID: ${pids[-1]})"
    done
  fi
  
  # 3. CPU monitoring (htop-style, background, redirect output)
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S)
      echo "=== CPU Metrics at $timestamp ===" >> "$monitor_subdir/cpu-metrics.log" 2>&1
      echo "--- Node CPU ---" >> "$monitor_subdir/cpu-metrics.log" 2>&1
      kubectl top nodes --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || echo "Metrics API unavailable" >> "$monitor_subdir/cpu-metrics.log"
      echo "--- Auth Service Pods CPU ---" >> "$monitor_subdir/cpu-metrics.log" 2>&1
      kubectl -n "$NS" top pods -l app=auth-service --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || echo "Metrics API unavailable" >> "$monitor_subdir/cpu-metrics.log"
      echo "--- All Pods CPU (top 20) ---" >> "$monitor_subdir/cpu-metrics.log" 2>&1
      kubectl top pods -A --no-headers 2>/dev/null | head -20 >> "$monitor_subdir/cpu-metrics.log" || echo "Metrics API unavailable" >> "$monitor_subdir/cpu-metrics.log"
      echo "" >> "$monitor_subdir/cpu-metrics.log" 2>&1
      sleep 2
    done
  ) &
  pids+=($!)
  ok "CPU monitoring (htop-style) started (PID: ${pids[-1]})"
  
  # 4. Process-level CPU monitoring from auth pods (htop-style)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S)
          echo "=== htop-style CPU at $timestamp ===" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux --sort=-%cpu | head -15" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "cat /proc/stat | head -1" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          echo "" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1
          sleep 2
        done
      ) &
      pids+=($!)
      ok "htop-style monitoring started on $auth_pod (PID: ${pids[-1]})"
    done
  fi
  
  # Save PIDs to file
  printf "%s\n" "${pids[@]}" > "$monitor_subdir/pids.txt"
  ok "Monitoring started (${#pids[@]} processes)"
}

# Function to stop monitoring
stop_monitoring() {
  local pid_file="$1"
  say "Stopping monitoring..."
  if [[ -f "$pid_file" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done < "$pid_file"
    rm -f "$pid_file"
  fi
  pkill -P $$ 2>/dev/null || true
  sleep 2
  ok "Monitoring stopped"
}

# Step 1: Smoke Test (gRPC Health Checks with Strict TLS)
say "=== Step 1: Smoke Test (gRPC Health Checks with Strict TLS) ==="
say "Running smoke test to verify gRPC health checks..."
"$SCRIPT_DIR/lib/run-with-timeout.sh" 180 "$SCRIPT_DIR/test-microservices-http2-http3.sh" 2>&1 | tee "$RESULTS_DIR/01-smoke-test.log"

SMOKE_EXIT=${PIPESTATUS[0]}
if [[ $SMOKE_EXIT -eq 0 ]]; then
  ok "Smoke test completed"
elif [[ $SMOKE_EXIT -eq 124 ]]; then
  warn "Smoke test timed out after 3 minutes"
else
  warn "Smoke test completed with warnings (exit code: $SMOKE_EXIT)"
  warn "Some gRPC health checks may have failed - check logs"
fi

# Check gRPC health check results
echo "" >> "$RESULTS_DIR/01-smoke-test-summary.txt"
echo "=== gRPC Health Check Summary ===" >> "$RESULTS_DIR/01-smoke-test-summary.txt"
grep -E "gRPC.*HealthCheck|✅|⚠️" "$RESULTS_DIR/01-smoke-test.log" | grep -E "gRPC|HealthCheck" >> "$RESULTS_DIR/01-smoke-test-summary.txt" || true

say "Waiting 10 seconds before next test..."
sleep 10

# Step 2: Comprehensive k6 Test - HTTP/2 (100 VUs)
say "=== Step 2: Comprehensive k6 Test - HTTP/2 (100 VUs) ==="
start_monitoring "HTTP/2" "http2-comprehensive"
MONITOR_PID_FILE="$MONITOR_DIR/http2-comprehensive/pids.txt"
sleep 3

say "Running k6 comprehensive test (HTTP/2, 100 VUs)..."
say "Command: k6 run --vus 100 --duration 10m scripts/load/k6-all-services-comprehensive.js"
say "Output will be saved to:"
say "  - $RESULTS_DIR/k6-http2-comprehensive.log (stdout with full metrics)"
say "  - $RESULTS_DIR/k6-service-metrics-http2.json (service breakdown)"
say "  - $RESULTS_DIR/k6-report-http2.html (HTML report)"

# Run k6 and capture output (handleSummary writes files to current directory)
# Use env vars (VUS, DURATION) as the script uses stages
(cd "$RESULTS_DIR" && BASE_URL="$BASE_URL" HOST="$HOST" VUS=100 DURATION=10m k6 run "$PROJECT_ROOT/scripts/load/k6-all-services-comprehensive.js") \
  > "$RESULTS_DIR/k6-http2-comprehensive.log" 2>&1 &
K6_PID=$!

# Verify k6 started
sleep 2
if ! kill -0 "$K6_PID" 2>/dev/null; then
  fail "k6 process died immediately. Check $RESULTS_DIR/k6-http2-comprehensive.log for errors"
fi

ok "k6 started (PID: $K6_PID)"

# Wait for k6 with timeout (15 minutes for comprehensive test)
say "Waiting for k6 to complete (max 15 minutes)..."
K6_EXIT=0
for i in {1..900}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    wait "$K6_PID" 2>/dev/null || K6_EXIT=$?
    if [[ $K6_EXIT -eq 0 ]]; then
      ok "k6 HTTP/2 comprehensive test completed successfully"
    else
      warn "k6 HTTP/2 comprehensive test completed with exit code: $K6_EXIT"
    fi
    break
  fi
  if [[ $i -eq 900 ]]; then
    warn "k6 HTTP/2 comprehensive test timed out after 15 minutes"
    kill "$K6_PID" 2>/dev/null || true
    K6_EXIT=124
    break
  fi
  sleep 1
done

stop_monitoring "$MONITOR_PID_FILE"

# Copy tcpdump captures
if [[ -n "$CADDY_POD" ]]; then
  say "Copying tcpdump captures..."
  if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http2-comprehensive.pcap 2>/dev/null; then
    kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http2-comprehensive.pcap" "$MONITOR_DIR/http2-comprehensive/http2-comprehensive.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/2 pcap"
    ok "HTTP/2 pcap saved"
  fi
fi

say "Waiting 30 seconds for services to recover..."
sleep 30

# Step 3: Comprehensive k6 Test - HTTP/3 (100 VUs)
say "=== Step 3: Comprehensive k6 Test - HTTP/3 (100 VUs) ==="
start_monitoring "HTTP/3" "http3-comprehensive"
MONITOR_PID_FILE="$MONITOR_DIR/http3-comprehensive/pids.txt"
sleep 3

say "Running k6 comprehensive test (HTTP/3, 100 VUs)..."
say "Command: HTTP_VERSION=HTTP/3 k6 run --vus 100 --duration 10m scripts/load/k6-all-services-comprehensive.js"
say "Output will be saved to:"
say "  - $RESULTS_DIR/k6-http3-comprehensive.log (stdout with full metrics)"
say "  - $RESULTS_DIR/k6-service-metrics-http3.json (service breakdown)"
say "  - $RESULTS_DIR/k6-report-http3.html (HTML report)"

# Run k6 and capture output (handleSummary writes files to current directory)
# Use env vars (VUS, DURATION) as the script uses stages
(cd "$RESULTS_DIR" && HTTP_VERSION=HTTP/3 BASE_URL="$BASE_URL" HOST="$HOST" VUS=100 DURATION=10m k6 run "$PROJECT_ROOT/scripts/load/k6-all-services-comprehensive.js") \
  > "$RESULTS_DIR/k6-http3-comprehensive.log" 2>&1 &
K6_PID=$!

# Verify k6 started
sleep 2
if ! kill -0 "$K6_PID" 2>/dev/null; then
  fail "k6 process died immediately. Check $RESULTS_DIR/k6-http3-comprehensive.log for errors"
fi

ok "k6 started (PID: $K6_PID)"

# Wait for k6 with timeout
say "Waiting for k6 to complete (max 15 minutes)..."
K6_EXIT=0
for i in {1..900}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    wait "$K6_PID" 2>/dev/null || K6_EXIT=$?
    if [[ $K6_EXIT -eq 0 ]]; then
      ok "k6 HTTP/3 comprehensive test completed successfully"
    else
      warn "k6 HTTP/3 comprehensive test completed with exit code: $K6_EXIT"
    fi
    break
  fi
  if [[ $i -eq 900 ]]; then
    warn "k6 HTTP/3 comprehensive test timed out after 15 minutes"
    kill "$K6_PID" 2>/dev/null || true
    K6_EXIT=124
    break
  fi
  sleep 1
done

stop_monitoring "$MONITOR_PID_FILE"

# Copy tcpdump captures
if [[ -n "$CADDY_POD" ]]; then
  say "Copying tcpdump captures..."
  if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http3-comprehensive.pcap 2>/dev/null; then
    kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http3-comprehensive.pcap" "$MONITOR_DIR/http3-comprehensive/http3-comprehensive.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/3 pcap"
    ok "HTTP/3 pcap saved"
  fi
fi

say "=== Test Suite Complete ==="
ok "Results saved to: $RESULTS_DIR"
echo ""
echo "Files:"
echo "  - 01-smoke-test.log (gRPC health checks)"
echo "  - k6-http2-comprehensive.log (100 VUs)"
echo "  - k6-http3-comprehensive.log (100 VUs)"
echo "  - monitoring/http2-comprehensive/* (tcpdump, strace, CPU)"
echo "  - monitoring/http3-comprehensive/* (tcpdump, strace, CPU)"
echo ""
echo "To view results:"
echo "  tail -50 $RESULTS_DIR/k6-http2-comprehensive.log"
echo "  tail -50 $RESULTS_DIR/k6-http3-comprehensive.log"
echo "  cat $RESULTS_DIR/01-smoke-test-summary.txt"

