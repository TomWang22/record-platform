#!/usr/bin/env bash
# Probe edge URLs (through Caddy) for HTTP 200, TLS verify, and latency under SLA after warmup.
#
# Usage: ./scripts/probe-edge-route-latency.sh
# Env:
#   LATENCY_SLA_MS — max per-request ms after warmup (default 5000)
#   EDGE_PROBE_SAMPLES — samples per route after warmup (default 5)
#   EDGE_PROBE_WARMUP — warmup requests per route (default 1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/rp-edge-url.sh
source "$SCRIPT_DIR/lib/rp-edge-url.sh"

MAX_MS="${LATENCY_SLA_MS:-5000}"
SAMPLES="${EDGE_PROBE_SAMPLES:-5}"
WARMUP="${EDGE_PROBE_WARMUP:-1}"
export RP_X_SUITE="${RP_X_SUITE:-bash}"

ENDPOINTS=(
  "/api/readyz"
  "/api/auth/healthz"
  "/api/listings/healthz"
  "/api/trust/healthz"
)

OUT_JSON="${EDGE_LATENCY_JSON:-$REPO_ROOT/bench_logs/slo/edge-route-latency.json}"
mkdir -p "$(dirname "$OUT_JSON")"

failures=()

_percentiles() {
  python3 - "$@" <<'PY'
import json, math, sys
vals = sorted(int(x) for x in sys.argv[1:] if str(x).isdigit())
if not vals:
    print(json.dumps({"p50":0,"p95":0,"p99":0,"max":0}))
    raise SystemExit
def nr(p):
    k = max(1, min(len(vals), math.ceil(p / 100.0 * len(vals))))
    return vals[k - 1]
print(json.dumps({"p50": nr(50), "p95": nr(95), "p99": nr(99), "max": vals[-1]}))
PY
}

_probe_once() {
  local path="$1"
  local url="${EDGE_BASE_URL}${path}"
  local result code t ms verify=0
  result="$(curl -sS -o /dev/null -w "%{http_code} %{time_total} %{ssl_verify_result}" \
    --connect-timeout 8 --max-time 60 \
    -H "x-traffic-class: infra" \
    -H "x-suite: ${RP_X_SUITE}" \
    "${EDGE_CURL_TLS_ARGS[@]}" \
    "${EDGE_RESOLVE_ARGS[@]}" \
    "$url" 2>/dev/null || echo "000 9.999 1")"
  code="$(echo "$result" | awk '{print $1}')"
  t="$(echo "$result" | awk '{print $2}')"
  verify="$(echo "$result" | awk '{print $3}')"
  ms="$(awk -v x="$t" 'BEGIN { printf "%d", x * 1000 }')"
  echo "$code $ms $verify"
}

probe_route() {
  local path="$1"
  local i samples_ms=() code="" verify=""
  echo "  ▶ probing ${EDGE_BASE_URL}${path}"

  for ((i = 0; i < WARMUP; i++)); do
    read -r code ms verify < <(_probe_once "$path")
  done

  for ((i = 0; i < SAMPLES; i++)); do
    read -r code ms verify < <(_probe_once "$path")
    samples_ms+=("$ms")
    echo "    sample $((i + 1))/${SAMPLES}: HTTP $code, ${ms}ms tls_verify=$verify"
    if [[ "$code" != "200" ]]; then
      failures+=("$path:status:$code")
    fi
    if [[ "${verify:-1}" != "0" ]]; then
      failures+=("$path:tls_verify:$verify")
    fi
    if [[ "$code" == "200" && "$ms" -gt "$MAX_MS" ]]; then
      failures+=("$path:latency:${ms}ms")
    fi
  done

  local pct
  pct="$(_percentiles "${samples_ms[@]}")"
  local p50 p95 p99 pmax
  p50="$(echo "$pct" | jq -r '.p50')"
  p95="$(echo "$pct" | jq -r '.p95')"
  p99="$(echo "$pct" | jq -r '.p99')"
  pmax="$(echo "$pct" | jq -r '.max')"
  echo "    → p50=${p50}ms p95=${p95}ms p99=${p99}ms max=${pmax}ms (SLA=${MAX_MS}ms)"

  ROUTE_JSON+=("$(jq -cn \
    --arg route "$path" \
    --arg host "$EDGE_HOST" \
    --argjson port "$EDGE_PORT" \
    --arg ip "${EDGE_IP:-}" \
    --argjson sla_ms "$MAX_MS" \
    --argjson samples "$SAMPLES" \
    --argjson tls_verify "${verify:-0}" \
    --argjson p50 "$p50" --argjson p95 "$p95" --argjson p99 "$p99" --argjson max "$pmax" \
    '{route:$route,host:$host,port:$port,edge_ip:$ip,http_version:"h2/h3-via-caddy",tls_verify_result:$tls_verify,sla_ms:$sla_ms,samples:$samples,p50_ms:$p50,p95_ms:$p95,p99_ms:$p99,max_ms:$max}')")
}

printf '\n\033[1m%s\033[0m\n' "probe-edge-route-latency (HOST=$EDGE_HOST IP=${EDGE_IP:-dns} SLA=${MAX_MS}ms samples=${SAMPLES})"

if [[ -z "${EDGE_IP:-}" ]]; then
  echo "⚠️  No MetalLB IP for caddy-h3 — curling without --resolve (needs /etc/hosts for $EDGE_HOST)" >&2
fi

ROUTE_JSON=()
for ep in "${ENDPOINTS[@]}"; do
  probe_route "$ep"
done

jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg host "$EDGE_HOST" \
  --arg ip "${EDGE_IP:-}" \
  --argjson sla_ms "$MAX_MS" \
  --argjson routes "$(printf '%s\n' "${ROUTE_JSON[@]}" | jq -s '.')" \
  --argjson ok "$([[ ${#failures[@]} -eq 0 ]] && echo true || echo false)" \
  '{timestamp:$ts,host:$host,edge_ip:$ip,sla_ms:$sla_ms,routes:$routes,ok:$ok}' >"$OUT_JSON"

if [[ ${#failures[@]} -gt 0 ]]; then
  echo "❌ latency probe failed:" >&2
  printf '  %s\n' "${failures[@]}" >&2
  exit 1
fi

echo "✅ edge routes within SLA (report: $OUT_JSON)"
exit 0
