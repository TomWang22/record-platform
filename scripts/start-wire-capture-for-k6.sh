#!/usr/bin/env bash
set -euo pipefail

### Wire-Level Packet Capture for k6 Load Tests
### This script starts packet capture on Caddy and Envoy pods during k6 tests
### to verify protocols (HTTP/2, HTTP/3/QUIC, gRPC, TLS 1.3) at wire level

NS_ING="ingress-nginx"
NS_APP="record-platform"
CAPTURE_DIR="${CAPTURE_DIR:-/tmp/k6-wire-capture-$(date +%s)}"
TIMEOUT="${CAPTURE_TIMEOUT:-600}"  # Default 10 minutes

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✔ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ✘ $*" >&2; exit 1; }

# Cleanup function
cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    say "Cleaning up packet captures…"
    while IFS='=' read -r name pid; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}

trap cleanup EXIT INT TERM

# Create capture directory
mkdir -p "$CAPTURE_DIR"

# PID file for cleanup
PID_FILE="$CAPTURE_DIR/.capture_pids"

say "=== Starting Wire-Level Packet Capture for k6 ==="
ok "Capture directory: $CAPTURE_DIR"
ok "Timeout: ${TIMEOUT}s"

# Get Caddy pods
CADDY_PODS=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$CADDY_PODS" ]]; then
  warn "No Caddy pods found in namespace $NS_ING"
else
  say "Starting Caddy packet capture (HTTP/2, HTTP/3/QUIC)…"
  for pod in $CADDY_PODS; do
    ok "Installing tcpdump in pod $pod…"
    kubectl -n "$NS_ING" exec "$pod" -- sh -c \
      "apk add --no-cache tcpdump 2>/dev/null || (apt-get update && apt-get install -y tcpdump 2>/dev/null) || true" \
      >/dev/null 2>&1 || true
    
    if kubectl -n "$NS_ING" exec "$pod" -- which tcpdump >/dev/null 2>&1; then
      # Capture HTTP/2 (TCP 443), HTTP/3/QUIC (UDP 443), and NodePort (30443)
      kubectl -n "$NS_ING" exec "$pod" -- sh -c \
        "timeout ${TIMEOUT} tcpdump -i any -U -s 65535 -w /tmp/k6-caddy-${pod}.pcap 'port 443 or port 30443 or udp port 443' 2>&1" \
        > "$CAPTURE_DIR/caddy-${pod}-capture.log" 2>&1 &
      CADDY_PID=$!
      echo "CADDY_${pod}=${CADDY_PID}" >> "$PID_FILE"
      ok "Caddy packet capture started for $pod (PID: $CADDY_PID)"
    else
      warn "tcpdump not available in pod $pod"
    fi
  done
fi

# Get Envoy pods (check both namespaces)
ENVOY_POD=$(kubectl -n "$NS_ING" get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ENVOY_NS="$NS_ING"
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ENVOY_NS="envoy-test"
fi

if [[ -n "$ENVOY_POD" ]] && [[ -n "$ENVOY_NS" ]]; then
  say "Starting Envoy packet capture (gRPC/HTTP/2)…"
  ok "Installing tcpdump in pod $ENVOY_POD…"
  kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c \
    "apk add --no-cache tcpdump 2>/dev/null || (apt-get update && apt-get install -y tcpdump 2>/dev/null) || true" \
    >/dev/null 2>&1 || true
  
  if kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- which tcpdump >/dev/null 2>&1; then
    # Capture gRPC (port 10000), NodePort (30000/30001), and gRPC service ports (50051-50060)
    kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c \
      "timeout ${TIMEOUT} tcpdump -i any -U -s 65535 -w /tmp/k6-envoy-${ENVOY_POD}.pcap 'port 10000 or port 30000 or port 30001 or (port >= 50051 and port <= 50060)' 2>&1" \
      > "$CAPTURE_DIR/envoy-${ENVOY_POD}-capture.log" 2>&1 &
    ENVOY_PID=$!
    echo "ENVOY=${ENVOY_PID}" >> "$PID_FILE"
    ok "Envoy packet capture started (PID: $ENVOY_PID)"
  else
    warn "tcpdump not available in pod $ENVOY_POD"
  fi
else
  warn "No Envoy pods found"
fi

# Wait a moment for captures to start
sleep 2

say "=== Wire-Level Packet Capture Started ==="
ok "All captures running (will auto-stop after ${TIMEOUT}s or when stopped manually)"
ok "Use stop-wire-capture-for-k6.sh to stop and collect captures"
ok "Or wait for timeout (${TIMEOUT}s)"

echo "$CAPTURE_DIR"
