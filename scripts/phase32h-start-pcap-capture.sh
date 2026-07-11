#!/usr/bin/env bash
# Phase 32H — PCAP ring-buffer capture (fail-closed if unavailable).
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
PCAP_DIR="$OUT/pcap"
mkdir -p "$PCAP_DIR"
STATUS="$PCAP_DIR/capture-status.json"

if command -v dumpcap >/dev/null 2>&1; then
  CAP=dumpcap
elif command -v tcpdump >/dev/null 2>&1; then
  CAP=tcpdump
else
  echo '{"status":"BLOCKED","reason":"no dumpcap or tcpdump"}' > "$STATUS"
  exit 2
fi

if ! sudo -n "$CAP" -D >/dev/null 2>&1; then
  echo '{"status":"BLOCKED","reason":"capture requires non-interactive sudo for tcpdump/dumpcap"}' > "$STATUS"
  echo "BLOCKED: configure passwordless sudo for $CAP or start capture manually before smoke"
  exit 2
fi

IFACE="${PHASE32H_PCAP_IFACE:-en0}"
FILE="$PCAP_DIR/phase32h-$(date -u +%Y%m%dT%H%M%SZ).pcapng"

if [[ "$CAP" == "dumpcap" ]]; then
  sudo -n dumpcap -i "$IFACE" -f "tcp port 443 or udp port 443 or port 53" -b filesize:250000 -b files:24 -w "$FILE" &
else
  sudo -n tcpdump -i "$IFACE" -s 0 -w "$FILE" 'tcp port 443 or udp port 443 or port 53' &
fi
PID=$!
echo "{\"status\":\"ACTIVE\",\"pid\":$PID,\"iface\":\"$IFACE\",\"file\":\"$FILE\",\"tool\":\"$CAP\"}" > "$STATUS"
echo "phase32h pcap collector pid=$PID file=$FILE"
