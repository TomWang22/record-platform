#!/usr/bin/env bash
# Run all HTTP/3 contract checks: SAN, ALPN, QUIC traffic. Single entry point for CI/local.
# Usage: ./scripts/http3-contract-validator.sh
# Env: HTTP3_EXPECTED_HOST, TARGET_IP, PORT (defaults: record.local, 127.0.0.1, 443).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPECTED_HOST="${HTTP3_EXPECTED_HOST:-record.local}"
TARGET_IP="${TARGET_IP:-127.0.0.1}"
PORT="${PORT:-443}"
PCAP="/tmp/http3-contract-$$.pcap"
IFACE="${HTTP3_CAPTURE_IFACE:-lo0}"
if ! ifconfig "$IFACE" &>/dev/null 2>&1; then
  IFACE="lo"
fi

cd "$REPO_ROOT"

echo "🔐 Checking certificate SAN..."
CERT=$(echo | openssl s_client \
  -connect "${TARGET_IP}:${PORT}" \
  -servername "${EXPECTED_HOST}" \
  -alpn h3 2>/dev/null | openssl x509 -noout -text 2>/dev/null || true)
if [[ -z "$CERT" ]]; then
  echo "❌ Could not retrieve certificate from ${TARGET_IP}:${PORT} (SNI ${EXPECTED_HOST})"
  exit 1
fi
echo "$CERT" | grep -q "DNS:${EXPECTED_HOST}" || {
  echo "❌ SAN mismatch (expected DNS:${EXPECTED_HOST})"
  exit 1
}
echo "✅ SAN valid"

echo "📡 Capturing QUIC traffic..."
sudo tcpdump -i "$IFACE" -n udp port "$PORT" -w "$PCAP" -U >/dev/null 2>&1 &
PID=$!
sleep 2

OUTPUT=$(curl --http3-only -v --max-time 10 \
  --resolve "${EXPECTED_HOST}:${PORT}:${TARGET_IP}" \
  -k "https://${EXPECTED_HOST}:${PORT}/" 2>&1 || true)

sleep 2
sudo kill -INT "$PID" 2>/dev/null || true
sleep 1

echo "$OUTPUT" | grep -qi "using HTTP/3" || {
  echo "❌ ALPN not HTTP/3"
  rm -f "$PCAP"
  exit 1
}
echo "✅ ALPN h3 negotiated"

PACKETS=$(tcpdump -r "$PCAP" -n 2>/dev/null | grep -c "quic" || true)
rm -f "$PCAP"

[[ "${PACKETS:-0}" -gt 0 ]] || {
  echo "❌ No QUIC packets observed"
  exit 1
}
echo "✅ QUIC packets observed ($PACKETS)"

echo "✅ QUIC contract validated."
