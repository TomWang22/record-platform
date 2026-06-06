#!/usr/bin/env bash
# Transport Capture v3: Deterministic 3-layer capture with preflight and hard fail on empty.
#
# Phase A – Preflight: host and VM must see traffic to K6_LB_IP; wrong interface = fail.
# Phase B – Blocking capture: start host + VM tcpdump before ramp.
# Phase C – Run ramp: single k6 run at CAPTURE_VUS for CAPTURE_DURATION (strict H3).
# Phase D – Stop capture, copy VM pcap, drain.
# Phase E – Mandatory validation: empty pcap = exit 1; log packet counts per layer.
#
# Usage:
#   ./scripts/run-transport-capture-v3.sh
#   K6_LB_IP=192.168.64.240 CAPTURE_VUS=50 CAPTURE_DURATION=30s ./scripts/run-transport-capture-v3.sh
#   OUT_DIR=/path/to/out ./scripts/run-transport-capture-v3.sh
#
# Env:
#   K6_LB_IP         — MetalLB LB IP (required for preflight). Default 192.168.64.240.
#   CAPTURE_VUS      — VUs for single k6 run (default 50).
#   CAPTURE_DURATION — Duration (default 30s).
#   OUT_DIR          — Output directory (default: packet-capture-<timestamp> in project root).
#   SKIP_HOST_CAPTURE — 1 = skip host tcpdump (e.g. no sudo).
#   SKIP_VM_CAPTURE  — 1 = skip VM capture (e.g. not using Colima).
#   REQUIRE_VM_PCAP — 1 = fail if VM pcap missing/empty when Colima is used (default 0).
#   CAPTURE_V3_SKIP_PREFLIGHT — 1 = skip host/VM preflight (use when cluster is down; capture may be empty).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
CAPTURE_VUS="${CAPTURE_VUS:-50}"
CAPTURE_DURATION="${CAPTURE_DURATION:-30s}"
OUT_DIR="${OUT_DIR:-${TRANSPORT_VALIDATION_OUT:-$ROOT/packet-capture-$(date +%s)}}"
SKIP_HOST_CAPTURE="${SKIP_HOST_CAPTURE:-0}"
SKIP_VM_CAPTURE="${SKIP_VM_CAPTURE:-0}"
REQUIRE_VM_PCAP="${REQUIRE_VM_PCAP:-0}"
CAPTURE_V3_SKIP_PREFLIGHT="${CAPTURE_V3_SKIP_PREFLIGHT:-0}"

K6_BIN="${K6_BIN:-$ROOT/.k6-build/bin/k6-http3}"
SCRIPT="${K6_SCRIPT:-$ROOT/scripts/k6-chaos-test.js}"
export H2_RATE=0
export STRICT_H3=1
export K6_LB_IP

mkdir -p "$OUT_DIR"
echo "=== Capture v3: Preflight ==="
echo "K6_LB_IP=$K6_LB_IP OUT_DIR=$OUT_DIR VUs=$CAPTURE_VUS duration=$CAPTURE_DURATION"
echo ""

# --- Phase A: Preflight ---
# Host: must see at least 5 packets to LB IP. On macOS, "any" can fail; use interface from route get.
if [[ "$SKIP_HOST_CAPTURE" != "1" ]] && [[ "$CAPTURE_V3_SKIP_PREFLIGHT" != "1" ]]; then
  if ! sudo -n true 2>/dev/null; then
    echo "❌ Host preflight requires sudo. Set SKIP_HOST_CAPTURE=1 to skip host capture." >&2
    exit 1
  fi
  HOST_IFACE="any"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    HOST_IFACE=$(route -n get "$K6_LB_IP" 2>/dev/null | awk '/interface: /{print $2}')
    [[ -z "$HOST_IFACE" ]] && HOST_IFACE="any"
  fi
  echo "[Preflight] Host: checking visibility of traffic to $K6_LB_IP (interface=$HOST_IFACE, k6 2 VUs 4s + tcpdump -c 5)..."
  TCPDUMP_EXIT="$OUT_DIR/.tcpdump_preflight_exit"
  TCPDUMP_LOG="$OUT_DIR/.tcpdump_preflight.log"
  rm -f "$TCPDUMP_EXIT" "$TCPDUMP_LOG"
  ( timeout 8 sudo tcpdump -i "$HOST_IFACE" -nn "host $K6_LB_IP" -c 5 2>"$TCPDUMP_LOG"; echo $? > "$TCPDUMP_EXIT" ) &
  TPID=$!
  sleep 1
  if [[ -x "$K6_BIN" ]] || [[ -f "$K6_BIN" ]]; then
    H3_VUS=2 DURATION=4s "$K6_BIN" run "$SCRIPT" 2>/dev/null || true
  else
    sleep 4
  fi
  wait "$TPID" 2>/dev/null || true
  EXIT=$(cat "$TCPDUMP_EXIT" 2>/dev/null || echo "1")
  rm -f "$TCPDUMP_EXIT"
  if [[ "$EXIT" != "0" ]]; then
    echo "❌ Host saw no packets to $K6_LB_IP (tcpdump exit $EXIT)." >&2
    [[ -s "$TCPDUMP_LOG" ]] && echo "   tcpdump log: $TCPDUMP_LOG" >&2
    echo "   Cluster may be down (kubectl unreachable). Start Colima/k3s first, or set CAPTURE_V3_SKIP_PREFLIGHT=1 to skip preflight." >&2
    exit 1
  fi
  rm -f "$TCPDUMP_LOG"
  echo "[Preflight] Host: OK (saw packets to $K6_LB_IP)"
fi

# VM: discover interface and validate port 443 visibility (only if Colima is used)
VM_IFACE=""
if [[ "$SKIP_VM_CAPTURE" != "1" ]] && [[ "$CAPTURE_V3_SKIP_PREFLIGHT" != "1" ]] && command -v colima >/dev/null 2>&1; then
  echo "[Preflight] VM: resolving interface for $K6_LB_IP..."
  VM_IFACE=$(colima ssh -- "ip route get $K6_LB_IP 2>/dev/null" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
  if [[ -z "$VM_IFACE" ]]; then
    VM_IFACE=$(colima ssh -- "ip route get $K6_LB_IP 2>/dev/null" 2>/dev/null | awk '{print $5}')
  fi
  if [[ -z "$VM_IFACE" ]]; then
    echo "❌ VM: could not determine interface for $K6_LB_IP. Aborting." >&2
    exit 1
  fi
  echo "[Preflight] VM: interface=$VM_IFACE, checking port 443 (k6 2 VUs 5s + tcpdump -c 10)..."
  VM_EXIT="$OUT_DIR/.vm_tcpdump_preflight_exit"
  rm -f "$VM_EXIT"
  ( timeout 10 colima ssh -- "sudo tcpdump -i $VM_IFACE -nn port 443 -c 10" 2>/dev/null; echo $? > "$VM_EXIT" ) &
  TPID=$!
  sleep 1
  if [[ -x "$K6_BIN" ]] || [[ -f "$K6_BIN" ]]; then
    H3_VUS=2 DURATION=5s "$K6_BIN" run "$SCRIPT" 2>/dev/null || true
  else
    sleep 5
  fi
  wait "$TPID" 2>/dev/null || true
  EXIT=$(cat "$VM_EXIT" 2>/dev/null || echo "1")
  rm -f "$VM_EXIT"
  if [[ "$EXIT" != "0" ]]; then
    echo "❌ VM saw no packets on port 443 (tcpdump exit $EXIT). Aborting." >&2
    exit 1
  fi
  echo "[Preflight] VM: OK (saw packets on port 443)"
elif [[ "$SKIP_VM_CAPTURE" != "1" ]] && command -v colima >/dev/null 2>&1; then
  # Preflight skipped (e.g. CAPTURE_V3_SKIP_PREFLIGHT=1); still resolve VM interface for capture
  VM_IFACE=$(colima ssh -- "ip route get $K6_LB_IP 2>/dev/null" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
  [[ -z "$VM_IFACE" ]] && VM_IFACE=$(colima ssh -- "ip route get $K6_LB_IP 2>/dev/null" 2>/dev/null | awk '{print $5}')
  [[ -n "$VM_IFACE" ]] && echo "[Preflight] VM: skipped; using interface=$VM_IFACE for capture"
elif [[ "$SKIP_VM_CAPTURE" != "1" ]]; then
  echo "[Preflight] VM: colima not found; skipping VM capture (SKIP_VM_CAPTURE=1 implied)."
  SKIP_VM_CAPTURE=1
fi

# --- Phase B: Start capture (before ramp) ---
HOST_PID=""
VM_PID=""
# Use same interface as preflight on macOS for host capture
HOST_IFACE="${HOST_IFACE:-any}"
if [[ "$(uname -s)" == "Darwin" ]] && [[ "$HOST_IFACE" == "any" ]]; then
  _if=$(route -n get "$K6_LB_IP" 2>/dev/null | awk '/interface: /{print $2}')
  [[ -n "$_if" ]] && HOST_IFACE="$_if"
fi

if [[ "$SKIP_HOST_CAPTURE" != "1" ]]; then
  echo "[Capture] Starting host tcpdump -i $HOST_IFACE port 443 -> $OUT_DIR/host.pcap"
  sudo tcpdump -i "$HOST_IFACE" -nn "port 443" -w "$OUT_DIR/host.pcap" 2>"$OUT_DIR/host_tcpdump.log" &
  HOST_PID=$!
  sleep 1
  if ! kill -0 "$HOST_PID" 2>/dev/null; then
    echo "❌ Host tcpdump failed to start. Check $OUT_DIR/host_tcpdump.log" >&2
    exit 1
  fi
  echo "[Capture] Host capture running (PID $HOST_PID)"
fi

if [[ -n "$VM_IFACE" ]]; then
  echo "[Capture] Starting VM tcpdump -i $VM_IFACE port 443 -> /tmp/vm-capture-v3.pcap"
  colima ssh -- "sudo nohup tcpdump -i $VM_IFACE -nn port 443 -w /tmp/vm-capture-v3.pcap </dev/null >/tmp/vm-tcpdump-v3.log 2>&1 & echo \$!"
  sleep 2
  # Ensure tcpdump is running in VM (we can't easily check PID from here, so rely on preflight and sleep)
  echo "[Capture] VM capture started (drain 3s before ramp)"
  sleep 3
fi

# --- Phase C: Run ramp ---
if [[ ! -x "$K6_BIN" ]] && [[ ! -f "$K6_BIN" ]]; then
  echo "❌ k6-http3 not found at $K6_BIN. Build with: ./scripts/build-k6-http3.sh" >&2
  [[ -n "$HOST_PID" ]] && kill -INT "$HOST_PID" 2>/dev/null || true
  exit 1
fi
echo "=== Running ramp (VUs=$CAPTURE_VUS duration=$CAPTURE_DURATION) ==="
export H3_VUS="$CAPTURE_VUS"
export DURATION="$CAPTURE_DURATION"
"$K6_BIN" run "$SCRIPT" 2>/dev/null || true

# --- Phase D: Stop capture ---
echo "=== Stopping capture ==="
if [[ -n "$HOST_PID" ]] && kill -0 "$HOST_PID" 2>/dev/null; then
  kill -INT "$HOST_PID" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$HOST_PID" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$HOST_PID" 2>/dev/null || true
fi

if [[ -n "$VM_IFACE" ]]; then
  colima ssh -- "sudo pkill -INT tcpdump 2>/dev/null; sleep 2; sudo pkill -9 tcpdump 2>/dev/null" 2>/dev/null || true
  sleep 2
  colima ssh -- "cat /tmp/vm-capture-v3.pcap 2>/dev/null" > "$OUT_DIR/vm.pcap" 2>/dev/null || true
  colima ssh -- "rm -f /tmp/vm-capture-v3.pcap /tmp/vm-tcpdump-v3.log" 2>/dev/null || true
fi

sleep 2

# --- Phase E: Mandatory validation (empty pcap = hard failure) ---
FAILED=0

if [[ "$SKIP_HOST_CAPTURE" != "1" ]]; then
  if [[ ! -s "$OUT_DIR/host.pcap" ]]; then
    echo "❌ Host pcap empty or missing. Capture failed." >&2
    FAILED=1
  else
    HOST_COUNT=$(tcpdump -r "$OUT_DIR/host.pcap" -nn 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "[Validate] L1 (host): $HOST_COUNT packets"
  fi
fi

if [[ -n "$VM_IFACE" ]]; then
  if [[ ! -s "$OUT_DIR/vm.pcap" ]]; then
    echo "❌ VM pcap empty or missing." >&2
    [[ "$REQUIRE_VM_PCAP" == "1" ]] && FAILED=1
  else
    VM_COUNT=$(tcpdump -r "$OUT_DIR/vm.pcap" -nn 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "[Validate] L2 (VM):   $VM_COUNT packets"
    [[ "$REQUIRE_VM_PCAP" == "1" ]] && [[ "$VM_COUNT" -eq 0 ]] && FAILED=1
  fi
fi

if [[ "$FAILED" -eq 1 ]]; then
  echo "Capture v3 failed validation. Exiting 1." >&2
  exit 1
fi

# Optional: run transport validator on best pcap
VALIDATOR="$ROOT/scripts/lib/transport_validator.py"
PCAP=""
for c in "$OUT_DIR/host.pcap" "$OUT_DIR/vm.pcap"; do
  if [[ -f "$c" ]] && [[ -s "$c" ]]; then
    PCAP="$c"
    break
  fi
done
if [[ -n "$PCAP" ]] && [[ -f "$VALIDATOR" ]]; then
  echo "[Validate] Running transport_validator.py on $PCAP"
  python3 "$VALIDATOR" "$PCAP" > "$OUT_DIR/transport_validation.json" 2>/dev/null || true
  if python3 -c "import json; d=json.load(open('$OUT_DIR/transport_validation.json')); exit(0 if d.get('valid') else 1)" 2>/dev/null; then
    echo "✅ transport_validated=true (QUIC + h3 ALPN confirmed)"
  else
    echo "transport_validated=false (see $OUT_DIR/transport_validation.json)"
  fi
fi

echo "✅ Capture v3 complete. Pcaps and validation in $OUT_DIR"
