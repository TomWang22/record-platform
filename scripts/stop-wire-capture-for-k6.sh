#!/usr/bin/env bash
set -euo pipefail

### Stop Wire-Level Packet Capture and Collect Captures

CAPTURE_DIR="${1:-${CAPTURE_DIR:-/tmp/k6-wire-capture-*}}"
NS_ING="ingress-nginx"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✔ $*"; }
warn() { echo "  ⚠️  $*"; }

# Find most recent capture directory if glob pattern
if [[ "$CAPTURE_DIR" == *"*"* ]]; then
  CAPTURE_DIR=$(ls -td $CAPTURE_DIR 2>/dev/null | head -1 || echo "")
fi

if [[ -z "$CAPTURE_DIR" ]] || [[ ! -d "$CAPTURE_DIR" ]]; then
  fail "Capture directory not found: $CAPTURE_DIR"
fi

PID_FILE="$CAPTURE_DIR/.capture_pids"

say "=== Stopping Wire-Level Packet Capture ==="
ok "Capture directory: $CAPTURE_DIR"

# Stop all capture processes
if [[ -f "$PID_FILE" ]]; then
  while IFS='=' read -r name pid; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      ok "Stopped $name (PID: $pid)"
    fi
  done < "$PID_FILE"
  sleep 2
  
  # Force kill if still running
  while IFS='=' read -r name pid; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
      warn "Force-killed $name (PID: $pid)"
    fi
  done < "$PID_FILE"
fi

# Collect captures from pods
say "Collecting packet captures from pods…"

# Get Caddy pods
CADDY_PODS=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
for pod in $CADDY_PODS; do
  if kubectl -n "$NS_ING" exec "$pod" -- test -f "/tmp/k6-caddy-${pod}.pcap" 2>/dev/null; then
    kubectl -n "$NS_ING" exec "$pod" -- sh -c "cat /tmp/k6-caddy-${pod}.pcap" > \
      "$CAPTURE_DIR/caddy-${pod}.pcap" 2>/dev/null || true
    if [[ -f "$CAPTURE_DIR/caddy-${pod}.pcap" ]] && [[ -s "$CAPTURE_DIR/caddy-${pod}.pcap" ]]; then
      ok "Collected Caddy capture: caddy-${pod}.pcap ($(du -h "$CAPTURE_DIR/caddy-${pod}.pcap" | cut -f1))"
    fi
  fi
done

# Get Envoy pod
ENVOY_POD=$(kubectl -n "$NS_ING" get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ENVOY_NS="$NS_ING"
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ENVOY_NS="envoy-test"
fi

if [[ -n "$ENVOY_POD" ]] && [[ -n "$ENVOY_NS" ]]; then
  if kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- test -f "/tmp/k6-envoy-${ENVOY_POD}.pcap" 2>/dev/null; then
    kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c "cat /tmp/k6-envoy-${ENVOY_POD}.pcap" > \
      "$CAPTURE_DIR/envoy-${ENVOY_POD}.pcap" 2>/dev/null || true
    if [[ -f "$CAPTURE_DIR/envoy-${ENVOY_POD}.pcap" ]] && [[ -s "$CAPTURE_DIR/envoy-${ENVOY_POD}.pcap" ]]; then
      ok "Collected Envoy capture: envoy-${ENVOY_POD}.pcap ($(du -h "$CAPTURE_DIR/envoy-${ENVOY_POD}.pcap" | cut -f1))"
    fi
  fi
fi

# Verify protocols in captures
if command -v tshark >/dev/null 2>&1; then
  say "Verifying protocols at wire level…"
  
  for pcap in "$CAPTURE_DIR"/*.pcap; do
    if [[ -f "$pcap" ]] && [[ -s "$pcap" ]]; then
      service=$(basename "$pcap" .pcap)
      say "Analyzing $service…"
      
      # Verify HTTP/2
      HTTP2_COUNT=$(tshark -r "$pcap" -Y "http2" 2>/dev/null | wc -l 2>/dev/null || echo "0")
      HTTP2_COUNT=$(echo "$HTTP2_COUNT" | tr -d '[:space:]')
      if [[ -n "$HTTP2_COUNT" ]] && [[ "$HTTP2_COUNT" =~ ^[0-9]+$ ]] && [[ "$HTTP2_COUNT" -gt 0 ]]; then
        ok "$service: HTTP/2 verified ($HTTP2_COUNT packets)"
      fi
      
      # Verify HTTP/3 (QUIC)
      QUIC_COUNT=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null || echo "0")
      QUIC_COUNT=$(echo "$QUIC_COUNT" | tr -d '[:space:]')
      if [[ -n "$QUIC_COUNT" ]] && [[ "$QUIC_COUNT" =~ ^[0-9]+$ ]] && [[ "$QUIC_COUNT" -gt 0 ]]; then
        ok "$service: HTTP/3 (QUIC) verified ($QUIC_COUNT packets)"
        
        # Verify QUIC handshake
        QUIC_HANDSHAKE=$(tshark -r "$pcap" -Y "quic.long.packet_type == 1" 2>/dev/null | wc -l 2>/dev/null || echo "0")
        QUIC_HANDSHAKE=$(echo "$QUIC_HANDSHAKE" | tr -d '[:space:]')
        if [[ -n "$QUIC_HANDSHAKE" ]] && [[ "$QUIC_HANDSHAKE" =~ ^[0-9]+$ ]] && [[ "$QUIC_HANDSHAKE" -gt 0 ]]; then
          ok "$service: QUIC handshake verified ($QUIC_HANDSHAKE packets)"
        fi
      fi
      
      # Verify TLS 1.3
      TLS13_COUNT=$(tshark -r "$pcap" -Y "tls.version == 0x0304" 2>/dev/null | wc -l 2>/dev/null || echo "0")
      TLS13_COUNT=$(echo "$TLS13_COUNT" | tr -d '[:space:]')
      if [[ -n "$TLS13_COUNT" ]] && [[ "$TLS13_COUNT" =~ ^[0-9]+$ ]] && [[ "$TLS13_COUNT" -gt 0 ]]; then
        ok "$service: TLS 1.3 verified ($TLS13_COUNT packets)"
      fi
      
      # Verify gRPC (HTTP/2 with specific headers)
      GRPC_COUNT=$(tshark -r "$pcap" -Y "http2.header.value contains \"application/grpc\"" 2>/dev/null | wc -l 2>/dev/null || echo "0")
      GRPC_COUNT=$(echo "$GRPC_COUNT" | tr -d '[:space:]')
      if [[ -n "$GRPC_COUNT" ]] && [[ "$GRPC_COUNT" =~ ^[0-9]+$ ]] && [[ "$GRPC_COUNT" -gt 0 ]]; then
        ok "$service: gRPC verified ($GRPC_COUNT packets)"
      fi
    fi
  done
else
  warn "tshark not available - skipping protocol verification"
  warn "Install with: brew install wireshark (macOS) or apt-get install tshark (Linux)"
fi

say "=== Wire-Level Packet Capture Complete ==="
ok "Captures saved to: $CAPTURE_DIR"
ok "Analyze with: tshark -r $CAPTURE_DIR/*.pcap -Y \"quic or http2\""
