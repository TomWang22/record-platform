#!/usr/bin/env bash
set -euo pipefail

### Verify Protocols in Wire-Level Packet Captures
### This script analyzes packet captures to verify protocols are correct

CAPTURE_DIR="${1:-${CAPTURE_DIR:-/tmp/k6-wire-capture-*}}"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✔ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ✘ $*" >&2; }

# Find most recent capture directory if glob pattern
if [[ "$CAPTURE_DIR" == *"*"* ]]; then
  CAPTURE_DIR=$(ls -td $CAPTURE_DIR 2>/dev/null | head -1 || echo "")
fi

if [[ -z "$CAPTURE_DIR" ]] || [[ ! -d "$CAPTURE_DIR" ]]; then
  fail "Capture directory not found: $CAPTURE_DIR"
  exit 1
fi

if ! command -v tshark >/dev/null 2>&1; then
  fail "tshark not available - cannot verify protocols"
  warn "Install with: brew install wireshark (macOS) or apt-get install tshark (Linux)"
  exit 1
fi

say "=== Verifying Protocols in Wire Captures ==="
ok "Capture directory: $CAPTURE_DIR"

VERIFIED=0
TOTAL=0

for pcap in "$CAPTURE_DIR"/*.pcap; do
  if [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]]; then
    continue
  fi
  
  TOTAL=$((TOTAL + 1))
  service=$(basename "$pcap" .pcap)
  say "Analyzing $service…"
  
  PCAP_VERIFIED=true
  
  # Verify HTTP/2
  HTTP2_COUNT=$(tshark -r "$pcap" -Y "http2" 2>/dev/null | wc -l 2>/dev/null || echo "0")
  HTTP2_COUNT=$(echo "$HTTP2_COUNT" | tr -d '[:space:]')
  if [[ -n "$HTTP2_COUNT" ]] && [[ "$HTTP2_COUNT" =~ ^[0-9]+$ ]] && [[ "$HTTP2_COUNT" -gt 0 ]]; then
    ok "$service: HTTP/2 verified ($HTTP2_COUNT packets)"
    
    # Verify HTTP/2 ALPN
    ALPN_H2=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str contains \"h2\"" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    ALPN_H2=$(echo "$ALPN_H2" | tr -d '[:space:]')
    if [[ -n "$ALPN_H2" ]] && [[ "$ALPN_H2" =~ ^[0-9]+$ ]] && [[ "$ALPN_H2" -gt 0 ]]; then
      ok "$service: HTTP/2 ALPN negotiation verified ($ALPN_H2 packets)"
    fi
  else
    warn "$service: No HTTP/2 packets detected"
  fi
  
  # Verify HTTP/3 (QUIC)
  QUIC_COUNT=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null || echo "0")
  QUIC_COUNT=$(echo "$QUIC_COUNT" | tr -d '[:space:]')
  if [[ -n "$QUIC_COUNT" ]] && [[ "$QUIC_COUNT" =~ ^[0-9]+$ ]] && [[ "$QUIC_COUNT" -gt 0 ]]; then
    ok "$service: HTTP/3 (QUIC) verified ($QUIC_COUNT packets)"
    
    # Verify QUIC handshake (Initial packet type = 1)
    QUIC_INITIAL=$(tshark -r "$pcap" -Y "quic.long.packet_type == 1" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    QUIC_INITIAL=$(echo "$QUIC_INITIAL" | tr -d '[:space:]')
    if [[ -n "$QUIC_INITIAL" ]] && [[ "$QUIC_INITIAL" =~ ^[0-9]+$ ]] && [[ "$QUIC_INITIAL" -gt 0 ]]; then
      ok "$service: QUIC handshake (Initial) verified ($QUIC_INITIAL packets)"
    fi
    
    # Verify QUIC version negotiation
    QUIC_VERSION=$(tshark -r "$pcap" -Y "quic.version" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    QUIC_VERSION=$(echo "$QUIC_VERSION" | tr -d '[:space:]')
    if [[ -n "$QUIC_VERSION" ]] && [[ "$QUIC_VERSION" =~ ^[0-9]+$ ]] && [[ "$QUIC_VERSION" -gt 0 ]]; then
      ok "$service: QUIC version negotiation verified ($QUIC_VERSION packets)"
    fi
    
    # Verify QUIC is using UDP
    QUIC_UDP=$(tshark -r "$pcap" -Y "udp && quic" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    QUIC_UDP=$(echo "$QUIC_UDP" | tr -d '[:space:]')
    if [[ -n "$QUIC_UDP" ]] && [[ "$QUIC_UDP" =~ ^[0-9]+$ ]] && [[ "$QUIC_UDP" -gt 0 ]]; then
      ok "$service: QUIC over UDP verified ($QUIC_UDP packets)"
    fi
  else
    warn "$service: No QUIC packets detected (HTTP/3 may not be in use)"
    PCAP_VERIFIED=false
  fi
  
  # Verify TLS 1.3
  TLS13_COUNT=$(tshark -r "$pcap" -Y "tls.version == 0x0304" 2>/dev/null | wc -l 2>/dev/null || echo "0")
  TLS13_COUNT=$(echo "$TLS13_COUNT" | tr -d '[:space:]')
  if [[ -n "$TLS13_COUNT" ]] && [[ "$TLS13_COUNT" =~ ^[0-9]+$ ]] && [[ "$TLS13_COUNT" -gt 0 ]]; then
    ok "$service: TLS 1.3 verified ($TLS13_COUNT packets)"
  else
    # Check for TLS 1.2 (should not be present with strict TLS)
    TLS12_COUNT=$(tshark -r "$pcap" -Y "tls.version == 0x0303" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    TLS12_COUNT=$(echo "$TLS12_COUNT" | tr -d '[:space:]')
    if [[ -n "$TLS12_COUNT" ]] && [[ "$TLS12_COUNT" =~ ^[0-9]+$ ]] && [[ "$TLS12_COUNT" -gt 0 ]]; then
      warn "$service: TLS 1.2 detected ($TLS12_COUNT packets) - should be TLS 1.3 only"
      PCAP_VERIFIED=false
    else
      warn "$service: No TLS 1.3 packets detected"
      PCAP_VERIFIED=false
    fi
  fi
  
  # Verify gRPC (HTTP/2 with application/grpc content-type)
  GRPC_COUNT=$(tshark -r "$pcap" -Y "http2.header.value contains \"application/grpc\"" 2>/dev/null | wc -l 2>/dev/null || echo "0")
  GRPC_COUNT=$(echo "$GRPC_COUNT" | tr -d '[:space:]')
  if [[ -n "$GRPC_COUNT" ]] && [[ "$GRPC_COUNT" =~ ^[0-9]+$ ]] && [[ "$GRPC_COUNT" -gt 0 ]]; then
    ok "$service: gRPC verified ($GRPC_COUNT packets)"
    
    # Verify gRPC is over HTTP/2
    GRPC_HTTP2=$(tshark -r "$pcap" -Y "http2 && http2.header.value contains \"application/grpc\"" 2>/dev/null | wc -l 2>/dev/null || echo "0")
    GRPC_HTTP2=$(echo "$GRPC_HTTP2" | tr -d '[:space:]')
    if [[ -n "$GRPC_HTTP2" ]] && [[ "$GRPC_HTTP2" =~ ^[0-9]+$ ]] && [[ "$GRPC_HTTP2" -gt 0 ]]; then
      ok "$service: gRPC over HTTP/2 verified ($GRPC_HTTP2 packets)"
    fi
  fi
  
  if [[ "$PCAP_VERIFIED" == "true" ]]; then
    VERIFIED=$((VERIFIED + 1))
  fi
done

say "=== Protocol Verification Summary ==="
if [[ $TOTAL -eq 0 ]]; then
  warn "No packet captures found in: $CAPTURE_DIR"
  exit 1
fi

ok "Total captures analyzed: $TOTAL"
ok "Captures with verified protocols: $VERIFIED"

if [[ $VERIFIED -eq $TOTAL ]]; then
  ok "✅ All captures verified successfully"
  exit 0
else
  warn "⚠️  Some captures need review"
  exit 1
fi
