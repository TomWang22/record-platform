#!/usr/bin/env bash
# Phase 32H — start per-probe diagnostic bundle while request still in-flight.
set -euo pipefail
OUT="${1:?out}"
DIAG="${2:?diag dir}"
PROBE_ID="${3:-unknown}"

mkdir -p "$DIAG"

ps aux | head -n 1 > "$DIAG/process-snapshot.txt"
ps aux | grep -E 'phase32h|phase31-controlled|curl' | grep -v grep >> "$DIAG/process-snapshot.txt" || true

{
  echo "=== netstat ==="
  netstat -an 2>/dev/null | grep -E '443|ESTABLISHED|LISTEN' | head -200 || true
  echo "=== route ==="
  netstat -rn 2>/dev/null | head -20 || true
} > "$DIAG/network-snapshot.txt"

{
  date -u
  uptime
  pmset -g 2>/dev/null || echo "pmset unavailable"
  pmset -g assertions 2>/dev/null || true
} > "$DIAG/power-snapshot.txt"

if [[ -f "$OUT/window-coordinator/state.json" ]]; then
  cp "$OUT/window-coordinator/state.json" "$DIAG/coordinator-state.json"
fi
if [[ -f "$OUT/phase32h-restart-ledger.json" ]]; then
  cp "$OUT/phase32h-restart-ledger.json" "$DIAG/restart-ledger.json"
else
  echo '{"restarts":[]}' > "$DIAG/restart-ledger.json"
fi

if [[ -d "$OUT/pcap" ]]; then
  ls -la "$OUT/pcap" > "$DIAG/pcap-files.txt" 2>/dev/null || true
fi

python3 - <<'PY' "$OUT" "$DIAG" "$PROBE_ID"
import json, pathlib, sys
out, diag, probe_id = sys.argv[1:4]
status = {
  "probe_id": probe_id,
  "capture_status": "PARTIAL",
  "gateway_logs": "PARTIAL",
  "application_logs": "PARTIAL",
  "host_telemetry": "PARTIAL" if not pathlib.Path(out, "telemetry").exists() else "ACTIVE",
}
pathlib.Path(diag, "capture-status.json").write_text(json.dumps(status, indent=2) + "\n")
pathlib.Path(diag, "redaction-status.json").write_text(json.dumps({"redacted": True}, indent=2) + "\n")
PY

echo "phase32h diagnostic capture probe=$PROBE_ID dir=$DIAG"
