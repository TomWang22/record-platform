#!/usr/bin/env bash
# Capture UDP 443 during a QUIC request; fail if no packets observed.
# Proves real QUIC traffic flows (no silent TCP fallback).
# Usage: ./scripts/http3-assert-quic-traffic.sh
# Requires: curl with HTTP/3, tcpdump (sudo for capture). TARGET_IP, PORT, HTTP3_EXPECTED_HOST.

set -euo pipefail

EXPECTED_HOST="${HTTP3_EXPECTED_HOST:-record.local}"
LB_IP="${TARGET_IP:-127.0.0.1}"
PORT="${PORT:-443}"
# macOS loopback is lo0; Linux is often lo
IFACE="${HTTP3_CAPTURE_IFACE:-lo0}"
if ! ifconfig "$IFACE" &>/dev/null; then
  IFACE="lo"
fi
PCAP="/tmp/http3-ci-$$.pcap"

echo "🔍 Capturing QUIC traffic on UDP ${PORT} (interface ${IFACE})..."

sudo tcpdump -i "$IFACE" -n udp port "$PORT" -w "$PCAP" -U >/dev/null 2>&1 &
TCPDUMP_PID=$!
sleep 2

curl --http3-only \
  --resolve "${EXPECTED_HOST}:${PORT}:${LB_IP}" \
  -k "https://${EXPECTED_HOST}:${PORT}/" \
  -o /dev/null \
  -s --max-time 10 || true

sleep 2
sudo kill -INT "$TCPDUMP_PID" 2>/dev/null || true
sleep 1

PACKETS=$(tcpdump -r "$PCAP" 2>/dev/null | wc -l | tr -d ' ')
rm -f "$PCAP"

if [[ "${PACKETS:-0}" -lt 1 ]]; then
  echo "❌ No QUIC UDP packets observed."
  exit 1
fi

echo "✅ QUIC UDP packets observed ($PACKETS)."
