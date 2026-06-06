#!/usr/bin/env bash
# Pre-ramp transport gate: 5-second sustained strict H3 micro-test via k6.
# Replaces burst curl probes with the same transport conditions as the ramp (no NAT churn).
#
# Success: h3_protocol_mismatch = 0, h3_timeout = 0, throughput > 0
# (Checked via transport-summary.json: error_rate ≈ 0, timeout_rate ≈ 0, rps > 0.)
#
# Usage:
#   ./scripts/pre-ramp-transport-gate.sh
#   K6_LB_IP=192.168.64.240 ./scripts/pre-ramp-transport-gate.sh
#
# Env:
#   K6_LB_IP   — LB IP for QUIC (default 192.168.64.240)
#   SKIP_INFRA — set to 1 to skip pre-ramp-health-gate.sh (nodes/Caddy/443/curl probe)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
export H2_RATE=0
export STRICT_H3=1

K6_BIN="${K6_BIN:-$ROOT/.k6-build/bin/k6-http3}"
SCRIPT="${K6_SCRIPT:-$ROOT/scripts/k6-chaos-test.js}"
GATE_SUMMARY="${GATE_SUMMARY:-$ROOT/transport-summary-gate.json}"

fail() {
  echo "❌ Pre-ramp transport gate failed: $*" >&2
  echo "   Fix QUIC path before ramp. See docs/TRANSPORT_RESEARCH_SPEC.md." >&2
  exit 1
}

ok() { echo "✅ $*"; }

echo "=== Pre-ramp transport gate (5s sustained H3) ==="

# Optional: run infra checks first (nodes, Caddy, 443, curl QUIC probe)
if [[ "${SKIP_INFRA:-0}" != "1" ]] && [[ -x "$ROOT/scripts/pre-ramp-health-gate.sh" ]]; then
  export QUIC_PROBE_REPEAT="${QUIC_PROBE_REPEAT:-1}"
  "$ROOT/scripts/pre-ramp-health-gate.sh" || exit 1
  echo ""
fi

if [[ ! -x "$K6_BIN" ]] && [[ ! -f "$K6_BIN" ]]; then
  fail "k6-http3 not found at $K6_BIN. Build with: ./scripts/build-k6-http3.sh"
fi

echo "Running: H2_RATE=0 STRICT_H3=1 H3_VUS=1 DURATION=5s K6_LB_IP=$K6_LB_IP"
rm -f "$GATE_SUMMARY"
# k6 writes summary files to cwd; we need transport-summary.json → copy to GATE_SUMMARY after run
export H3_VUS=1
export DURATION=5s
"$K6_BIN" run "$SCRIPT" 2>/dev/null || true

# handleSummary writes transport-summary.json to cwd
if [[ -f "$ROOT/transport-summary.json" ]]; then
  cp -f "$ROOT/transport-summary.json" "$GATE_SUMMARY"
fi

if [[ ! -f "$GATE_SUMMARY" ]] || [[ "$(cat "$GATE_SUMMARY" 2>/dev/null)" == "{}" ]]; then
  fail "No transport-summary from k6 (gate run may have crashed or produced no output)."
fi

# Success: rps > 0, error_rate ≈ 0, timeout_rate ≈ 0 (matches ramp conditions)
rps=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('rps', 0))
except Exception:
    print(0)
" "$GATE_SUMMARY" 2>/dev/null || echo "0")
err=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('error_rate', 1))
except Exception:
    print(1)
" "$GATE_SUMMARY" 2>/dev/null || echo "1")
tout=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('timeout_rate', 1))
except Exception:
    print(1)
" "$GATE_SUMMARY" 2>/dev/null || echo "1")

# Allow negligible rates (e.g. floating point) as 0
fail_reason=$(python3 -c "
rps = float('$rps')
err = float('$err')
tout = float('$tout')
if rps <= 0:
    print('throughput')
    exit(1)
if err >= 0.01:
    print('error_rate')
    exit(2)
if tout >= 0.01:
    print('timeout_rate')
    exit(3)
exit(0)
" 2>/dev/null)
exc=$?
# Trim whitespace/newline so case matches (Python print adds newline)
fail_reason="$(printf '%s' "$fail_reason" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [[ $exc -ne 0 ]]; then
  case "$fail_reason" in
    throughput) fail "throughput is 0 (no successful H3 requests)." ;;
    error_rate) fail "error_rate >= 1% (h3_protocol_mismatch or non-200)." ;;
    timeout_rate) fail "timeout_rate >= 1% (QUIC stalls)." ;;
    *) fail "gate check failed (rps=$rps error_rate=$err timeout_rate=$tout)." ;;
  esac
fi

ok "Transport gate passed: rps=$rps, error_rate=$err, timeout_rate=$tout"
echo "=== Safe to run ramp (same transport conditions) ==="
