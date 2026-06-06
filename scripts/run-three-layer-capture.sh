#!/usr/bin/env bash
# 3-layer capture orchestrator: Host (macOS) → VM (Colima) → Pod (Caddy).
# No single point that can be killed by macOS/NAT churn; deterministic visibility.
#
# Flow:
#  1. Create session dir
#  2. Start Capture A (host): sudo tcpdump -i any port 443 -w host_capture.pcap
#  3. Start Capture B (VM) + C (Caddy) via packet-capture-v2 (Envoy skipped)
#  4. Prompt: run your ramp (e.g. ./scripts/run-h3-ramp.sh --collect-steps)
#  5. Stop all captures, copy pcaps to session dir, print 3-layer summary
#
# Usage:
#   ./scripts/run-three-layer-capture.sh
#   CAPTURE_HOST=0 ./scripts/run-three-layer-capture.sh   # skip host (e.g. no sudo)
#
# Env:
#   CAPTURE_HOST — set to 1 to start host tcpdump (requires sudo). Default 1; set 0 to skip.
#   DISABLE_PACKET_CAPTURE — set to 1 to skip VM+Pod capture (v2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIB="$(cd "$ROOT/scripts/lib" && pwd)"
THREE_LAYER_DIR="${THREE_LAYER_DIR:-/tmp/three-layer-capture-$(date +%s)-$$}"
CAPTURE_HOST="${CAPTURE_HOST:-1}"

mkdir -p "$THREE_LAYER_DIR"
echo "=== 3-layer capture: Host → VM → Pod ==="
echo "Session dir: $THREE_LAYER_DIR"
echo ""

# --- Capture A: Host (macOS) ---
HOST_PID=""
if [[ "$CAPTURE_HOST" == "1" ]]; then
  if sudo -n true 2>/dev/null; then
    echo "[Layer A] Starting host tcpdump (port 443)..."
    sudo -n tcpdump -i any port 443 -w "$THREE_LAYER_DIR/host_capture.pcap" 2>"$THREE_LAYER_DIR/host_capture.log" &
    HOST_PID=$!
    sleep 1
    if ! kill -0 "$HOST_PID" 2>/dev/null; then
      echo "[Layer A] Host tcpdump exited (check $THREE_LAYER_DIR/host_capture.log). Run manually:"
      echo "  sudo tcpdump -i any port 443 -w $THREE_LAYER_DIR/host_capture.pcap"
      HOST_PID=""
    else
      echo "[Layer A] Host capture running (PID $HOST_PID)"
    fi
  else
    echo "[Layer A] Run in another terminal (sudo required):"
    echo "  sudo tcpdump -i any port 443 -w $THREE_LAYER_DIR/host_capture.pcap"
    echo ""
  fi
else
  echo "[Layer A] Host capture skipped (CAPTURE_HOST=0)"
fi

# --- Capture B (VM) + C (Caddy) via packet-capture-v2 ---
export CAPTURE_SKIP_ENVOY=1
export DISABLE_PACKET_CAPTURE="${DISABLE_PACKET_CAPTURE:-0}"
# Ensure Caddy pod capture runs (do not use node-only default for 3-layer)
export CAPTURE_NODE_ONLY=0

# shellcheck source=scripts/lib/packet-capture-v2.sh
source "$LIB/packet-capture-v2.sh"
init_capture_session_v2
start_capture_v2

echo ""
echo "--- Run your ramp now (e.g. ./scripts/run-h3-ramp.sh --collect-steps) ---"
echo "Press Enter when ramp is done to stop captures and collect pcaps..."
read -r

# --- Stop Capture A (host) ---
if [[ -n "$HOST_PID" ]] && kill -0 "$HOST_PID" 2>/dev/null; then
  echo "[Layer A] Stopping host tcpdump (SIGINT)..."
  kill -INT "$HOST_PID" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$HOST_PID" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$HOST_PID" 2>/dev/null && kill -9 "$HOST_PID" 2>/dev/null || true
fi

# --- Stop B+C and analyze (v2) ---
stop_and_analyze_captures_v2

# --- Copy v2 pcaps into 3-layer session dir ---
v2dir="$(packet_capture_dir)"
[[ -f "$v2dir/node-capture.pcap" ]] && cp -f "$v2dir/node-capture.pcap" "$THREE_LAYER_DIR/vm_capture.pcap"
[[ -f "$v2dir/caddy-capture.pcap" ]] && cp -f "$v2dir/caddy-capture.pcap" "$THREE_LAYER_DIR/pod_capture.pcap"
[[ -f "$v2dir/transport-summary.json" ]] && cp -f "$v2dir/transport-summary.json" "$THREE_LAYER_DIR/transport-summary-v2.json"

# --- 3-layer summary ---
echo ""
echo "=== 3-layer capture summary ==="
echo "Pcaps in: $THREE_LAYER_DIR"
echo ""

for label path in \
  "A (host)" "$THREE_LAYER_DIR/host_capture.pcap" \
  "B (VM)"   "$THREE_LAYER_DIR/vm_capture.pcap" \
  "C (pod)"  "$THREE_LAYER_DIR/pod_capture.pcap"; do
  if [[ -f "$path" ]] && [[ -s "$path" ]]; then
    tcp=$(tcpdump -r "$path" -nn 'tcp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    udp=$(tcpdump -r "$path" -nn 'udp port 443' 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "  Layer $label: TCP 443=$tcp, UDP 443=$udp ($path)"
  else
    echo "  Layer $label: no pcap or empty ($path)"
  fi
done

echo ""
echo "Interpretation:"
echo "  - If A has traffic but B does not → macOS/Colima NAT or conntrack drop."
echo "  - If B has traffic but C does not → kube-proxy / MetalLB."
echo "  - Use tshark -r <pcap> -Y quic for QUIC version/ALPN. See docs/TRANSPORT_RESEARCH_SPEC.md."
echo "Done."
