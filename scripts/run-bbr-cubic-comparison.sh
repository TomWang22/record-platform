#!/usr/bin/env bash
# BBR vs CUBIC knee comparison under the same capture framework.
# Runs ramp with BBR, then with CUBIC, optionally with 3-layer capture for each.
# Produces transport_comparison_input.json and bbr_cubic_comparison_report.md.
#
# Usage:
#   ./scripts/run-bbr-cubic-comparison.sh
#   ./scripts/run-bbr-cubic-comparison.sh --capture   # run 3-layer capture during both ramps
#
# Env:
#   OUT_DIR     — output dir (default $ROOT or TRANSPORT_VALIDATION_OUT)
#   RAMP_OPTS   — passed to run-h3-ramp.sh (e.g. --start 10 --step 10 --max 200)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-${TRANSPORT_VALIDATION_OUT:-$ROOT}}"
CAPTURE=""
RAMP_ARGS=()
for a in "$@"; do
  if [[ "$a" == "--capture" ]]; then CAPTURE=1; else RAMP_ARGS+=("$a"); fi
done

export K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
export H2_RATE=0
export STRICT_H3=1
export SKIP_HEALTH_GATE=1

KNEED="$ROOT/scripts/lib/knee_detection.py"
REPORT_BUILDER="$ROOT/scripts/lib/build_ceiling_report.py"
LIB="$(cd "$ROOT/scripts/lib" && pwd)"

mkdir -p "$OUT_DIR"

echo "=== BBR vs CUBIC comparison ==="
echo "Out dir: $OUT_DIR"
[[ -n "$CAPTURE" ]] && echo "Capture: 3-layer capture during both ramps"
echo ""

# Apply BBR (if script exists)
if [[ -x "$ROOT/scripts/colima-quic-sysctl.sh" ]]; then
  echo "Applying BBR..."
  "$ROOT/scripts/colima-quic-sysctl.sh" 2>/dev/null || true
else
  echo "colima-quic-sysctl.sh not found; continuing with current sysctl (may already be BBR)."
fi

# --- BBR ramp ---
rm -f "$OUT_DIR/ramp_steps.json" "$OUT_DIR/ramp_steps.jsonl"
export RAMP_STEPS_FILE="$OUT_DIR/ramp_steps.json" RAMP_STEPS_STREAM="$OUT_DIR/ramp_steps.jsonl"

if [[ -n "$CAPTURE" ]]; then
  export CAPTURE_SKIP_ENVOY=1 CAPTURE_NODE_ONLY=0 DISABLE_PACKET_CAPTURE=0
  export CAPTURE_COPY_DIR="$OUT_DIR/bbr_captures"
  mkdir -p "$CAPTURE_COPY_DIR"
  # shellcheck source=scripts/lib/packet-capture-v2.sh
  source "$LIB/packet-capture-v2.sh"
  init_capture_session_v2
  start_capture_v2
fi

echo "Ramp 1 (BBR)..."
"$ROOT/scripts/run-h3-ramp.sh" --collect-steps "${RAMP_ARGS[@]}" 2>/dev/null || true

if [[ -n "$CAPTURE" ]]; then
  stop_and_analyze_captures_v2
fi

cp -f "$OUT_DIR/ramp_steps.json" "$OUT_DIR/ramp_steps_bbr.json" 2>/dev/null || true
BBR_MAX=$(python3 -c "import json; d=json.load(open('$OUT_DIR/ramp_steps_bbr.json')); print(max((s.get('rps') or 0) for s in d) if d else 0)" 2>/dev/null || echo "0")
python3 "$KNEED" "$OUT_DIR/ramp_steps_bbr.json" > "$OUT_DIR/knee_bbr.json" 2>/dev/null || true
BBR_KNEE_VUS=$(python3 -c "import json; d=json.load(open('$OUT_DIR/knee_bbr.json')); k=d.get('knee'); print(k.get('knee_vus') if k else '')" 2>/dev/null || echo "")
BBR_KNEE_RPS=$(python3 -c "import json; d=json.load(open('$OUT_DIR/knee_bbr.json')); k=d.get('knee'); print(k.get('knee_rps') if k else '')" 2>/dev/null || echo "")

# Apply CUBIC
if [[ -x "$ROOT/scripts/colima-quic-sysctl.sh" ]]; then
  echo "Applying CUBIC (COLIMA_QUIC_SKIP_BBR=1)..."
  COLIMA_QUIC_SKIP_BBR=1 "$ROOT/scripts/colima-quic-sysctl.sh" 2>/dev/null || true
fi
rm -f "$OUT_DIR/ramp_steps.json" "$OUT_DIR/ramp_steps.jsonl"
export RAMP_STEPS_FILE="$OUT_DIR/ramp_steps.json" RAMP_STEPS_STREAM="$OUT_DIR/ramp_steps.jsonl"

# --- CUBIC ramp ---
if [[ -n "$CAPTURE" ]]; then
  export CAPTURE_COPY_DIR="$OUT_DIR/cubic_captures"
  mkdir -p "$CAPTURE_COPY_DIR"
  init_capture_session_v2
  start_capture_v2
fi

echo "Ramp 2 (CUBIC)..."
"$ROOT/scripts/run-h3-ramp.sh" --collect-steps "${RAMP_ARGS[@]}" 2>/dev/null || true

if [[ -n "$CAPTURE" ]]; then
  stop_and_analyze_captures_v2
fi

cp -f "$OUT_DIR/ramp_steps.json" "$OUT_DIR/ramp_steps_cubic.json" 2>/dev/null || true
CUBIC_MAX=$(python3 -c "import json; d=json.load(open('$OUT_DIR/ramp_steps_cubic.json')); print(max((s.get('rps') or 0) for s in d) if d else 0)" 2>/dev/null || echo "0")
python3 "$KNEED" "$OUT_DIR/ramp_steps_cubic.json" > "$OUT_DIR/knee_cubic.json" 2>/dev/null || true
CUBIC_KNEE_VUS=$(python3 -c "import json; d=json.load(open('$OUT_DIR/knee_cubic.json')); k=d.get('knee'); print(k.get('knee_vus') if k else '')" 2>/dev/null || echo "")
CUBIC_KNEE_RPS=$(python3 -c "import json; d=json.load(open('$OUT_DIR/knee_cubic.json')); k=d.get('knee'); print(k.get('knee_rps') if k else '')" 2>/dev/null || echo "")

# Comparison
DELTA=$(python3 -c "
b=float('$BBR_MAX'); c=float('$CUBIC_MAX')
print(round((c-b)/b*100, 2) if b else 0)
" 2>/dev/null || echo "0")

echo "{\"bbr_vs_cubic_delta_percent\": $DELTA, \"bbr_max_rps\": $BBR_MAX, \"cubic_max_rps\": $CUBIC_MAX, \"bbr_knee_vus\": ${BBR_KNEE_VUS:-null}, \"bbr_knee_rps\": ${BBR_KNEE_RPS:-null}, \"cubic_knee_vus\": ${CUBIC_KNEE_VUS:-null}, \"cubic_knee_rps\": ${CUBIC_KNEE_RPS:-null}}" > "$OUT_DIR/transport_comparison_input.json"

# Publishable comparison report
cat > "$OUT_DIR/bbr_cubic_comparison_report.md" << EOF
# BBR vs CUBIC Comparison

| Metric | BBR | CUBIC |
|--------|-----|-------|
| Max RPS | $BBR_MAX | $CUBIC_MAX |
| Knee VUs | ${BBR_KNEE_VUS:-—} | ${CUBIC_KNEE_VUS:-—} |
| Knee RPS | ${BBR_KNEE_RPS:-—} | ${CUBIC_KNEE_RPS:-—} |

**Delta (CUBIC − BBR):** ${DELTA}%

- Delta > 0: CUBIC higher throughput under this load.
- Delta < 0: BBR higher throughput.

Captures: \`$OUT_DIR/bbr_captures/\`, \`$OUT_DIR/cubic_captures/\` (if --capture).
EOF

echo ""
echo "=== Comparison ==="
cat "$OUT_DIR/transport_comparison_input.json"
echo ""
echo "Report: $OUT_DIR/bbr_cubic_comparison_report.md"

# Refresh ceiling report if existing (use BBR ramp as primary)
if [[ -f "$OUT_DIR/ramp_steps_bbr.json" ]]; then
  cp -f "$OUT_DIR/ramp_steps_bbr.json" "$OUT_DIR/ramp_steps.json"
  python3 "$KNEED" "$OUT_DIR/ramp_steps.json" > "$OUT_DIR/knee_result.json" 2>/dev/null || true
  python3 "$ROOT/scripts/lib/bottleneck_classifier.py" "$OUT_DIR/ramp_steps.json" "$OUT_DIR/transport_validation.json" > "$OUT_DIR/bottleneck_result.json" 2>/dev/null || true
  python3 "$REPORT_BUILDER" "$OUT_DIR" 2>/dev/null || true
fi

echo ""
echo "Done."
