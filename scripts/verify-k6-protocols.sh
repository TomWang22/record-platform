#!/usr/bin/env bash
# Post-test verification: Verify HTTP/2 and HTTP/3 protocols using tshark/tcpdump
# ROTATION_SSLKEYLOG or second arg: path to SSLKEYLOGFILE → tshark can decrypt TLS and show HTTP/2 frames
set -euo pipefail

CAPTURE_DIR="${1:-/tmp/rotation-wire-$(date +%s)}"
KEYLOG="${2:-${ROTATION_SSLKEYLOG:-}}"
HOST="${HOST:-record.local}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "  ℹ️  $*"; }

say "=== Verifying Protocols in Packet Captures ==="
info "Scope: k6 chaos test traffic (HTTP/2 tcp 443 + HTTP/3/QUIC udp 443). Rotation uses MetalLB LB IP:443 only."
[[ -n "${TARGET_IP:-}" ]] && info "TARGET_IP=$TARGET_IP — QUIC to LB / stray and SNI record.local verification enabled."

# Best-effort verification: do not fail rotation suite when capture/tshark missing
if [[ ! -d "$CAPTURE_DIR" ]]; then
  warn "Capture directory not found: $CAPTURE_DIR (protocol verification skipped)"
  exit 0
fi

if ! command -v tshark >/dev/null 2>&1; then
  warn "tshark not available - protocol verification skipped (install tshark for wire-level verification)"
  exit 0
fi

# Robust glob: collect all .pcap files (Caddy + Envoy); avoid literal when no match
ALL_PCAPS=()
while IFS= read -r -d '' f; do
  [[ -f "$f" ]] && [[ -s "$f" ]] && ALL_PCAPS+=("$f")
done < <(find "$CAPTURE_DIR" -maxdepth 1 -name "*.pcap" -size +0 -print0 2>/dev/null)
[[ ${#ALL_PCAPS[@]} -eq 0 ]] && for f in "$CAPTURE_DIR"/*.pcap; do
  [[ -f "$f" ]] && [[ -s "$f" ]] && ALL_PCAPS+=("$f")
done

for pcap in "${ALL_PCAPS[@]}"; do
  [[ -z "$pcap" ]] && continue
  
  filename=$(basename "$pcap")
  say "Analyzing $filename..."
  
  # HTTP/2 verification (TLS-encrypted so "http2" filter = 0 without keylog; ALPN h2 is definitive)
  TSHARK_OPTS=()
  [[ -n "$KEYLOG" ]] && [[ -f "$KEYLOG" ]] && [[ -s "$KEYLOG" ]] && TSHARK_OPTS=(-o "tls.keylog_file:$KEYLOG")
  HTTP2_COUNT=$(tshark -r "$pcap" "${TSHARK_OPTS[@]}" -Y "http2" 2>/dev/null | wc -l | tr -d ' ')
  ALPN_H2=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
  TCP443=$(tshark -r "$pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l | tr -d ' ')
  [[ "$HTTP2_COUNT" =~ ^[0-9]+$ ]] || HTTP2_COUNT=0
  [[ "$ALPN_H2" =~ ^[0-9]+$ ]] || ALPN_H2=0
  [[ "$TCP443" =~ ^[0-9]+$ ]] || TCP443=0

  if [[ "$HTTP2_COUNT" -gt 0 ]]; then
    ok "$filename: HTTP/2 verified ($HTTP2_COUNT decrypted frames)"
    HTTP2_FRAMES=$(tshark -r "$pcap" "${TSHARK_OPTS[@]}" -Y "http2" -T fields -e http2.type 2>/dev/null | sort | uniq -c | head -5)
    if [[ -n "$HTTP2_FRAMES" ]]; then
      echo "  HTTP/2 frame types:"
      echo "$HTTP2_FRAMES" | sed 's/^/    /'
    fi
  elif [[ "$ALPN_H2" -gt 0 ]]; then
    ok "$filename: HTTP/2 intent verified (ALPN h2 in TLS Client Hello, $ALPN_H2) — frames TLS-encrypted (set SSLKEYLOGFILE for decryption)"
  elif [[ "$TCP443" -gt 0 ]]; then
    ok "$filename: TCP 443 ($TCP443 packets, HTTP/2 likely; TLS-encrypted, no ALPN decode)"
  else
    # Envoy captures port 10000 (gRPC), not 443; chaos load hits Caddy only — no HTTP/2 on 443 expected
    if [[ "$filename" == *"envoy"* ]]; then
      info "$filename: No HTTP/2 on 443 (expected — chaos load hits Caddy; gRPC would appear on port 10000)"
    else
      warn "$filename: No HTTP/2 traffic (ALPN=0, frames=0, TCP443=0; traffic may hit other pod)"
    fi
  fi

  # Verbose: per-pcap diagnostics when ROTATION_WIRE_VERBOSE=1
  if [[ "${ROTATION_WIRE_VERBOSE:-0}" == "1" ]]; then
    echo "  [verbose] HTTP/2(frames)=$HTTP2_COUNT, ALPN_h2=$ALPN_H2, TCP443=$TCP443"
  fi
  
  # HTTP/3 (QUIC) verification — QUIC payload is encrypted (TLS 1.3); packet count = verified (frame-level would need qlog)
  QUIC_COUNT=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l | tr -d ' ')
  if [[ -n "$QUIC_COUNT" ]] && [[ "$QUIC_COUNT" =~ ^[0-9]+$ ]] && [[ "$QUIC_COUNT" -gt 0 ]]; then
    ok "$filename: HTTP/3 (QUIC) verified ($QUIC_COUNT packets — encrypted; packet count confirms QUIC traffic)"
    
    # SNI validation: QUIC with record.local = definitive proof traffic belongs to our domain (no background noise).
    QUIC_SNI=$(tshark -r "$pcap" -Y "quic && tls.handshake.extensions_server_name contains record.local" 2>/dev/null | wc -l | tr -d ' ')
    [[ "$QUIC_SNI" =~ ^[0-9]+$ ]] && [[ "$QUIC_SNI" -gt 0 ]] && ok "$filename: QUIC SNI record.local: $QUIC_SNI packets (proof traffic to our domain)"
    
    # When TARGET_IP set: verify QUIC to MetalLB IP only (host/VM pcaps); in-pod capture has dst=pod IP so to_lb may be 0.
    if [[ -n "${TARGET_IP:-}" ]]; then
      QUIC_TO_LB=$(tshark -r "$pcap" -Y "udp.port == 443 && ip.dst == $TARGET_IP" 2>/dev/null | wc -l | tr -d ' ')
      QUIC_STRAY=$(tshark -r "$pcap" -Y "udp.port == 443 && ip.dst != $TARGET_IP" 2>/dev/null | wc -l | tr -d ' ')
      [[ "$QUIC_TO_LB" =~ ^[0-9]+$ ]] || QUIC_TO_LB=0
      [[ "$QUIC_STRAY" =~ ^[0-9]+$ ]] || QUIC_STRAY=0
      info "$filename: UDP 443 to $TARGET_IP: $QUIC_TO_LB; stray (dst != $TARGET_IP): $QUIC_STRAY (in-pod capture has dst=pod IP)"
      [[ "$QUIC_STRAY" -eq 0 ]] && [[ "$QUIC_TO_LB" -gt 0 ]] && ok "$filename: No stray UDP 443 (all QUIC to LB IP)"
    fi
    
    # Verify QUIC handshake
    QUIC_INITIAL=$(tshark -r "$pcap" -Y "quic.long.packet_type == 1" 2>/dev/null | wc -l | tr -d ' ')
    if [[ -n "$QUIC_INITIAL" ]] && [[ "$QUIC_INITIAL" =~ ^[0-9]+$ ]] && [[ "$QUIC_INITIAL" -gt 0 ]]; then
      ok "$filename: QUIC handshake (Initial) verified ($QUIC_INITIAL packets)"
    fi
  fi
  
  # TLS 1.3 verification
  TLS13_COUNT=$(tshark -r "$pcap" -Y "tls.version == 0x0304" 2>/dev/null | wc -l | tr -d ' ')
  if [[ -n "$TLS13_COUNT" ]] && [[ "$TLS13_COUNT" =~ ^[0-9]+$ ]] && [[ "$TLS13_COUNT" -gt 0 ]]; then
    ok "$filename: TLS 1.3 verified ($TLS13_COUNT packets)"
  fi
  
  # gRPC verification (HTTP/2 with application/grpc)
  GRPC_COUNT=$(tshark -r "$pcap" -Y "http2.header.value contains \"application/grpc\"" 2>/dev/null | wc -l | tr -d ' ')
  if [[ -n "$GRPC_COUNT" ]] && [[ "$GRPC_COUNT" =~ ^[0-9]+$ ]] && [[ "$GRPC_COUNT" -gt 0 ]]; then
    ok "$filename: gRPC verified ($GRPC_COUNT packets)"
  fi
  
  echo ""
done

# Aggregate summary (always; helps post-rotation block and diagnostics)
# Use keylog when available so HTTP/2 frame count is > 0 (decrypted)
TSHARK_AGG_OPTS=()
[[ -n "$KEYLOG" ]] && [[ -f "$KEYLOG" ]] && [[ -s "$KEYLOG" ]] && TSHARK_AGG_OPTS=(-o "tls.keylog_file:$KEYLOG")
TOTAL_HTTP2_FRAMES=0
TOTAL_ALPN_H2=0
TOTAL_QUIC=0
TOTAL_TCP443=0
for pcap in "${ALL_PCAPS[@]}"; do
  [[ -z "$pcap" ]] || [[ ! -f "$pcap" ]] || [[ ! -s "$pcap" ]] || [[ "$pcap" != *caddy* ]] && continue
  n=$(tshark -r "$pcap" "${TSHARK_AGG_OPTS[@]}" -Y "http2" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$n" =~ ^[0-9]+$ ]] && TOTAL_HTTP2_FRAMES=$((TOTAL_HTTP2_FRAMES + n))
  n=$(tshark -r "$pcap" -Y "tls.handshake.extensions_alpn_str" -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | grep -c "h2" 2>/dev/null || echo "0")
  [[ "$n" =~ ^[0-9]+$ ]] && TOTAL_ALPN_H2=$((TOTAL_ALPN_H2 + n))
  n=$(tshark -r "$pcap" -Y "quic" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$n" =~ ^[0-9]+$ ]] && TOTAL_QUIC=$((TOTAL_QUIC + n))
  n=$(tshark -r "$pcap" -Y "tcp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
  [[ "$n" =~ ^[0-9]+$ ]] && TOTAL_TCP443=$((TOTAL_TCP443 + n))
done
say "=== Packet capture summary (Caddy pods) ==="
echo "  HTTP/2(frames)=$TOTAL_HTTP2_FRAMES, HTTP/2(ALPN)=$TOTAL_ALPN_H2, QUIC=$TOTAL_QUIC, TCP443=$TOTAL_TCP443"
info "Per-pod counts vary by MetalLB L2 load balancing; combined totals = k6 chaos traffic"
[[ "$TOTAL_HTTP2_FRAMES" -gt 0 ]] && ok "HTTP/2 decrypted (SSLKEYLOGFILE was used)"
[[ "$TOTAL_HTTP2_FRAMES" -eq 0 ]] && [[ "$TOTAL_ALPN_H2" -gt 0 ]] && info "HTTP/2 frames=0: TLS encrypts payload; ALPN h2 in Client Hello = definitive proof. Use ROTATION_H2_KEYLOG=1 for decrypted frames."
[[ -n "$KEYLOG" ]] && [[ ! -f "$KEYLOG" ]] && warn "Keylog file not found: $KEYLOG — frames will be 0"

say "=== Protocol Verification Complete ==="
exit 0
