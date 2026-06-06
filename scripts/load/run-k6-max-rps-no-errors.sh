#!/usr/bin/env bash
# Find max RPS with zero errors for HTTP/2 and HTTP/3 separately. When the protocol under test errors, we stop
# and record that RPS as the limit (max = last RPS with no errors). Output: protocol-max-rps-report.json
# with 5 chart datasets: http2_latency, http3_latency, http2_max_rps, http3_max_rps, comparison (queue/same-RPS).
#
# Usage: SUITE_LOG_DIR=/path K6_CA_ABSOLUTE=/path/to/ca.pem [RPS_STEP=10] [RPS_MAX=300] [STEP_DURATION=20s] ./scripts/load/run-k6-max-rps-no-errors.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$SCRIPT_DIR"

SUITE_LOG_DIR="${SUITE_LOG_DIR:-$REPO_ROOT/bench_logs/suite-logs-$(date +%s)}"
K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
BASE_URL="${BASE_URL:-https://record.local:30443}"
RPS_STEP="${RPS_STEP:-10}"
RPS_MAX="${RPS_MAX:-300}"
STEP_DURATION="${STEP_DURATION:-20s}"
mkdir -p "$SUITE_LOG_DIR"
export SSL_CERT_FILE="$K6_CA_ABSOLUTE"
export BASE_URL

# Parse k6 stdout for p50, p95, p99 and http_reqs (for chart series)
parse_k6_step() {
  local log="$1"
  local p50="" p95="" p99="" tps=""
  [[ -f "$log" ]] || { echo "{}"; return; }
  p50=$(grep -oE 'p\(50\)=[0-9.]+ms' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  p95=$(grep -oE 'p\(95\)=[0-9.]+ms' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  p99=$(grep -oE 'p\(99\)=[0-9.]+ms' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  tps=$(grep -oE 'http_reqs[^=]*=[0-9.]+' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  echo "{\"p50_ms\":${p50:-null},\"p95_ms\":${p95:-null},\"p99_ms\":${p99:-null},\"tps\":${tps:-null}}"
}

# --- HTTP/2: step RPS until first error (then stop; max = previous RPS)
echo "  → Max RPS (no errors): HTTP/2..."
H2_MAX_RPS=0
H2_STEPS="[]"
H2_LAST_LATENCY="{}"
for r in $(seq "$RPS_STEP" "$RPS_STEP" "$RPS_MAX"); do
  log="$SUITE_LOG_DIR/k6-http2-max-rps-${r}.log"
  if k6 run -e RATE="$r" -e DURATION="$STEP_DURATION" -e BASE_URL="$BASE_URL" \
    "$LOAD_DIR/k6-find-max-rps-http2.js" > "$log" 2>&1; then
    H2_MAX_RPS=$r
    H2_LAST_LATENCY=$(parse_k6_step "$log")
    # Append step to JSON array (build manually for portability)
    _p50=$(echo "$H2_LAST_LATENCY" | grep -oE '"p50_ms":[0-9.]+' | cut -d: -f2)
    _p95=$(echo "$H2_LAST_LATENCY" | grep -oE '"p95_ms":[0-9.]+' | cut -d: -f2)
    _p99=$(echo "$H2_LAST_LATENCY" | grep -oE '"p99_ms":[0-9.]+' | cut -d: -f2)
    if [[ "$H2_STEPS" == "[]" ]]; then
      H2_STEPS="[{\"rps\":$r,\"p50_ms\":${_p50:-null},\"p95_ms\":${_p95:-null},\"p99_ms\":${_p99:-null}}]"
    else
      H2_STEPS="${H2_STEPS%]},{\"rps\":$r,\"p50_ms\":${_p50:-null},\"p95_ms\":${_p95:-null},\"p99_ms\":${_p99:-null}}]"
    fi
  else
    echo "    HTTP/2: first error at ${r} req/s → max RPS (no errors) = $H2_MAX_RPS"
    break
  fi
done
[[ $H2_MAX_RPS -eq 0 ]] && echo "    HTTP/2: no successful step (check k6 and BASE_URL)"

# --- HTTP/3: same (xk6-http3)
K6_HTTP3_BIN=""
for c in "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.k6-build/k6-http3"; do
  [[ -x "$c" ]] && K6_HTTP3_BIN="$c" && break
done
H3_MAX_RPS=0
H3_STEPS="[]"
H3_LAST_LATENCY="{}"
if [[ -n "$K6_HTTP3_BIN" ]] && [[ -f "$LOAD_DIR/k6-find-max-rps-http3.js" ]]; then
  echo "  → Max RPS (no errors): HTTP/3..."
  # HTTP/3 often lower ceiling; step smaller or same
  for r in $(seq "$RPS_STEP" "$RPS_STEP" "$RPS_MAX"); do
    log="$SUITE_LOG_DIR/k6-http3-max-rps-${r}.log"
    if env BASE_URL="$BASE_URL" SSL_CERT_FILE="$K6_CA_ABSOLUTE" \
      "$K6_HTTP3_BIN" run -e RATE="$r" -e DURATION="$STEP_DURATION" -e BASE_URL="$BASE_URL" \
      "$LOAD_DIR/k6-find-max-rps-http3.js" > "$log" 2>&1; then
      H3_MAX_RPS=$r
      H3_LAST_LATENCY=$(parse_k6_step "$log")
      _p50=$(echo "$H3_LAST_LATENCY" | grep -oE '"p50_ms":[0-9.]+' | cut -d: -f2)
      _p95=$(echo "$H3_LAST_LATENCY" | grep -oE '"p95_ms":[0-9.]+' | cut -d: -f2)
      _p99=$(echo "$H3_LAST_LATENCY" | grep -oE '"p99_ms":[0-9.]+' | cut -d: -f2)
      if [[ "$H3_STEPS" == "[]" ]]; then
        H3_STEPS="[{\"rps\":$r,\"p50_ms\":${_p50:-null},\"p95_ms\":${_p95:-null},\"p99_ms\":${_p99:-null}}]"
      else
        H3_STEPS="${H3_STEPS%]},{\"rps\":$r,\"p50_ms\":${_p50:-null},\"p95_ms\":${_p95:-null},\"p99_ms\":${_p99:-null}}]"
      fi
    else
      echo "    HTTP/3: first error at ${r} req/s → max RPS (no errors) = $H3_MAX_RPS"
      break
    fi
  done
  [[ $H3_MAX_RPS -eq 0 ]] && echo "    HTTP/3: no successful step or xk6-http3 failed"
else
  echo "  ⚠️  xk6-http3 not found; skipping HTTP/3 max RPS"
fi

# --- Comparison: at same RPS (min of the two maxes or 50), latency H2 vs H3 (from last successful steps or a mid point)
COMPARISON_RPS=$(( H2_MAX_RPS < H3_MAX_RPS ? H2_MAX_RPS : H3_MAX_RPS ))
[[ $COMPARISON_RPS -eq 0 ]] && COMPARISON_RPS=50
# We already have latency at various RPS in steps; pick closest to COMPARISON_RPS from H2_STEPS and H3_STEPS (or use last)
H2_AT_CMP="$H2_LAST_LATENCY"
H3_AT_CMP="$H3_LAST_LATENCY"

# --- Write 5-chart report (D3/GraphQL-friendly structure)
REPORT="$SUITE_LOG_DIR/protocol-max-rps-report.json"
printf '%s\n' "{
  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"step_duration\": \"$STEP_DURATION\",
  \"rps_step\": $RPS_STEP,
  \"rps_max\": $RPS_MAX,
  \"chart_1_http2_latency\": {
    \"description\": \"HTTP/2 latency (p50, p95, p99) per RPS step until first error\",
    \"steps\": $H2_STEPS,
    \"at_max_rps\": $H2_LAST_LATENCY,
    \"max_rps_no_errors\": $H2_MAX_RPS
  },
  \"chart_2_http3_latency\": {
    \"description\": \"HTTP/3 latency (p50, p95, p99) per RPS step until first error\",
    \"steps\": $H3_STEPS,
    \"at_max_rps\": $H3_LAST_LATENCY,
    \"max_rps_no_errors\": $H3_MAX_RPS
  },
  \"chart_3_http2_max_rps\": {
    \"description\": \"HTTP/2 max RPS with zero errors (run stops when this protocol errors)\",
    \"max_rps_no_errors\": $H2_MAX_RPS,
    \"latency_at_max\": $H2_LAST_LATENCY
  },
  \"chart_4_http3_max_rps\": {
    \"description\": \"HTTP/3 max RPS with zero errors (run stops when this protocol errors)\",
    \"max_rps_no_errors\": $H3_MAX_RPS,
    \"latency_at_max\": $H3_LAST_LATENCY
  },
  \"chart_5_comparison\": {
    \"description\": \"Comparison at same RPS; queue/deeper semantics (latency H2 vs H3)\",
    \"comparison_rps\": $COMPARISON_RPS,
    \"http2_latency\": $H2_AT_CMP,
    \"http3_latency\": $H3_AT_CMP,
    \"http2_max_rps\": $H2_MAX_RPS,
    \"http3_max_rps\": $H3_MAX_RPS
  }
}" > "$REPORT"
echo "✅ Max RPS (no errors) report written to $REPORT (5 charts: latency H2, latency H3, max RPS H2, max RPS H3, comparison)"
