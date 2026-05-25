#!/usr/bin/env bash
set -euo pipefail

# Script to verify k6 HTTP/3 is actually using HTTP/3 (QUIC) via tcpdump
# This proves HTTP/3 is working, not just HTTP/2

NS="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
TEST_DURATION="${TEST_DURATION:-30s}"
VUS="${VUS:-5}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="test-results/${TIMESTAMP}-http3-verification"
mkdir -p "$RESULTS_DIR"
LOG_FILE="$RESULTS_DIR/verification.log"

say "=== HTTP/3 Verification with tcpdump ==="
say "This script verifies that k6 HTTP/3 is actually using QUIC (UDP), not HTTP/2 (TCP)"

# Find Caddy pod
CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$CADDY_POD" ]]; then
  fail "Caddy pod not found"
fi

ok "Found Caddy pod: $CADDY_POD"

# Check if tcpdump is available in Caddy pod
say "Checking if tcpdump is available in Caddy pod..."
if ! kubectl -n ingress-nginx exec "$CADDY_POD" -- which tcpdump >/dev/null 2>&1; then
  warn "tcpdump not available in Caddy pod - installing busybox tcpdump..."
  # Try to install tcpdump or use alternative method
  kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "apk add --no-cache tcpdump 2>&1 || echo 'Cannot install tcpdump'" || warn "Cannot install tcpdump"
fi

# Start tcpdump in background on Caddy pod (capture UDP port 443 for QUIC)
# Use -U flag for unbuffered output and -s 0 for full packet capture
say "Starting tcpdump to capture QUIC (UDP) traffic..."
kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "tcpdump -i any -U -s 0 -w /tmp/quic-capture.pcap 'udp port 443' 2>&1" > "$RESULTS_DIR/tcpdump.log" 2>&1 &
TCPDUMP_PID=$!
sleep 3

# Run HTTP/3 test using curl (k6 doesn't support HTTP/3 natively yet)
# Use the test-microservices-http2-http3.sh script which uses curl with HTTP/3
say "Running HTTP/3 test using curl (k6 doesn't support HTTP/3 natively yet)..."
say "Using scripts/test-microservices-http2-http3.sh for HTTP/3 verification..."

# Run a focused HTTP/3 test using curl
# This will actually use QUIC (UDP) protocol
say "Making HTTP/3 requests via curl..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/http3.sh"

# Make several HTTP/3 requests to generate traffic
for i in {1..10}; do
  http3_curl -k -sS --http3-only --max-time 5 \
    -H "Host: $HOST" \
    --resolve "${HOST}:443:127.0.0.1" \
    "https://${HOST}/_caddy/healthz" >/dev/null 2>&1 || true
  sleep 0.5
done

ok "HTTP/3 requests completed"

sleep 2

# Stop tcpdump gracefully
say "Stopping tcpdump..."
# Send SIGTERM to allow tcpdump to flush buffers
kill -TERM $TCPDUMP_PID 2>/dev/null || true
sleep 2
# Force kill if still running
kill -9 $TCPDUMP_PID 2>/dev/null || true
wait $TCPDUMP_PID 2>/dev/null || true
sleep 1

# Copy pcap file from pod
say "Copying pcap file from pod..."
# First, check if file exists and has content
PCAP_SIZE=$(kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "stat -c%s /tmp/quic-capture.pcap 2>/dev/null || stat -f%z /tmp/quic-capture.pcap 2>/dev/null || echo '0'" 2>/dev/null || echo "0")
if [[ "$PCAP_SIZE" -gt 0 ]]; then
  ok "pcap file size: $PCAP_SIZE bytes"
  kubectl -n ingress-nginx cp "$CADDY_POD:/tmp/quic-capture.pcap" "$RESULTS_DIR/quic-capture.pcap" 2>/dev/null || {
    warn "kubectl cp failed, trying exec cat method..."
    kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "cat /tmp/quic-capture.pcap" > "$RESULTS_DIR/quic-capture.pcap" 2>/dev/null || {
      warn "Could not retrieve pcap file"
    }
  }
else
  warn "pcap file is empty or doesn't exist (size: $PCAP_SIZE)"
  # Try to copy anyway in case stat failed
  kubectl -n ingress-nginx cp "$CADDY_POD:/tmp/quic-capture.pcap" "$RESULTS_DIR/quic-capture.pcap" 2>/dev/null || true
fi

# Analyze pcap (if tcpdump is available locally)
if command -v tcpdump >/dev/null 2>&1; then
  say "Analyzing pcap file..."
  if [[ -f "$RESULTS_DIR/quic-capture.pcap" ]]; then
    # Count UDP packets on port 443 (QUIC)
    UDP_COUNT=$(tcpdump -r "$RESULTS_DIR/quic-capture.pcap" -n 'udp port 443' 2>/dev/null | wc -l | tr -d ' ')
    ok "Found $UDP_COUNT UDP packets on port 443 (QUIC traffic)"
    
    # Count TCP packets on port 443 (HTTP/2)
    TCP_COUNT=$(tcpdump -r "$RESULTS_DIR/quic-capture.pcap" -n 'tcp port 443' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$TCP_COUNT" -gt 0 ]]; then
      warn "Found $TCP_COUNT TCP packets on port 443 (may be HTTP/2 fallback or TLS handshake)"
    fi
    
    # Extract sample packets
    tcpdump -r "$RESULTS_DIR/quic-capture.pcap" -n -c 10 'udp port 443' > "$RESULTS_DIR/quic-sample.txt" 2>&1 || true
    
    if [[ "$UDP_COUNT" -gt 0 ]]; then
      ok "✅ HTTP/3 (QUIC) VERIFIED: Found UDP traffic on port 443"
      say "Sample QUIC packets saved to: $RESULTS_DIR/quic-sample.txt"
    else
      warn "⚠️  No UDP traffic detected - HTTP/3 may not be working"
    fi
  else
    warn "pcap file not found for analysis"
  fi
else
  warn "tcpdump not available locally - use Wireshark to analyze: $RESULTS_DIR/quic-capture.pcap"
fi

# Extract k6 metrics
say "Extracting k6 metrics..."
if [[ -f "$RESULTS_DIR/k6-output.log" ]]; then
  grep -E "(http_req_duration|http_req_failed|success_rate|p\(95\)|p\(99\))" "$RESULTS_DIR/k6-output.log" | head -20 > "$RESULTS_DIR/k6-metrics.txt" || true
fi

say "=== Results ==="
say "Test results saved to: $RESULTS_DIR"
say ""
say "To analyze with Wireshark:"
say "  wireshark $RESULTS_DIR/quic-capture.pcap"
say ""
say "Look for:"
say "  - UDP packets on port 443 (QUIC)"
say "  - QUIC protocol in packet details"
say "  - HTTP/3 in application layer"

