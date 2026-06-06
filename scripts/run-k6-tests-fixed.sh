#!/usr/bin/env bash
set -euo pipefail

# Fixed k6 Test Runner with Monitoring
# This version ensures k6 actually starts and runs

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-k6-fixed"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$RESULTS_DIR" "$MONITOR_DIR"

NS="record-platform"
NS_INGRESS="ingress-nginx"

# Get pods
CADDY_POD=$(kubectl -n "$NS_INGRESS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=($(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

say "=== Fixed k6 Test with Monitoring ==="
echo "Results: $RESULTS_DIR"
echo ""

# Function to start monitoring (simplified, non-blocking)
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
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http3-udp.pcap 'udp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
    else
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http2-tcp.pcap 'tcp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
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
  
  # 3. CPU monitoring (background, redirect output)
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S)
      echo "=== CPU at $timestamp ===" >> "$monitor_subdir/cpu.log" 2>&1
      kubectl top pods -n "$NS" -l app=auth-service --no-headers >> "$monitor_subdir/cpu.log" 2>/dev/null || echo "Metrics unavailable" >> "$monitor_subdir/cpu.log"
      sleep 2
    done
  ) &
  pids+=($!)
  ok "CPU monitoring started (PID: ${pids[-1]})"
  
  # Save PIDs to file (don't use command substitution)
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

# Test 1: HTTP/2
say "=== Test 1: HTTP/2 Limit Test ==="
start_monitoring "HTTP/2" "http2-limit"
MONITOR_PID_FILE="$MONITOR_DIR/http2-limit/pids.txt"
sleep 3

say "Running k6 HTTP/2 test..."
say "Command: k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js"
say "Output will be saved to: $RESULTS_DIR/k6-http2.log"

# Run k6 directly (no timeout wrapper, let it run naturally)
# Use explicit output redirection to ensure file is created immediately
k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http2.log" 2>&1 &
K6_PID=$!

# Verify k6 started
sleep 2
if ! kill -0 "$K6_PID" 2>/dev/null; then
  fail "k6 process died immediately. Check $RESULTS_DIR/k6-http2.log for errors"
fi

ok "k6 started (PID: $K6_PID)"

# Wait for k6 with timeout (6 minutes = 360 seconds)
say "Waiting for k6 to complete (max 6 minutes)..."
K6_EXIT=0
for i in {1..360}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    # Process finished, wait to get exit code
    wait "$K6_PID" 2>/dev/null || K6_EXIT=$?
    if [[ $K6_EXIT -eq 0 ]]; then
      ok "k6 HTTP/2 test completed successfully"
    else
      warn "k6 HTTP/2 test completed with exit code: $K6_EXIT"
    fi
    break
  fi
  if [[ $i -eq 360 ]]; then
    warn "k6 HTTP/2 test timed out after 6 minutes"
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
  if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http2-tcp.pcap 2>/dev/null; then
    kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http2-tcp.pcap" "$MONITOR_DIR/http2-limit/http2-tcp.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/2 pcap"
    ok "HTTP/2 pcap saved"
  fi
fi

say "Waiting 30 seconds for services to recover..."
sleep 30

# Test 2: HTTP/3
say "=== Test 2: HTTP/3 Limit Test ==="
start_monitoring "HTTP/3" "http3-limit"
MONITOR_PID_FILE="$MONITOR_DIR/http3-limit/pids.txt"
sleep 3

say "Running k6 HTTP/3 test..."
say "Command: HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js"
say "Output will be saved to: $RESULTS_DIR/k6-http3.log"

# Run k6 with HTTP/3
HTTP_VERSION=HTTP/3 k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http3.log" 2>&1 &
K6_PID=$!

# Verify k6 started
sleep 2
if ! kill -0 "$K6_PID" 2>/dev/null; then
  fail "k6 process died immediately. Check $RESULTS_DIR/k6-http3.log for errors"
fi

ok "k6 started (PID: $K6_PID)"

# Wait for k6 with timeout
say "Waiting for k6 to complete (max 6 minutes)..."
K6_EXIT=0
for i in {1..360}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    # Process finished, wait to get exit code
    wait "$K6_PID" 2>/dev/null || K6_EXIT=$?
    if [[ $K6_EXIT -eq 0 ]]; then
      ok "k6 HTTP/3 test completed successfully"
    else
      warn "k6 HTTP/3 test completed with exit code: $K6_EXIT"
    fi
    break
  fi
  if [[ $i -eq 360 ]]; then
    warn "k6 HTTP/3 test timed out after 6 minutes"
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
  if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http3-udp.pcap 2>/dev/null; then
    kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http3-udp.pcap" "$MONITOR_DIR/http3-limit/http3-udp.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/3 pcap"
    ok "HTTP/3 pcap saved"
  fi
fi

say "=== Test Complete ==="
ok "Results saved to: $RESULTS_DIR"
echo ""
echo "Files:"
echo "  - k6-http2.log"
echo "  - k6-http3.log"
echo "  - monitoring/http2-limit/*.log"
echo "  - monitoring/http3-limit/*.log"
echo ""
echo "To view results:"
echo "  tail -f $RESULTS_DIR/k6-http2.log"
echo "  tail -f $RESULTS_DIR/k6-http3.log"

