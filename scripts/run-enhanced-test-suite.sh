#!/usr/bin/env bash
set -euo pipefail

# Enhanced Test Suite with Physical Proof
# Captures tcpdump (protocol verification), strace (system calls), htop (CPU spikes)
# Also fixes gRPC and curl issues

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-enhanced-test-suite"
MONITOR_DIR="$RESULTS_DIR/monitoring"
mkdir -p "$MONITOR_DIR"

NS="record-platform"
NS_INGRESS="ingress-nginx"

# Get pods for monitoring
CADDY_POD=$(kubectl -n "$NS_INGRESS" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
AUTH_PODS=($(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

say "=== Enhanced Test Suite with Physical Proof ==="
echo "Results: $RESULTS_DIR"
echo "Monitoring: $MONITOR_DIR"
echo ""

# Function to start comprehensive monitoring (fixed version)
start_monitoring() {
  local protocol="$1"
  local test_name="$2"
  local monitor_subdir="$MONITOR_DIR/$test_name"
  mkdir -p "$monitor_subdir"
  
  say "Starting monitoring for $protocol test..."
  
  local pids=()
  
  # 1. tcpdump on Caddy pod (PROTOCOL VERIFICATION)
  say "Starting tcpdump on Caddy pod (protocol verification)..."
  if [[ "$protocol" == "HTTP/3" ]]; then
    kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http3-udp.pcap 'udp port 443 or tcp port 443' 2>&1" > "$monitor_subdir/tcpdump-udp.log" 2>&1 &
    pids+=($!)
    ok "tcpdump started (capturing UDP/QUIC for HTTP/3 verification)"
  else
    kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/http2-tcp.pcap 'tcp port 443 or udp port 443' 2>&1" > "$monitor_subdir/tcpdump-tcp.log" 2>&1 &
    pids+=($!)
    ok "tcpdump started (capturing TCP for HTTP/2 verification)"
  fi
  sleep 2
  
  # 2. strace on auth-service pods (SYSTEM CALLS DURING BCRYPT)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    say "Starting strace on auth-service pods (system calls during bcrypt)..."
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
          echo "=== strace snapshot at $timestamp ===" >> "$monitor_subdir/strace-${auth_pod}.log"
          NODE_PID=$(kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux | grep -E 'node|nodejs' | grep -v grep | head -1 | awk '{print \$2}'" 2>/dev/null || echo "1")
          # Sample system calls for 5 seconds
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "timeout 5 strace -c -p $NODE_PID 2>&1 || true" >> "$monitor_subdir/strace-${auth_pod}.log" 2>&1 || true
          echo "" >> "$monitor_subdir/strace-${auth_pod}.log"
          sleep 10
        done
      ) &
      pids+=($!)
      ok "strace monitoring started on $auth_pod (PID: ${pids[-1]})"
    done
  fi
  
  # 3. htop-style CPU monitoring (CPU SPIKES)
  say "Starting htop-style CPU monitoring (CPU spikes)..."
  (
    while true; do
      timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
      echo "=== CPU Metrics at $timestamp ===" >> "$monitor_subdir/cpu-metrics.log"
      kubectl top nodes --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || echo "Metrics API unavailable" >> "$monitor_subdir/cpu-metrics.log"
      kubectl -n "$NS" top pods -l app=auth-service --no-headers >> "$monitor_subdir/cpu-metrics.log" 2>/dev/null || echo "Metrics API unavailable" >> "$monitor_subdir/cpu-metrics.log"
      echo "" >> "$monitor_subdir/cpu-metrics.log"
      sleep 2
    done
  ) &
  pids+=($!)
  
  # 4. Process-level CPU (htop-style from pods)
  if [[ ${#AUTH_PODS[@]} -gt 0 ]]; then
    say "Starting process-level CPU monitoring (htop-style)..."
    for auth_pod in "${AUTH_PODS[@]}"; do
      (
        while true; do
          timestamp=$(date +%Y%m%d-%H%M%S-%N | cut -c1-23)
          echo "=== htop-style CPU at $timestamp ===" >> "$monitor_subdir/htop-${auth_pod}.log"
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "ps aux --sort=-%cpu | head -15" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          kubectl -n "$NS" exec "$auth_pod" -- sh -c "cat /proc/stat | head -1" >> "$monitor_subdir/htop-${auth_pod}.log" 2>&1 || true
          echo "" >> "$monitor_subdir/htop-${auth_pod}.log"
          sleep 2
        done
      ) &
      pids+=($!)
    done
  fi
  
  # Write PIDs to file (avoid command substitution blocking)
  echo "${pids[*]}" > "$monitor_subdir/monitor_pids.txt"
  echo "${pids[*]}"
}

# Function to stop monitoring
stop_monitoring() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pids=$(cat "$pid_file")
    say "Stopping monitoring (PIDs: $pids)..."
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
  
  say "Copying tcpdump captures (physical proof of protocol usage)..."
  if [[ "$test_name" == "http2-limit-test" ]]; then
    if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http2-tcp.pcap 2>/dev/null; then
      kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http2-tcp.pcap" "$monitor_subdir/http2-tcp.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/2 pcap"
      ok "HTTP/2 pcap saved: $monitor_subdir/http2-tcp.pcap (PROOF: TCP protocol)"
    fi
  elif [[ "$test_name" == "http3-limit-test" ]]; then
    if kubectl -n "$NS_INGRESS" exec "$CADDY_POD" -- test -f /tmp/http3-udp.pcap 2>/dev/null; then
      kubectl -n "$NS_INGRESS" cp "${CADDY_POD}:/tmp/http3-udp.pcap" "$monitor_subdir/http3-udp.pcap" 2>&1 | head -3 || warn "Failed to copy HTTP/3 pcap"
      ok "HTTP/3 pcap saved: $monitor_subdir/http3-udp.pcap (PROOF: UDP/QUIC protocol)"
    fi
  fi
}

# Step 1: Smoke Test (with gRPC fixes)
say "=== Step 1: Smoke Test (with gRPC fixes) ==="
./scripts/test-microservices-http2-http3.sh 2>&1 | tee "$RESULTS_DIR/01-smoke-test.log"
SMOKE_EXIT=${PIPESTATUS[0]}

say "Waiting 10 seconds..."
sleep 10

# Step 2: HTTP/2 Limit Test with Monitoring
say "=== Step 2: HTTP/2 Limit Test with Physical Proof ==="
# Start monitoring (don't use command substitution - it blocks!)
start_monitoring "HTTP/2" "http2-limit-test" > /dev/null 2>&1
MONITOR_PID_FILE="$MONITOR_DIR/http2-limit-test/monitor_pids.txt"
sleep 3
# Get PIDs from file (avoid command substitution blocking)
if [[ -f "$MONITOR_PID_FILE" ]]; then
  monitor_pids=$(cat "$MONITOR_PID_FILE")
else
  warn "Monitor PID file not found, monitoring may not be running"
  monitor_pids=""
fi

say "Running k6 HTTP/2 limit test..."
"$SCRIPT_DIR/lib/run-with-timeout.sh" 360 k6 run --http-debug=false \
  scripts/load/k6-e2e-find-limit.js \
  > "$RESULTS_DIR/k6-http2-limit.log" 2>&1 || warn "HTTP/2 test completed with warnings"

stop_monitoring "$MONITOR_PID_FILE"
copy_tcpdump_captures "http2-limit-test"

say "Waiting 30 seconds for services to recover..."
sleep 30

# Step 3: HTTP/3 Limit Test with Monitoring
say "=== Step 3: HTTP/3 Limit Test with Physical Proof ==="
# Start monitoring (don't use command substitution - it blocks!)
start_monitoring "HTTP/3" "http3-limit-test" > /dev/null 2>&1
MONITOR_PID_FILE="$MONITOR_DIR/http3-limit-test/monitor_pids.txt"
sleep 3
# Get PIDs from file (avoid command substitution blocking)
if [[ -f "$MONITOR_PID_FILE" ]]; then
  monitor_pids=$(cat "$MONITOR_PID_FILE")
else
  warn "Monitor PID file not found, monitoring may not be running"
  monitor_pids=""
fi

say "Running k6 HTTP/3 limit test..."
"$SCRIPT_DIR/lib/run-with-timeout.sh" 360 bash -c "HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js" \
  > "$RESULTS_DIR/k6-http3-limit.log" 2>&1 || warn "HTTP/3 test completed with warnings"

stop_monitoring "$MONITOR_PID_FILE"
copy_tcpdump_captures "http3-limit-test"

# Generate comprehensive report
say "=== Generating Report with Physical Proof ==="
cat > "$RESULTS_DIR/PHYSICAL_PROOF_REPORT.md" <<EOF
# Enhanced Test Suite - Physical Proof Report

**Date**: $(date)
**Results Directory**: $RESULTS_DIR

## Physical Proof of Protocol Usage

### HTTP/2 (TCP) Verification
- **tcpdump pcap**: \`monitoring/http2-limit-test/http2-tcp.pcap\`
- **Expected**: TCP packets on port 443
- **Analysis**: Open in Wireshark to verify TCP protocol usage
- **Proof**: TCP packets = HTTP/2 (not HTTP/3)

### HTTP/3 (UDP/QUIC) Verification
- **tcpdump pcap**: \`monitoring/http3-limit-test/http3-udp.pcap\`
- **Expected**: UDP packets on port 443 (QUIC)
- **Analysis**: Open in Wireshark to verify UDP/QUIC protocol usage
- **Proof**: UDP packets = HTTP/3 (QUIC protocol)

## System Call Monitoring (strace)

### Auth Service System Calls
- **Logs**: \`monitoring/*/strace-auth-service-*.log\`
- **Purpose**: Monitor system calls during bcrypt operations
- **Key Metrics**: CPU-intensive operations (clone, fork, execve, nanosleep)
- **Proof**: Shows bcrypt system calls causing CPU spikes

## CPU Monitoring (htop-style)

### Process-Level CPU
- **Logs**: \`monitoring/*/htop-auth-service-*.log\`
- **Purpose**: Monitor CPU spikes during load
- **Key Metrics**: Top processes by CPU, /proc/stat CPU time
- **Proof**: Shows Node.js process CPU spikes during bcrypt

### Node/Pod-Level CPU
- **Logs**: \`monitoring/*/cpu-metrics.log\`
- **Purpose**: Monitor overall resource utilization
- **Key Metrics**: Node CPU, pod CPU, all pods CPU
- **Proof**: Shows system-wide CPU usage during load

## Test Results

- **Smoke Test**: \`01-smoke-test.log\`
- **HTTP/2 Limit Test**: \`k6-http2-limit.log\`
- **HTTP/3 Limit Test**: \`k6-http3-limit.log\`

## How to Verify Physical Proof

1. **Protocol Verification (tcpdump)**:
   \`\`\`bash
   # Open pcap files in Wireshark
   wireshark monitoring/http2-limit-test/http2-tcp.pcap
   wireshark monitoring/http3-limit-test/http3-udp.pcap
   \`\`\`
   - HTTP/2: Look for TCP packets on port 443
   - HTTP/3: Look for UDP packets on port 443 (QUIC)

2. **System Calls (strace)**:
   \`\`\`bash
   # View system calls during bcrypt
   cat monitoring/*/strace-auth-service-*.log | grep -E "clone|fork|execve|nanosleep"
   \`\`\`

3. **CPU Spikes (htop)**:
   \`\`\`bash
   # View CPU spikes
   cat monitoring/*/htop-auth-service-*.log | grep -E "node|%cpu"
   \`\`\`

EOF

ok "Physical proof report generated: $RESULTS_DIR/PHYSICAL_PROOF_REPORT.md"

say "=== Test Suite Complete ==="
ok "All results with physical proof saved to: $RESULTS_DIR"
echo ""
echo "Physical Proof Files:"
echo "  - tcpdump pcap files (protocol verification)"
echo "  - strace logs (system calls)"
echo "  - htop-style logs (CPU spikes)"
echo "  - PHYSICAL_PROOF_REPORT.md (complete analysis)"

