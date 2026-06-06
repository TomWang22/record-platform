#!/usr/bin/env bash
set -euo pipefail

# System monitoring during k6 tests
# Captures: tcpdump, htop, strace, pod metrics, system metrics

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="${1:-$(date +%Y%m%d-%H%M%S)}"
MONITOR_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-monitoring"
mkdir -p "$MONITOR_DIR"

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kind-h3.yaml}"

say "=== Starting System Monitoring ==="
echo "Monitoring directory: $MONITOR_DIR"

# Get Caddy pod for tcpdump
CADDY_POD=$(kubectl -n ingress-nginx get pod -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$CADDY_POD" ]]; then
  warn "Caddy pod not found, skipping tcpdump"
else
  ok "Found Caddy pod: $CADDY_POD"
fi

# Start tcpdump on Caddy pod (capture HTTP/2 and HTTP/3 traffic)
if [[ -n "$CADDY_POD" ]]; then
  say "Starting tcpdump on Caddy pod..."
  kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/caddy-traffic.pcap 'tcp port 443 or udp port 443' 2>&1" > "$MONITOR_DIR/tcpdump.log" 2>&1 &
  TCPDUMP_PID=$!
  echo "$TCPDUMP_PID" > "$MONITOR_DIR/tcpdump.pid"
  sleep 2
  ok "tcpdump started (PID: $TCPDUMP_PID)"
fi

# Start pod metrics collection
say "Starting pod metrics collection..."
(
  while true; do
    timestamp=$(date +%Y%m%d-%H%M%S)
    
    # Get all pod metrics
    kubectl top pods -A --no-headers > "$MONITOR_DIR/pod-metrics-${timestamp}.txt" 2>&1 || true
    
    # Get node metrics
    kubectl top nodes --no-headers > "$MONITOR_DIR/node-metrics-${timestamp}.txt" 2>&1 || true
    
    # Get pod status
    kubectl get pods -A -o wide > "$MONITOR_DIR/pod-status-${timestamp}.txt" 2>&1 || true
    
    sleep 10
  done
) &
METRICS_PID=$!
echo "$METRICS_PID" > "$MONITOR_DIR/metrics.pid"
ok "Pod metrics collection started (PID: $METRICS_PID)"

# Start service-specific monitoring
say "Starting service-specific monitoring..."

# Monitor auth-service pods
AUTH_PODS=$(kubectl get pods -n default -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$AUTH_PODS" ]]; then
  for pod in $AUTH_PODS; do
    (
      kubectl -n default exec "$pod" -- sh -c "while true; do ps aux | head -20; sleep 5; done" > "$MONITOR_DIR/auth-${pod}-processes.log" 2>&1 &
      echo $! >> "$MONITOR_DIR/monitor-pids.txt"
    ) || true
  done
  ok "Monitoring auth-service pods"
fi

# Monitor webapp pods
WEBAPP_PODS=$(kubectl get pods -n default -l app=webapp -o jsonpath='{.items[*].metadata.name}' 2>&1 || echo "")
if [[ -n "$WEBAPP_PODS" ]]; then
  for pod in $WEBAPP_PODS; do
    (
      kubectl -n default exec "$pod" -- sh -c "while true; do ps aux | head -20; done" > "$MONITOR_DIR/webapp-${pod}-processes.log" 2>&1 &
      echo $! >> "$MONITOR_DIR/monitor-pids.txt"
    ) || true
  done
  ok "Monitoring webapp pods"
fi

# System resource monitoring (if htop/strace available in Kind nodes)
say "Starting system resource monitoring..."

# Function to stop all monitoring
stop_monitoring() {
  say "Stopping monitoring..."
  
  # Stop tcpdump
  if [[ -f "$MONITOR_DIR/tcpdump.pid" ]]; then
    TCPDUMP_PID=$(cat "$MONITOR_DIR/tcpdump.pid")
    kill "$TCPDUMP_PID" 2>/dev/null || true
    sleep 2
    
    # Copy pcap file from Caddy pod
    if [[ -n "$CADDY_POD" ]]; then
      kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "ls -lh /tmp/caddy-traffic.pcap" > "$MONITOR_DIR/tcpdump-info.txt" 2>&1 || true
      kubectl -n ingress-nginx cp "${CADDY_POD}:/tmp/caddy-traffic.pcap" "$MONITOR_DIR/caddy-traffic.pcap" 2>&1 || warn "Failed to copy pcap file"
      kubectl -n ingress-nginx exec "$CADDY_POD" -- rm -f /tmp/caddy-traffic.pcap 2>/dev/null || true
    fi
  fi
  
  # Stop metrics collection
  if [[ -f "$MONITOR_DIR/metrics.pid" ]]; then
    METRICS_PID=$(cat "$MONITOR_DIR/metrics.pid")
    kill "$METRICS_PID" 2>/dev/null || true
  fi
  
  # Stop other monitors
  if [[ -f "$MONITOR_DIR/monitor-pids.txt" ]]; then
    while read pid; do
      kill "$pid" 2>/dev/null || true
    done < "$MONITOR_DIR/monitor-pids.txt"
  fi
  
  ok "Monitoring stopped"
}

# Export stop function
export -f stop_monitoring

# Create summary
cat > "$MONITOR_DIR/monitoring-info.txt" <<EOF
Monitoring started: $(date)
Timestamp: $TIMESTAMP
Caddy Pod: ${CADDY_POD:-N/A}
TCPDump PID: ${TCPDUMP_PID:-N/A}
Metrics PID: ${METRICS_PID:-N/A}
EOF

ok "Monitoring active. Use 'stop_monitoring' function or Ctrl+C to stop."
ok "Monitoring data: $MONITOR_DIR"

# Keep script running
trap stop_monitoring EXIT
wait

