#!/usr/bin/env bash
# Phase 32H — validate smoke PCAP: TCP/UDP 443 presence + transport_validator.
set -euo pipefail
OUT="${1:?out dir}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/phase32h-pcap-chmodbpf.sh
source "$SCRIPT_DIR/lib/phase32h-pcap-chmodbpf.sh"

PCAP_DIR="$OUT/pcap"
REPORT="$OUT/pcap/pcap-smoke-validation.json"

latest_pcap="$(ls -1t "$PCAP_DIR"/phase32h-*.pcapng "$PCAP_DIR"/phase32h-*.pcap 2>/dev/null | head -1 || true)"
if [[ -z "$latest_pcap" || ! -s "$latest_pcap" ]]; then
  echo '{"status":"BLOCKED","reason":"no pcap file"}' > "$REPORT"
  exit 2
fi

tcp_443="$(phase32h_pcap_tcp_443_count "$latest_pcap")"
udp_443="$(phase32h_pcap_udp_443_count "$latest_pcap")"

quic_only="$(mktemp /tmp/phase32h-quic-only-XXXXXX.pcapng)"
if command -v tshark >/dev/null 2>&1; then
  tshark -r "$latest_pcap" -w "$quic_only" -F pcapng -Y 'udp.port == 443' 2>/dev/null || true
fi

transport_selftest=0
transport_valid=0
transport_json="{}"
if python3 "$REPO_ROOT/scripts/lib/transport_validator_selftest.py" >/dev/null 2>&1; then
  transport_selftest=1
fi
if [[ "$transport_selftest" -eq 1 && -s "$quic_only" ]]; then
  transport_out="$(mktemp)"
  if MIN_1RTT_PACKETS=1 python3 "$REPO_ROOT/scripts/lib/transport_validator.py" "$quic_only" --output "$transport_out" 2>/dev/null; then
    transport_valid=1
    transport_json="$(cat "$transport_out")"
  fi
  rm -f "$transport_out"
fi
rm -f "$quic_only"

status="PASS"
if [[ "${tcp_443:-0}" -lt 1 ]]; then status="BLOCKED"; fi
if [[ "${udp_443:-0}" -lt 1 ]]; then status="BLOCKED"; fi
if [[ "$transport_selftest" -ne 1 || "$transport_valid" -ne 1 ]]; then status="BLOCKED"; fi

transport_json_file="$(mktemp)"
printf '%s' "$transport_json" > "$transport_json_file"
python3 - <<'PY' "$REPORT" "$status" "$latest_pcap" "$tcp_443" "$udp_443" "$transport_selftest" "$transport_valid" "$transport_json_file"
import json, sys
report, status, pcap, tcp, udp, selftest, valid, tjson_path = sys.argv[1:9]
tjson = open(tjson_path).read()
payload = {
  "status": status,
  "pcap": pcap,
  "tcp_443_packets": int(tcp or 0),
  "udp_443_packets": int(udp or 0),
  "transport_validator_selftest": int(selftest),
  "transport_validator_pass": int(valid),
  "transport_validator": json.loads(tjson) if tjson.startswith("{") else {},
}
open(report, "w").write(json.dumps(payload, indent=2) + "\n")
print(json.dumps(payload, indent=2))
PY
rm -f "$transport_json_file"

[[ "$status" == "PASS" ]]
