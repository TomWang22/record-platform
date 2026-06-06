#!/usr/bin/env bash
# Controlled capture at knee point (120 VUs, 30s strict H3), then validate pcap
# so transport_validated can flip true in the ceiling report.
#
# Flow:
#  1. Start 3-layer capture (host optional, VM + Caddy via packet-capture-v2)
#  2. Run k6 at CAPTURE_VUS (default 120) for CAPTURE_DURATION (default 30s), strict H3
#  3. Stop capture, copy pcaps to OUT_DIR
#  4. Run transport_validator.py on best pcap (host > vm > pod)
#  5. Write transport_validation.json; if ceiling artifacts exist, refresh transport_ceiling_report.json
#
# Usage:
#   ./scripts/run-transport-capture.sh
#   CAPTURE_VUS=120 CAPTURE_DURATION=30s ./scripts/run-transport-capture.sh
#   OUT_DIR=/path/to/validation ./scripts/run-transport-capture.sh   # merge with existing ramp/knee/bottleneck
#
# Env:
#   CAPTURE_VUS       — VUs for k6 (default 120, knee point)
#   CAPTURE_DURATION  — Duration (default 30s)
#   OUT_DIR           — Where to write pcaps + transport_validation.json (default $ROOT or TRANSPORT_VALIDATION_OUT)
#   CAPTURE_HOST      — 1 = start host tcpdump (default 1); 0 = skip
#   SKIP_HEALTH_GATE  — 1 = skip pre-ramp checks
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-${TRANSPORT_VALIDATION_OUT:-$ROOT}}"
CAPTURE_VUS="${CAPTURE_VUS:-120}"
CAPTURE_DURATION="${CAPTURE_DURATION:-30s}"
CAPTURE_HOST="${CAPTURE_HOST:-1}"

export K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
export H2_RATE=0
export STRICT_H3=1

K6_BIN="${K6_BIN:-$ROOT/.k6-build/bin/k6-http3}"
SCRIPT="${K6_SCRIPT:-$ROOT/scripts/k6-chaos-test.js}"
VALIDATOR="$ROOT/scripts/lib/transport_validator.py"
REPORT_BUILDER="$ROOT/scripts/lib/build_ceiling_report.py"
LIB="$(cd "$ROOT/scripts/lib" && pwd)"

mkdir -p "$OUT_DIR"

echo "=== Transport capture (knee point) ==="
echo "VUs=$CAPTURE_VUS duration=$CAPTURE_DURATION strict H3"
echo "Out dir: $OUT_DIR"
echo ""

# Optional pre-ramp gate (infra only, no curl; set SKIP_HEALTH_GATE=0 to enable)
if [[ "${SKIP_HEALTH_GATE:-1}" != "1" ]] && [[ -x "$ROOT/scripts/pre-ramp-health-gate.sh" ]]; then
  export SKIP_QUIC_PROBE=1
  "$ROOT/scripts/pre-ramp-health-gate.sh" || exit 1
  echo ""
fi

# --- Host capture ---
HOST_PID=""
if [[ "$CAPTURE_HOST" == "1" ]] && sudo -n true 2>/dev/null; then
  echo "[Capture] Starting host tcpdump..."
  sudo -n tcpdump -i any port 443 -w "$OUT_DIR/host_capture.pcap" 2>"$OUT_DIR/host_capture.log" &
  HOST_PID=$!
  sleep 1
  kill -0 "$HOST_PID" 2>/dev/null || HOST_PID=""
fi
[[ -z "$HOST_PID" ]] && [[ "$CAPTURE_HOST" == "1" ]] && echo "[Capture] Host capture skipped (no sudo). Run: sudo tcpdump -i any port 443 -w $OUT_DIR/host_capture.pcap"

# --- VM + Pod capture (v2) ---
export DISABLE_PACKET_CAPTURE="${DISABLE_PACKET_CAPTURE:-0}"
export CAPTURE_SKIP_ENVOY=1
export CAPTURE_NODE_ONLY=0
# Force v2 to write to our dir by setting session dir (v2 creates its own; we copy after)
# shellcheck source=scripts/lib/packet-capture-v2.sh
source "$LIB/packet-capture-v2.sh"
init_capture_session_v2
start_capture_v2

# --- k6 at knee point ---
echo "[Capture] Running k6 H3 VUs=$CAPTURE_VUS duration=$CAPTURE_DURATION..."
export H3_VUS="$CAPTURE_VUS"
export DURATION="$CAPTURE_DURATION"
"$K6_BIN" run "$SCRIPT" 2>/dev/null || true

# --- Stop host capture ---
if [[ -n "$HOST_PID" ]] && kill -0 "$HOST_PID" 2>/dev/null; then
  kill -INT "$HOST_PID" 2>/dev/null || true
  for _ in 1 2 3 4 5; do kill -0 "$HOST_PID" 2>/dev/null || break; sleep 1; done
  kill -9 "$HOST_PID" 2>/dev/null || true
fi

# --- Stop VM+Pod capture and copy to OUT_DIR ---
stop_and_analyze_captures_v2
v2dir="$(packet_capture_dir)"
[[ -f "$v2dir/node-capture.pcap" ]] && cp -f "$v2dir/node-capture.pcap" "$OUT_DIR/vm_capture.pcap"
[[ -f "$v2dir/caddy-capture.pcap" ]] && cp -f "$v2dir/caddy-capture.pcap" "$OUT_DIR/pod_capture.pcap"

# --- Validate best available pcap (host > vm > pod) ---
PCAP=""
for candidate in "$OUT_DIR/host_capture.pcap" "$OUT_DIR/vm_capture.pcap" "$OUT_DIR/pod_capture.pcap"; do
  if [[ -f "$candidate" ]] && [[ -s "$candidate" ]]; then
    PCAP="$candidate"
    break
  fi
done

if [[ -z "$PCAP" ]] || [[ ! -f "$PCAP" ]]; then
  echo '{"valid": false, "error": "no pcap (host/vm/pod) available for validation"}' > "$OUT_DIR/transport_validation.json"
  echo "No pcap to validate. Write transport_validation.json with valid=false."
else
  echo "[Validate] Running transport_validator.py on $PCAP..."
  python3 "$VALIDATOR" "$PCAP" > "$OUT_DIR/transport_validation.json" 2>/dev/null || true
  if [[ -s "$OUT_DIR/transport_validation.json" ]]; then
    valid=$(python3 -c "import json; d=json.load(open('$OUT_DIR/transport_validation.json')); print(d.get('valid', False))" 2>/dev/null || echo "False")
    if [[ "$valid" == "True" ]] || [[ "$valid" == "true" ]]; then
      echo "transport_validated=true (QUIC + h3 ALPN confirmed from pcap)"
    else
      echo "transport_validated=false (see transport_validation.json error)"
    fi
  fi
fi

# --- Refresh ceiling report if ramp/knee/bottleneck exist ---
if [[ -f "$OUT_DIR/ramp_steps.json" ]] && [[ -f "$OUT_DIR/knee_result.json" ]] && [[ -f "$OUT_DIR/bottleneck_result.json" ]]; then
  echo "Refreshing transport_ceiling_report.json with validation result..."
  python3 "$REPORT_BUILDER" "$OUT_DIR" 2>/dev/null || true
  if [[ -f "$OUT_DIR/transport_ceiling_report.json" ]]; then
    echo ""
    cat "$OUT_DIR/transport_ceiling_report.json"
    echo ""
    echo "Written to: $OUT_DIR/transport_ceiling_report.json"
  fi
else
  echo "No ramp_steps.json / knee_result.json / bottleneck_result.json in $OUT_DIR; ceiling report not refreshed. Run full validation first, then run this script with OUT_DIR=$OUT_DIR to add packet proof."
fi

echo ""
echo "Done. Pcap(s) and transport_validation.json in $OUT_DIR."
