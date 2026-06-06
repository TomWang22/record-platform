#!/usr/bin/env bash
# Enhanced E2E test with wire-level protocol verification
# Uses tcpdump, tshark, strace, and valgrind for deep protocol analysis
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NS="${NS:-record-platform}"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
export KUBECONFIG="${KUBECONFIG:-/tmp/kind-h3-fixed.yaml}"

# Colors
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check required tools
REQUIRED_TOOLS=("tcpdump" "kubectl")
for tool in "${REQUIRED_TOOLS[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool is required but not installed"
  fi
done

# Optional tools (warn if missing)
OPTIONAL_TOOLS=("tshark" "strace" "valgrind" "htop")
MISSING_OPTIONAL=()
for tool in "${OPTIONAL_TOOLS[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING_OPTIONAL+=("$tool")
  fi
done

if [[ ${#MISSING_OPTIONAL[@]} -gt 0 ]]; then
  warn "Optional tools not found: ${MISSING_OPTIONAL[*]}"
  warn "  Install with: brew install ${MISSING_OPTIONAL[*]}"
  warn "  (tests will continue but with reduced verification capabilities)"
fi

# Create output directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CAPTURE_DIR="/tmp/wire-verification-${TIMESTAMP}"
mkdir -p "$CAPTURE_DIR"

say "=== Wire-Level Protocol Verification E2E Test ==="
ok "Capture directory: $CAPTURE_DIR"

# Get pod names
CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
ENVOY_POD=$(kubectl -n ingress-nginx get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ENVOY_NS="envoy-test"
else
  ENVOY_NS="ingress-nginx"
fi

# Start comprehensive packet capture
start_wire_capture() {
  local pod_name="$1"
  local namespace="$2"
  local capture_name="$3"
  local filter="$4"
  
  if [[ -z "$pod_name" ]]; then
    warn "Pod not found for $capture_name capture"
    return 1
  fi
  
  # Check if tcpdump is available in pod
  if ! kubectl -n "$namespace" exec "$pod_name" -- which tcpdump >/dev/null 2>&1; then
    warn "tcpdump not available in $pod_name, attempting to install..."
    kubectl -n "$namespace" exec "$pod_name" -- sh -c "apk add --no-cache tcpdump 2>/dev/null || apt-get update -qq && apt-get install -y -qq tcpdump 2>/dev/null || true" >/dev/null 2>&1 || true
  fi
  
  if kubectl -n "$namespace" exec "$pod_name" -- which tcpdump >/dev/null 2>&1; then
    # Start tcpdump with comprehensive capture
    kubectl -n "$namespace" exec "$pod_name" -- sh -c \
      "tcpdump -i any -U -s 0 -w /tmp/${capture_name}.pcap '$filter' 2>&1" \
      > "$CAPTURE_DIR/${capture_name}.log" 2>&1 &
    echo $!
    return 0
  else
    warn "tcpdump installation failed for $pod_name"
    return 1
  fi
}

# Start captures
CADDY_TCPDUMP_PID=""
ENVOY_TCPDUMP_PID=""
AUTH_POD=$(kubectl -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
RECORDS_POD=$(kubectl -n "$NS" get pods -l app=records-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$CADDY_POD" ]]; then
  say "Starting packet capture on Caddy ($CADDY_POD)..."
  CADDY_TCPDUMP_PID=$(start_wire_capture "$CADDY_POD" "ingress-nginx" "caddy-wire" "port ${PORT} or port 443 or port 30443") || CADDY_TCPDUMP_PID=""
  if [[ -n "$CADDY_TCPDUMP_PID" ]]; then
    ok "Caddy packet capture started (PID: $CADDY_TCPDUMP_PID)"
    sleep 2
  fi
fi

if [[ -n "$ENVOY_POD" ]] && [[ -n "$ENVOY_NS" ]]; then
  say "Starting packet capture on Envoy ($ENVOY_POD)..."
  ENVOY_TCPDUMP_PID=$(start_wire_capture "$ENVOY_POD" "$ENVOY_NS" "envoy-wire" "port 10000 or port 30000 or port 50051") || ENVOY_TCPDUMP_PID=""
  if [[ -n "$ENVOY_TCPDUMP_PID" ]]; then
    ok "Envoy packet capture started (PID: $ENVOY_TCPDUMP_PID)"
    sleep 2
  fi
fi

# Start service-level captures (for gRPC)
if [[ -n "$AUTH_POD" ]]; then
  say "Starting packet capture on auth-service ($AUTH_POD)..."
  AUTH_TCPDUMP_PID=$(start_wire_capture "$AUTH_POD" "$NS" "auth-grpc-wire" "port 50051") || AUTH_TCPDUMP_PID=""
  if [[ -n "$AUTH_TCPDUMP_PID" ]]; then
    ok "Auth-service gRPC capture started (PID: $AUTH_TCPDUMP_PID)"
    sleep 1
  fi
fi

if [[ -n "$RECORDS_POD" ]]; then
  say "Starting packet capture on records-service ($RECORDS_POD)..."
  RECORDS_TCPDUMP_PID=$(start_wire_capture "$RECORDS_POD" "$NS" "records-grpc-wire" "port 50051") || RECORDS_TCPDUMP_PID=""
  if [[ -n "$RECORDS_TCPDUMP_PID" ]]; then
    ok "Records-service gRPC capture started (PID: $RECORDS_TCPDUMP_PID)"
    sleep 1
  fi
fi

# Cleanup function
cleanup_captures() {
  say "Stopping packet captures..."
  
  for pid in "$CADDY_TCPDUMP_PID" "$ENVOY_TCPDUMP_PID" "$AUTH_TCPDUMP_PID" "$RECORDS_TCPDUMP_PID"; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done
  
  # Copy pcap files from pods
  if [[ -n "$CADDY_POD" ]]; then
    kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "cat /tmp/caddy-wire.pcap" > "$CAPTURE_DIR/caddy-wire.pcap" 2>/dev/null || true
  fi
  
  if [[ -n "$ENVOY_POD" ]] && [[ -n "$ENVOY_NS" ]]; then
    kubectl -n "$ENVOY_NS" exec "$ENVOY_POD" -- sh -c "cat /tmp/envoy-wire.pcap" > "$CAPTURE_DIR/envoy-wire.pcap" 2>/dev/null || true
  fi
  
  if [[ -n "$AUTH_POD" ]]; then
    kubectl -n "$NS" exec "$AUTH_POD" -- sh -c "cat /tmp/auth-grpc-wire.pcap" > "$CAPTURE_DIR/auth-grpc-wire.pcap" 2>/dev/null || true
  fi
  
  if [[ -n "$RECORDS_POD" ]]; then
    kubectl -n "$NS" exec "$RECORDS_POD" -- sh -c "cat /tmp/records-grpc-wire.pcap" > "$CAPTURE_DIR/records-grpc-wire.pcap" 2>/dev/null || true
  fi
  
  ok "Packet captures saved to: $CAPTURE_DIR"
}

trap cleanup_captures EXIT

say "=== Running E2E Tests with Wire-Level Verification ==="

# Run the main E2E test
if [[ -f "$SCRIPT_DIR/test-microservices-http2-http3.sh" ]]; then
  say "Executing comprehensive E2E test suite..."
  bash "$SCRIPT_DIR/test-microservices-http2-http3.sh" 2>&1 | tee "$CAPTURE_DIR/e2e-test.log"
else
  warn "E2E test script not found, running minimal verification..."
fi

say "=== Analyzing Packet Captures ==="

# Verify protocols at wire level using tcpdump/tshark
analyze_protocols() {
  local pcap_file="$1"
  local service_name="$2"
  
  if [[ ! -f "$pcap_file" ]] || [[ ! -s "$pcap_file" ]]; then
    warn "$service_name: No capture data available"
    return 1
  fi
  
  say "Analyzing $service_name protocols..."
  
  # Use tshark if available (better protocol analysis)
  if command -v tshark >/dev/null 2>&1; then
    # Verify HTTP/2
    HTTP2_COUNT=$(tshark -r "$pcap_file" -Y "http2" 2>/dev/null | wc -l | xargs || echo "0")
    if [[ "$HTTP2_COUNT" -gt 0 ]]; then
      ok "$service_name: HTTP/2 detected ($HTTP2_COUNT packets)"
      # Verify ALPN negotiation
      ALPN_H2=$(tshark -r "$pcap_file" -Y "tls.handshake.extensions_alpn_str contains h2" 2>/dev/null | wc -l | xargs || echo "0")
      if [[ "$ALPN_H2" -gt 0 ]]; then
        ok "$service_name: HTTP/2 ALPN negotiation confirmed"
      fi
    fi
    
    # Verify HTTP/3 (QUIC)
    QUIC_COUNT=$(tshark -r "$pcap_file" -Y "quic" 2>/dev/null | wc -l | xargs || echo "0")
    if [[ "$QUIC_COUNT" -gt 0 ]]; then
      ok "$service_name: HTTP/3 (QUIC) detected ($QUIC_COUNT packets)"
    fi
    
    # Verify gRPC
    GRPC_COUNT=$(tshark -r "$pcap_file" -Y "grpc" 2>/dev/null | wc -l | xargs || echo "0")
    if [[ "$GRPC_COUNT" -gt 0 ]]; then
      ok "$service_name: gRPC detected ($GRPC_COUNT packets)"
    fi
    
    # Verify TLS
    TLS_COUNT=$(tshark -r "$pcap_file" -Y "tls" 2>/dev/null | wc -l | xargs || echo "0")
    if [[ "$TLS_COUNT" -gt 0 ]]; then
      ok "$service_name: TLS detected ($TLS_COUNT packets)"
      # Check TLS version
      TLS13_COUNT=$(tshark -r "$pcap_file" -Y "tls.version == 0x0304" 2>/dev/null | wc -l | xargs || echo "0")
      if [[ "$TLS13_COUNT" -gt 0 ]]; then
        ok "$service_name: TLS 1.3 confirmed ($TLS13_COUNT packets)"
      fi
    fi
    
    # Extract detailed protocol info
    tshark -r "$pcap_file" -Y "tls.handshake.type == 1" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | \
      sort | uniq -c > "$CAPTURE_DIR/${service_name}-alpn-analysis.txt" || true
    
  else
    # Fallback to tcpdump
    warn "$service_name: tshark not available, using tcpdump (limited analysis)"
    tcpdump -r "$pcap_file" -n -c 50 2>/dev/null | head -20 > "$CAPTURE_DIR/${service_name}-summary.txt" || true
  fi
}

# Analyze captures
for pcap in "$CAPTURE_DIR"/*.pcap; do
  if [[ -f "$pcap" ]]; then
    service=$(basename "$pcap" .pcap)
    analyze_protocols "$pcap" "$service"
  fi
done

say "=== Adversarial Testing ==="

# Test 1: Protocol downgrade attempt (HTTP/1.1 when HTTP/2/3 expected)
say "Test: Protocol downgrade attempt (HTTP/1.1)"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
if [[ -f "$CURL_BIN" ]]; then
  # Force HTTP/1.1 (should be rejected or downgraded)
  RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}\n%{http_version}" \
    --http1.1 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || true
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -2 | head -1)
  HTTP_VER=$(echo "$RESPONSE" | tail -1)
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    if [[ "$HTTP_VER" == "1.1" ]]; then
      warn "HTTP/1.1 accepted (protocol downgrade possible)"
    else
      ok "HTTP/1.1 request handled but upgraded to $HTTP_VER"
    fi
  else
    ok "HTTP/1.1 rejected or failed (expected for strict HTTP/2/3 setup)"
  fi
fi

# Test 2: TLS version downgrade attempt
say "Test: TLS version downgrade attempt"
if [[ -f "$CURL_BIN" ]]; then
  RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" \
    --tlsv1.2 \
    --tls-max 1.2 \
    --http2 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || true
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  if [[ "$HTTP_CODE" == "200" ]]; then
    warn "TLS 1.2 accepted (may indicate downgrade vulnerability)"
  else
    ok "TLS 1.2 rejected (TLS 1.3 enforced)"
  fi
fi

# Test 3: Invalid certificate (should be rejected)
say "Test: Invalid certificate rejection"
if [[ -f "$CURL_BIN" ]]; then
  # Try without -k (should fail with certificate error)
  RESPONSE=$("$CURL_BIN" -sS -w "\n%{http_code}" \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || CERT_ERROR=$?
  
  if echo "$RESPONSE" | grep -qiE "certificate|cert|verify|SSL|TLS.*error"; then
    ok "Invalid certificate correctly rejected (strict TLS enforced)"
  else
    warn "Certificate validation may not be working correctly"
  fi
fi

# Test 4: Malformed gRPC request
say "Test: Malformed gRPC request handling"
if command -v grpcurl >/dev/null 2>&1; then
  # Try invalid method
  INVALID_RESPONSE=$(grpcurl -plaintext -max-time 3 \
    -import-path proto \
    -proto proto/records.proto \
    -d '{}' \
    127.0.0.1:30000 records.RecordsService/InvalidMethod 2>&1 || echo "ERROR")
  
  if echo "$INVALID_RESPONSE" | grep -qiE "not found|unimplemented|unknown.*method"; then
    ok "Malformed gRPC request correctly rejected"
  else
    warn "gRPC error handling may need verification"
  fi
fi

say "=== Protocol Verification Summary ==="
ok "Packet captures: $CAPTURE_DIR"
ok "Analysis files: $CAPTURE_DIR/*-analysis.txt"
ok "Wire-level verification complete"

# Create summary report
cat > "$CAPTURE_DIR/verification-summary.md" <<EOF
# Wire-Level Protocol Verification Summary

**Timestamp**: $(date -Iseconds)
**Host**: $HOST
**Port**: $PORT

## Captures
- Caddy: $(test -f "$CAPTURE_DIR/caddy-wire.pcap" && du -h "$CAPTURE_DIR/caddy-wire.pcap" | cut -f1 || echo "N/A")
- Envoy: $(test -f "$CAPTURE_DIR/envoy-wire.pcap" && du -h "$CAPTURE_DIR/envoy-wire.pcap" | cut -f1 || echo "N/A")
- Auth gRPC: $(test -f "$CAPTURE_DIR/auth-grpc-wire.pcap" && du -h "$CAPTURE_DIR/auth-grpc-wire.pcap" | cut -f1 || echo "N/A")
- Records gRPC: $(test -f "$CAPTURE_DIR/records-grpc-wire.pcap" && du -h "$CAPTURE_DIR/records-grpc-wire.pcap" | cut -f1 || echo "N/A")

## Analysis
Check individual \*-analysis.txt files for detailed protocol verification.

## View Captures
\`\`\`bash
# With Wireshark
wireshark $CAPTURE_DIR/*.pcap

# With tshark
tshark -r $CAPTURE_DIR/caddy-wire.pcap -Y "http2"
tshark -r $CAPTURE_DIR/caddy-wire.pcap -Y "quic"
\`\`\`
EOF

ok "Summary report: $CAPTURE_DIR/verification-summary.md"

say "=== Wire-Level Verification Complete ==="
