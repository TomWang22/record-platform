#!/usr/bin/env bash
set -euo pipefail

### Run k6 Load Test with Wire-Level Packet Capture
### This script orchestrates packet capture and k6 execution for protocol verification

K6_SCRIPT="${1:-}"
shift || true  # Remove first arg, keep rest for k6

if [[ -z "$K6_SCRIPT" ]] || [[ ! -f "$K6_SCRIPT" ]]; then
  echo "Usage: $0 <k6-script.js> [k6-options...]"
  echo "Example: $0 scripts/load/k6-limit-test-wire-verification.js --duration 60s"
  exit 1
fi

K6_BIN="${K6_BIN:-k6}"
if [[ -f ".k6-build/bin/k6-http3" ]] && echo "$K6_SCRIPT" | grep -q "http3\|limit-test"; then
  K6_BIN=".k6-build/bin/k6-http3"
  echo "Using custom k6-http3 for HTTP/3 support"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAPTURE_DIR=""

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✔ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ✘ $*" >&2; exit 1; }

# Cleanup function
cleanup() {
  if [[ -n "$CAPTURE_DIR" ]] && [[ -d "$CAPTURE_DIR" ]]; then
    say "Stopping wire-level packet capture…"
    "$SCRIPT_DIR/stop-wire-capture-for-k6.sh" "$CAPTURE_DIR"
  fi
}

trap cleanup EXIT INT TERM

say "=== Running k6 with Wire-Level Packet Capture ==="
ok "k6 script: $K6_SCRIPT"
ok "k6 binary: $K6_BIN"

# Calculate test duration for capture timeout
DURATION="${DURATION:-180s}"
DURATION_SEC=$(echo "$DURATION" | sed 's/s$//' | grep -oE '^[0-9]+' || echo "180")
CAPTURE_TIMEOUT=$((DURATION_SEC + 120))  # Add 2 minutes buffer

# Start packet capture
say "Starting wire-level packet capture…"
CAPTURE_DIR=$("$SCRIPT_DIR/start-wire-capture-for-k6.sh")
export CAPTURE_DIR
export CAPTURE_TIMEOUT

if [[ -z "$CAPTURE_DIR" ]] || [[ ! -d "$CAPTURE_DIR" ]]; then
  warn "Packet capture may not have started correctly"
  warn "Continuing with k6 test anyway…"
else
  ok "Packet capture started: $CAPTURE_DIR"
  sleep 3  # Give captures time to start
fi

# Export capture directory for k6 script (if it supports ENABLE_PACKET_CAPTURE)
export ENABLE_PACKET_CAPTURE=true
export CAPTURE_DIR

# Run k6
say "Running k6 load test…"
"$K6_BIN" run "$K6_SCRIPT" "$@"
K6_EXIT_CODE=$?

if [[ $K6_EXIT_CODE -eq 0 ]]; then
  ok "k6 test completed successfully"
else
  warn "k6 test exited with code: $K6_EXIT_CODE"
fi

# Capture is stopped by cleanup trap
# Protocol verification is done by stop-wire-capture-for-k6.sh

say "=== k6 with Wire Capture Complete ==="
if [[ -n "$CAPTURE_DIR" ]] && [[ -d "$CAPTURE_DIR" ]]; then
  ok "Packet captures saved to: $CAPTURE_DIR"
  ok "Analyze with: tshark -r $CAPTURE_DIR/*.pcap -Y \"quic or http2\""
fi

exit $K6_EXIT_CODE
