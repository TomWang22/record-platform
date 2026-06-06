#!/usr/bin/env bash
set -euo pipefail

# Simple k6 Test Runner with Monitoring
# Runs HTTP/2 and HTTP/3 limit tests with tcpdump, strace, htop

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-k6-simple"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$RESULTS_DIR" "$MONITOR_DIR"

NS="record-platform"
NS_INGRESS="ingress-nginx"

# Get pods
CADDY_POD=$(kubectl -n "$NS_INGRESS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=($(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

say "=== Simple k6 Test with Monitoring ==="
echo "Results: $RESULTS_DIR"
echo ""

# Function to start monitoring
start_monitoring() {
  local protocol="$1"
  local test_name="$2"
  local monitor_subdir="$MONITOR_DIR/$test_name"
  mkdir -p "$monitor_subdir"
  
  say "Starting monitoring for $protocol..."
  
  local pids=()
  
  # 1. tcpdump
  if [[ -n "$CADDY_POD" ]]; then
    if [[ "$protocol" == "HTTP/3" ]]; then
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http3-udp.pcap 'udp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
    else
      kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http2-tcp.pcap 'tcp port 443' 2>&1" > "$monitor_subdir/tcpdump.log" 2>&1 &
    fi
    pids+=($!)
    ok "tcpdump started (PID: ${pids[-1]})"
  fi
  
  # 2. strace on auth pods
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S)
          echo "=== strace at $timestamp ===" >> "$monitor_subdir/strace-${auth_pod}.log"
          NODE_PID=$(kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux | grep node | grep -v grep | head -1 | awk '{print \$2}'" 2>/dev/null || echo "1")
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "timeout 5 strace -c -p $NODE_PID 2>&1 || true" >> "$monitor_subdir/strace-${auth_pod}.log" 2>&1 || true
          sleep 10
        done
      ) &
      pids+=($!)
    done
  fi
  
  # 3. CPU monitoring
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S)
      echo "=== CPU at $timestamp ===" >> "$monitor_subdir/cpu.log"
      kubectl top pods -n "$NS" -l app=auth-service --no-headers >> "$monitor_subdir/cpu.log" 2>/dev/null || echo "Metrics unavailable" >> "$monitor_subdir/cpu.log"
      sleep 2
    done
  ) &
  pids+=($!)
  
  # Save PIDs
  printf "%s\n" "${pids[@]}" > "$monitor_subdir/pids.txt"
  echo "${pids[@]}"
}

# Function to stop monitoring
stop_monitoring() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done < "$pid_file"
    rm -f "$pid_file"
  fi
  pkill -P $$ 2>/dev/null || true
  sleep 2
}

# Test 1: HTTP/2
say "=== Test 1: HTTP/2 Limit Test ==="
MONITOR_PIDS=$(start_monitoring "HTTP/2" "http2-limit")
MONITOR_PID_FILE="$MONITOR_DIR/http2-limit/pids.txt"
sleep 3

say "Running k6 HTTP/2 test..."
k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http2.log" 2>&1 &
K6_PID=$!

# Wait for k6 with timeout
say "Waiting for k6 to complete (max 6 minutes)..."
for i in {1..360}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    wait "$K6_PID"
    K6_EXIT=$?
    ok "k6 HTTP/2 test completed (exit: $K6_EXIT)"
    break
  fi
  sleep 1
  if [[ $i -eq 360 ]]; then
    warn "k6 HTTP/2 test timed out after 6 minutes"
    kill "$K6_PID" 2>/dev/null || true
    K6_EXIT=124
  fi
done

stop_monitoring "$MONITOR_PID_FILE"

say "Waiting 30 seconds for recovery..."
sleep 30

# Test 2: HTTP/3
say "=== Test 2: HTTP/3 Limit Test ==="
MONITOR_PIDS=$(start_monitoring "HTTP/3" "http3-limit")
MONITOR_PID_FILE="$MONITOR_DIR/http3-limit/pids.txt"
sleep 3

say "Running k6 HTTP/3 test..."
HTTP_VERSION=HTTP/3 k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http3.log" 2>&1 &
K6_PID=$!

# Wait for k6 with timeout
say "Waiting for k6 to complete (max 6 minutes)..."
for i in {1..360}; do
  if ! kill -0 "$K6_PID" 2>/dev/null; then
    wait "$K6_PID"
    K6_EXIT=$?
    ok "k6 HTTP/3 test completed (exit: $K6_EXIT)"
    break
  fi
  sleep 1
  if [[ $i -eq 360 ]]; then
    warn "k6 HTTP/3 test timed out after 6 minutes"
    kill "$K6_PID" 2>/dev/null || true
    K6_EXIT=124
  fi
done

stop_monitoring "$MONITOR_PID_FILE"

say "=== Test Complete ==="
ok "Results saved to: $RESULTS_DIR"
echo ""
echo "Files:"
echo "  - k6-http2.log"
echo "  - k6-http3.log"
echo "  - monitoring/http2-limit/*.log"
echo "  - monitoring/http3-limit/*.log"

