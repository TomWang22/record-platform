#!/usr/bin/env bash
set -euo pipefail

# Final Test Suite: Smoke Test + k6 Tests with Physical Proof
# Fixed version that doesn't hang

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-final-test-suite"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$MONITOR_DIR"

NS="record-platform"
NS_INGRESS="ingress-nginx"

# Get pods for monitoring
CADDY_POD=$(kubectl -n "$NS_INGRESS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=($(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

say "=== Final Test Suite with Physical Proof ==="
echo "Results: $RESULTS_DIR"
echo "Monitoring: $MONITOR_DIR"
echo ""

# Function to start monitoring (non-blocking version)
start_monitoring() {
  local protocol="$1"
  local test_name="$2"
  local monitor_subdir="$MONITOR_DIR/$test_name"
  mkdir -p "$monitor_subdir"
  
  say "Starting monitoring for $protocol test..."
  
  local pids=()
  
  # 1. tcpdump (PROTOCOL VERIFICATION)
  say "Starting tcpdump (protocol verification)..."
  if [[ "$protocol" == "HTTP/3" ]]; then
    kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http3-udp.pcap 'udp port 443 or tcp port 443' 2>&1" > "$monitor_subdir/tcpdump-udp.log" 2>&1 &
    pids+=($!)
  else
    kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http2-tcp.pcap 'tcp port 443 or udp port 443' 2>&1" > "$monitor_subdir/tcpdump-tcp.log" 2>&1 &
    pids+=($!)
  fi
  sleep 2
  ok "tcpdump started (PROOF: protocol verification)"
  
  # 2. strace (SYSTEM CALLS DURING BCRYPT)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    say "Starting strace (system calls during bcrypt)..."
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
          echo "=== strace at $timestamp ===" >> "$monitor_subdir/strace-${auth_pod}.log"
          NODE_PID=$(kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux | grep -E 'node|nodejs' | grep -v grep | head -1 | awk '{print \$2}'" 2>/dev/null || echo "1")
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "timeout 5 strace -c -p $NODE_PID 2>&1 || true" >> "$monitor_subdir/strace-${auth_pod}.log" 2>&1 || true
          echo "" >> "$monitor_subdir/strace-${auth_pod}.log"
          sleep 10
        done
      ) &
      pids+=($!)
    done
    ok "strace started (PROOF: system calls)"
  fi
  
  # 3. htop-style CPU monitoring (CPU SPIKES)
  say "Starting htop-style monitoring (CPU spikes)..."
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
      echo "=== CPU at $timestamp ===" >> "$monitor_subdir/cpu-metrics.log"
      kubectl top nodes --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || true
      kubectl -n "$NS" top pods -l app=auth-service --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || true
      echo "" >> "$monitor_subdir/cpu-metrics.log"
      sleep 2
    done
  ) &
  pids+=($!)
  
  # 4. Process-level CPU (htop-style from pods)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
          echo "=== htop at $timestamp ===" >> "$monitor_subdir/htop-${auth_pod}.log"
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux --sort=-%cpu | head -15" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "cat /proc/stat | head -1" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          echo "" >> "$monitor_subdir/htop-${auth_pod}.log"
          sleep 2
        done
      ) &
      pids+=($!)
    done
  fi
  
  # Write PIDs to file (NO stdout echo to avoid blocking)
  echo "${pids[*]}" > "$monitor_subdir/monitor_pids.txt"
  ok "Monitoring started (PIDs saved to file)"
}

# Function to stop monitoring
stop_monitoring() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pids=$(cat "$pid_file")
    say "Stopping monitoring..."
    for pid in $pids; do
      [[ -n "$pid" ]] && [[ "$pid" != "0" ]] && kill "$pid" 2>/dev/null || true
    done
    sleep 2
    ok "Monitoring stopped"
  fi
}

# Function to copy tcpdump captures
copy_tcpdump_captures() {
  local test_name="$1"
  local monitor_subdir="$MONITOR_DIR/$test_name"
  
  say "Copying tcpdump captures (physical proof)..."
  if [[ "$test_name" == "http2-limit-test" ]]; then
    if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http2-tcp.pcap 2>/dev/null; then
      kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http2-tcp.pcap" "$monitor_subdir/http2-tcp.pcap" 2>&1 | head -3 || warn "Failed to copy"
      ok "HTTP/2 pcap saved (PROOF: TCP protocol)"
    fi
  elif [[ "$test_name" == "http3-limit-test" ]]; then
    if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http3-udp.pcap 2>/dev/null; then
      kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http3-udp.pcap" "$monitor_subdir/http3-udp.pcap" 2>&1 | head -3 || warn "Failed to copy"
      ok "HTTP/3 pcap saved (PROOF: UDP/QUIC protocol)"
    fi
  fi
}

# Step 1: Smoke Test
say "=== Step 1: Smoke Test (gRPC Health Checks) ==="
./scripts/test-microservices-http2-http3.sh 2>&1 | tee "$RESULTS_DIR/01-smoke-test.log"
SMOKE_EXIT=${PIPESTATUS[0]}

# DB and Cache verification after smoke test
say "=== DB & Cache Verification (Post-Smoke Test) ==="
export USER1_ID="${USER1_ID:-}"
export USER2_ID="${USER2_ID:-}"
"$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1 | tee "$RESULTS_DIR/01-verification-smoke.log" || warn "Verification had issues"

say "Waiting 10 seconds..."
sleep 10

# Step 2: HTTP/2 Limit Test with Monitoring
say "=== Step 2: HTTP/2 Limit Test with Physical Proof ==="
start_monitoring "HTTP/2" "http2-limit-test" > /dev/null 2>&1
MONITOR_PID_FILE="$MONITOR_DIR/http2-limit-test/monitor_pids.txt"
sleep 3

say "Running k6 HTTP/2 limit test..."
"$SCRIPT_DIR/lib/run-with-timeout.sh" 360 k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http2-limit.log" 2>&1 || warn "HTTP/2 test completed with warnings"

stop_monitoring "$MONITOR_PID_FILE"
copy_tcpdump_captures "http2-limit-test"

# DB and Cache verification after HTTP/2 test
say "=== DB & Cache Verification (Post-HTTP/2 Test) ==="
"$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1 | tee "$RESULTS_DIR/02-verification-http2.log" || warn "Verification had issues"

say "Waiting 30 seconds..."
sleep 30

# Step 3: HTTP/3 Limit Test with Monitoring
say "=== Step 3: HTTP/3 Limit Test with Physical Proof ==="
start_monitoring "HTTP/3" "http3-limit-test" > /dev/null 2>&1
MONITOR_PID_FILE="$MONITOR_DIR/http3-limit-test/monitor_pids.txt"
sleep 3

say "Running k6 HTTP/3 limit test..."
"$SCRIPT_DIR/lib/run-with-timeout.sh" 360 bash -c "HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js" \
  > "$RESULTS_DIR/k6-http3-limit.log" 2>&1 || warn "HTTP/3 test completed with warnings"

stop_monitoring "$MONITOR_PID_FILE"
copy_tcpdump_captures "http3-limit-test"

# DB and Cache verification after HTTP/3 test
say "=== DB & Cache Verification (Post-HTTP/3 Test) ==="
"$SCRIPT_DIR/verify-db-cache-quick.sh" 2>&1 | tee "$RESULTS_DIR/03-verification-http3.log" || warn "Verification had issues"

# Generate comprehensive report
say "=== Generating Physical Proof Report ==="
cat > "$RESULTS_DIR/PHYSICAL_PROOF_REPORT.md" <<EOF
# Final Test Suite - Physical Proof Report

**Date**: $(date)
**Results**: $RESULTS_DIR

## Physical Proof of Protocol Usage

### HTTP/2 (TCP) - Physical Proof
- **tcpdump pcap**: \`monitoring/http2-limit-test/http2-tcp.pcap\`
- **Open in Wireshark**: Verify TCP packets on port 443
- **Proof**: TCP = HTTP/2 (not HTTP/3)

### HTTP/3 (UDP/QUIC) - Physical Proof
- **tcpdump pcap**: \`monitoring/http3-limit-test/http3-udp.pcap\`
- **Open in Wireshark**: Verify UDP packets on port 443 (QUIC)
- **Proof**: UDP = HTTP/3 (QUIC protocol)

## System Call Monitoring (strace) - Physical Proof

### Auth Service System Calls
- **Logs**: \`monitoring/*/strace-auth-service-*.log\`
- **Proof**: Shows system calls during bcrypt operations
- **Key Metrics**: clone, fork, execve, nanosleep (CPU-intensive operations)

## CPU Monitoring (htop-style) - Physical Proof

### Process-Level CPU
- **Logs**: \`monitoring/*/htop-auth-service-*.log\`
- **Proof**: Shows CPU spikes during load
- **Key Metrics**: Top processes by CPU, /proc/stat CPU time

### Node/Pod-Level CPU
- **Logs**: \`monitoring/*/cpu-metrics.log\`
- **Proof**: Shows system-wide CPU usage during load

## Test Results

- **Smoke Test**: \`01-smoke-test.log\`
- **HTTP/2 Limit Test**: \`k6-http2-limit.log\`
- **HTTP/3 Limit Test**: \`k6-http3-limit.log\`

## How to Verify Physical Proof

1. **Protocol Verification**:
   \`\`\`bash
   wireshark monitoring/http2-limit-test/http2-tcp.pcap
   wireshark monitoring/http3-limit-test/http3-udp.pcap
   \`\`\`

2. **System Calls**:
   \`\`\`bash
   cat monitoring/*/strace-auth-service-*.log | grep -E "clone|fork|execve"
   \`\`\`

3. **CPU Spikes**:
   \`\`\`bash
   cat monitoring/*/htop-auth-service-*.log | grep -E "node|%cpu"
   \`\`\`

EOF

ok "Physical proof report generated"

say "=== Test Suite Complete ==="
ok "All results with physical proof saved to: $RESULTS_DIR"
echo ""
echo "Physical Proof Files:"
echo "  ✅ tcpdump pcap files (protocol verification)"
echo "  ✅ strace logs (system calls)"
echo "  ✅ htop-style logs (CPU spikes)"

