#!/usr/bin/env bash
# Run same k6 workload over HTTP/2 (standard k6) and HTTP/3 (xk6-http3), write protocol-comparison.json.
# Usage: SUITE_LOG_DIR=/path [K6_CA_ABSOLUTE=...] [BASE_URL=...] ./scripts/load/run-k6-protocol-comparison.sh
# Observation deck can show protocol_comparison from preflight-results.json when this is run.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$SCRIPT_DIR"

SUITE_LOG_DIR="${SUITE_LOG_DIR:-$REPO_ROOT/bench_logs/suite-logs-$(date +%s)}"
K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
# Strict TLS: use hostname (record.local) so cert SAN matches; pin to LB IP via K6_RESOLVE
if [[ -z "${BASE_URL:-}" ]]; then
  LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -n "$LB_IP" ]]; then
    BASE_URL="https://record.local:443"
    export K6_RESOLVE="record.local:443:${LB_IP}"
  else
    BASE_URL="https://record.local:30443"
  fi
fi
DURATION="${K6_PROTOCOL_DURATION:-30s}"
# HTTP/3 (QUIC/UDP) stalls under concurrency on macOS+Colima; use fewer VUs
K6_HTTP3_VUS="${K6_HTTP3_VUS:-5}"
mkdir -p "$SUITE_LOG_DIR"

# Prevent k6 built-in env (K6_VUS, K6_DURATION) from overriding script scenarios
unset K6_VUS K6_DURATION
export SSL_CERT_FILE="${K6_CA_ABSOLUTE}"
export BASE_URL

# Parse k6 log for tps, p95, p99 (for observation deck latency / knee curve)
parse_k6_log() {
  local log="$1"
  local tps="" p95="" p99=""
  [[ -f "$log" ]] || { echo "{}"; return; }
  tps=$(grep -oE 'http_reqs\.*[^=]*=[0-9.]+' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  p95=$(grep -oE 'p\(95\)=[0-9.]+ms' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  p99=$(grep -oE 'p\(99\)=[0-9.]+ms' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)
  if [[ -z "$tps" ]]; then
    tps=$(grep -oE 'iterations[^0-9]*[0-9]+' "$log" 2>/dev/null | tail -1 | grep -oE '[0-9]+' || true)
  fi
  echo "{\"tps\":${tps:-null},\"p95_ms\":${p95:-null},\"p99_ms\":${p99:-null}}"
}

# 1) HTTP/2 (standard k6)
echo "  → k6 protocol comparison: HTTP/2..."
if command -v k6 >/dev/null 2>&1 && [[ -f "$LOAD_DIR/k6-reads.js" ]]; then
  ( k6 run --summary-trend-stats="avg,p(95),p(99)" -e MODE=rate -e RATE=50 -e DURATION="$DURATION" -e VUS=20 \
    "$LOAD_DIR/k6-reads.js" 2>&1 | tee "$SUITE_LOG_DIR/k6-http2-protocol.log" ) || true
else
  echo "  ⚠️  k6 or k6-reads.js missing" >> "$SUITE_LOG_DIR/k6-http2-protocol.log"
fi

# 2) HTTP/3 (xk6-http3)
K6_HTTP3_BIN=""
for candidate in "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.k6-build/k6-http3"; do
  [[ -x "$candidate" ]] && K6_HTTP3_BIN="$candidate" && break
done
echo "  → k6 protocol comparison: HTTP/3 (xk6-http3)..."
# K6_HTTP3_NO_REUSE=1 avoids stale QUIC sessions (host→Colima/VMs) and ~15s timeouts
export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"
if [[ -n "$K6_HTTP3_BIN" ]] && [[ -f "$LOAD_DIR/k6-http3-complete.js" ]]; then
  ( "$K6_HTTP3_BIN" run --summary-trend-stats="avg,p(95),p(99)" \
    -e K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}" \
    -e K6_PROTOCOL_VUS="$K6_HTTP3_VUS" -e K6_PROTOCOL_DURATION="$DURATION" \
    -e BASE_URL="$BASE_URL" -e HOST="${HOST:-record.local}" \
    -e K6_RESOLVE="${K6_RESOLVE:-}" \
    "$LOAD_DIR/k6-http3-complete.js" 2>&1 | tee "$SUITE_LOG_DIR/k6-http3-protocol.log" ) || true
else
  echo "  ⚠️  xk6-http3 not built or k6-http3-complete.js missing" >> "$SUITE_LOG_DIR/k6-http3-protocol.log"
fi

# Write protocol-comparison.json for observation deck
h2_json=$(parse_k6_log "$SUITE_LOG_DIR/k6-http2-protocol.log")
h3_json=$(parse_k6_log "$SUITE_LOG_DIR/k6-http3-protocol.log")
printf '%s\n' "{
  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"duration\": \"$DURATION\",
  \"vus\": \"20 / $K6_HTTP3_VUS\",
  \"http2_vus\": 20,
  \"http3_vus\": $K6_HTTP3_VUS,
  \"http2\": $h2_json,
  \"http3\": $h3_json,
  \"logs\": {
    \"http2\": \"k6-http2-protocol.log\",
    \"http3\": \"k6-http3-protocol.log\"
  }
}" > "$SUITE_LOG_DIR/protocol-comparison.json"
echo "✅ Protocol comparison written to $SUITE_LOG_DIR/protocol-comparison.json"
