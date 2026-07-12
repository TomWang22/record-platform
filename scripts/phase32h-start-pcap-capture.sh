#!/usr/bin/env bash
# Phase 32H — PCAP ring-buffer capture via ChmodBPF (unprivileged dumpcap; no sudo).
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
PCAP_DIR="$OUT/pcap"
mkdir -p "$PCAP_DIR"
STATUS="$PCAP_DIR/capture-status.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/phase32h-pcap-chmodbpf.sh
source "$SCRIPT_DIR/lib/phase32h-pcap-chmodbpf.sh"

if ! phase32h_assert_chmodbpf; then
  echo '{"status":"BLOCKED","reason":"ChmodBPF prerequisites failed; install wireshark-chmodbpf and re-login"}' > "$STATUS"
  exit 2
fi

DUMPCAP_BIN="$(phase32h_dumpcap_bin)"
IFACE="$(phase32h_resolve_capture_iface)"
FILE="$PCAP_DIR/phase32h-$(date -u +%Y%m%dT%H%M%SZ).pcapng"
FILTER="${PHASE32H_PCAP_FILTER:-tcp port 443 or udp port 443 or port 53 or icmp or icmp6}"
RING_FILES="${PHASE32H_PCAP_RING_FILES:-48}"

"$DUMPCAP_BIN" \
  -q \
  -i "$IFACE" \
  -f "$FILTER" \
  -b filesize:250000 \
  -b files:"$RING_FILES" \
  -w "$FILE" \
  </dev/null >>"$PCAP_DIR/dumpcap.log" 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

sleep 0.5
if ! kill -0 "$PID" 2>/dev/null; then
  echo "{\"status\":\"BLOCKED\",\"reason\":\"dumpcap exited immediately\",\"iface\":\"$IFACE\",\"tool\":\"dumpcap\"}" > "$STATUS"
  exit 2
fi

python3 - <<PY "$STATUS" "$PID" "$IFACE" "$FILE" "$DUMPCAP_BIN" "$FILTER" "$RING_FILES"
import json, sys
status, pid, iface, file, tool, filt, ring_files = sys.argv[1:8]
argv = [tool, "-q", "-i", iface, "-f", filt, "-b", "filesize:250000", "-b", f"files:{ring_files}", "-w", file]
json.dump(
  {
    "status": "ACTIVE",
    "pid": int(pid),
    "iface": iface,
    "file": file,
    "tool": tool,
    "filter": filt,
    "argv": argv,
    "ring_files": int(ring_files),
    "ring_filesize_kb": 250000,
    "chmodbpf": True,
    "sudo": False,
    "started_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
  },
  open(status, "w"),
  indent=2,
)
PY

echo "phase32h pcap collector pid=$PID iface=$IFACE file=$FILE (ChmodBPF, no sudo)"
