#!/usr/bin/env bash
# Transport Benchmarking V5: Ramp H3 VUs until break (error_rate > 1% or timeout_rate > 1% or p95 > 5×avg).
# Usage: ./scripts/run-h3-ramp.sh [--start N] [--step N] [--max N] [--collect-steps]
# --collect-steps: write ramp_steps.json for knee/report after ramp.
# Output: transport-summary.json per run; on break writes h3-capacity-report.json and exits.
#
# From host: set K6_LB_IP to your MetalLB LB IP (e.g. 192.168.64.240) so k6 hits QUIC on the same
# path as "H2_RATE=0 STRICT_H3=1 K6_LB_IP=... k6 run ...". If unset, defaults to 192.168.64.240.
# In-cluster: unset K6_LB_IP so k6 uses ClusterIP FQDN.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

K6_BIN="${K6_BIN:-$ROOT/.k6-build/bin/k6-http3}"
SCRIPT="${K6_SCRIPT:-$ROOT/scripts/k6-chaos-test.js}"
SUMMARY_FILE="${TRANSPORT_SUMMARY_FILE:-$ROOT/transport-summary.json}"
REPORT_FILE="${H3_CAPACITY_REPORT:-$ROOT/h3-capacity-report.json}"
RAMP_STEPS_FILE="${RAMP_STEPS_FILE:-$ROOT/ramp_steps.json}"
RAMP_STEPS_STREAM="${RAMP_STEPS_STREAM:-$ROOT/ramp_steps.jsonl}"
EVALUATE_SCRIPT="$ROOT/scripts/lib/evaluate-breakpoint.py"
COLLECT_STEPS=""

# Same env as manual run: LB IP required from host so QUIC handshake targets MetalLB, not DNS.
K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
export K6_LB_IP
export H2_RATE=0
export STRICT_H3=1

START_VUS="${START_VUS:-10}"
STEP="${STEP:-10}"
MAX_VUS="${MAX_VUS:-200}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --start) START_VUS="$2"; shift 2 ;;
    --step)  STEP="$2"; shift 2 ;;
    --max)   MAX_VUS="$2"; shift 2 ;;
    --collect-steps) COLLECT_STEPS=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -x "$K6_BIN" ]] && [[ ! -f "$K6_BIN" ]]; then
  echo "k6-http3 not found at $K6_BIN. Build with: ./scripts/build-k6-http3.sh" >&2
  exit 1
fi
if [[ ! -f "$EVALUATE_SCRIPT" ]]; then
  echo "evaluate-breakpoint.py not found at $EVALUATE_SCRIPT" >&2
  exit 1
fi

# Pre-ramp health gate: nodes Ready, Caddy Running, svc 443, QUIC probe 200
if [[ "${SKIP_HEALTH_GATE:-0}" != "1" ]] && [[ -x "$ROOT/scripts/pre-ramp-health-gate.sh" ]]; then
  "$ROOT/scripts/pre-ramp-health-gate.sh" || exit 1
  echo ""
fi

echo "=== H3 ramp: VUs from $START_VUS to $MAX_VUS step $STEP ==="
echo "Env (must match manual run): K6_LB_IP=$K6_LB_IP H2_RATE=$H2_RATE STRICT_H3=$STRICT_H3"
echo "Summary per run: $SUMMARY_FILE"
echo "Breakpoint: error_rate > 1% or timeout_rate > 1% or p95 > 5×avg"
echo ""

LAST_OK_VUS=""
LAST_OK_RPS=""
LAST_OK_P95=""
BREAK_VUS=""
BREAK_REASON=""

for V in $(seq "$START_VUS" "$STEP" "$MAX_VUS"); do
  echo "Running H3 at $V VUs (K6_LB_IP=$K6_LB_IP)..."
  export H3_VUS="$V"
  "$K6_BIN" run "$SCRIPT" 2>/dev/null || true
  # handleSummary runs before exit, so we may have transport-summary.json even when k6 exits non-zero (e.g. threshold)
  # k6 writes to cwd ($ROOT); if SUMMARY_FILE is elsewhere (e.g. TRANSPORT_SUMMARY_FILE set by CLI), copy it
  if [[ -f "$ROOT/transport-summary.json" ]] && [[ "$SUMMARY_FILE" != "$ROOT/transport-summary.json" ]]; then
    cp "$ROOT/transport-summary.json" "$SUMMARY_FILE"
  fi

  if [[ ! -f "$SUMMARY_FILE" ]]; then
    echo "transport-summary.json not produced at $SUMMARY_FILE" >&2
    BREAK_VUS="$V"
    BREAK_REASON="no_summary"
    break
  fi

  if python3 "$EVALUATE_SCRIPT" "$SUMMARY_FILE"; then
    rps=$(python3 -c "import json; d=json.load(open('$SUMMARY_FILE')); print(d.get('rps', 0))" 2>/dev/null || echo "0")
    p95=$(python3 -c "import json; d=json.load(open('$SUMMARY_FILE')); print((d.get('latency_ms') or {}).get('p95', 0))" 2>/dev/null || echo "0")
    LAST_OK_VUS="$V"
    LAST_OK_RPS="$rps"
    LAST_OK_P95="$p95"
  else
    echo "H3 broke at $V VUs (evaluate-breakpoint.py failed)."
    BREAK_VUS="$V"
    BREAK_REASON="error_rate_or_timeout_or_p95"
    [[ -z "$COLLECT_STEPS" ]] && break
    # With --collect-steps we still record this step then break
  fi

  if [[ -n "$COLLECT_STEPS" ]] && [[ -f "$SUMMARY_FILE" ]]; then
    step_json=$(python3 -c "
import json
d = json.load(open('$SUMMARY_FILE'))
print(json.dumps({
  \"vus\": $V,
  \"rps\": d.get('rps', 0),
  \"latency_ms\": d.get('latency_ms', {})
}))
" 2>/dev/null || echo "{}")
    echo "$step_json" >> "$RAMP_STEPS_STREAM"
  fi

  [[ -n "$BREAK_VUS" ]] && [[ -z "$COLLECT_STEPS" ]] && break
done

# If collecting steps, produce ramp_steps.json array
if [[ -n "$COLLECT_STEPS" ]] && [[ -f "$RAMP_STEPS_STREAM" ]]; then
  mkdir -p "$(dirname "$RAMP_STEPS_FILE")"
  if command -v jq >/dev/null 2>&1; then
    jq -s . "$RAMP_STEPS_STREAM" > "$RAMP_STEPS_FILE" 2>/dev/null || true
  else
    python3 -c "
import json
steps = []
with open('$RAMP_STEPS_STREAM') as f:
    for line in f:
        line = line.strip()
        if line:
            try: steps.append(json.loads(line))
            except: pass
with open('$RAMP_STEPS_FILE', 'w') as f:
    json.dump(steps, f, indent=2)
"
  fi
  rm -f "$RAMP_STEPS_STREAM"
  echo "Collected steps -> $RAMP_STEPS_FILE"
fi

# Final capacity report
  if [[ -n "$BREAK_VUS" ]]; then
  p95_json="${LAST_OK_P95:-null}"
  [[ -z "$p95_json" ]] && p95_json="null"
  report=$(cat <<EOF
{
  "h3_max_vus": ${LAST_OK_VUS:-0},
  "h3_max_rps": ${LAST_OK_RPS:-0},
  "break_at_vus": $BREAK_VUS,
  "failure_threshold": "$BREAK_REASON",
  "p95_at_last_ok_ms": $p95_json
}
EOF
)
  echo "$report" > "$REPORT_FILE"
  echo ""
  echo "=== H3 capacity report ==="
  cat "$REPORT_FILE"
  echo ""
  echo "Written to: $REPORT_FILE"
  exit 1
else
  echo ""
  echo "H3 did not break up to $MAX_VUS VUs. Last OK: ${LAST_OK_VUS:-none} VUs, ${LAST_OK_RPS:-0} rps."
  exit 0
fi
