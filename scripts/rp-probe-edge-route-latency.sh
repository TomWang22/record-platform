#!/usr/bin/env bash
# Record Platform edge route latency probes (record-platform.test only).
# JSON to stdout; human logs to stderr.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
mkdir -p "$REPO_ROOT/bench_logs"

HOST="${RP_PUBLIC_HOST:-record-platform.test}"
PORT="${RP_EDGE_PORT:-443}"
CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
P95_MAX="${RP_EDGE_P95_MAX_MS:-750}"
P99_MAX="${RP_EDGE_P99_MAX_MS:-1500}"
P100_MAX="${RP_EDGE_P100_MAX_MS:-3000}"

if [[ "$HOST" != "record-platform.test" ]]; then
  echo "❌ edge host must be record-platform.test (got $HOST)" >&2
  exit 1
fi

ENDPOINTS=(
  "/api/readyz"
  "/api/auth/healthz"
  "/api/listings/healthz"
  "/api/messaging/healthz"
  "/api/media/healthz"
  "/api/notification/healthz"
  "/api/trust/healthz"
  "/api/analytics/healthz"
)

TARGET_IP="${CADDY_TARGET:-}"
if [[ -z "$TARGET_IP" ]] && kubectl get svc -n ingress-nginx caddy-h3 &>/dev/null 2>&1; then
  TARGET_IP="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi
if [[ -z "$TARGET_IP" ]]; then
  echo "❌ caddy-h3 MetalLB IP missing" >&2
  exit 1
fi
PORT=443

TMP_ROUTES="$(mktemp)"
trap 'rm -f "$TMP_ROUTES"' EXIT
echo '[]' >"$TMP_ROUTES"
FAILURES=()

CURL_BASE=(curl -sS -o /dev/null -w "%{http_code} %{time_total}" --connect-timeout 8 --max-time 30 -H "x-traffic-class: infra" -H "x-suite: rp-bootstrap")
[[ -f "$CA_CERT" ]] && CURL_BASE+=(--cacert "$CA_CERT") || CURL_BASE+=(-k)
CURL_BASE+=(--resolve "${HOST}:${PORT}:${TARGET_IP}")

for path in "${ENDPOINTS[@]}"; do
  url="https://${HOST}:${PORT}${path}"
  echo "  ▶ $url" >&2
  result="$("${CURL_BASE[@]}" "$url" 2>/dev/null || echo "000 9.999")"
  code="$(echo "$result" | awk '{print $1}')"
  t="$(echo "$result" | awk '{print $2}')"
  ms="$(awk -v x="$t" 'BEGIN { printf "%d", x * 1000 }')"
  echo "    HTTP $code ${ms}ms" >&2
  ROUTES_FILE="$TMP_ROUTES" PATH_Q="$path" CODE="$code" MS="$ms" python3 <<'PY'
import json, os
p = os.environ["ROUTES_FILE"]
routes = json.load(open(p, encoding="utf-8"))
routes.append({"route": os.environ["PATH_Q"], "http_code": int(os.environ["CODE"]), "latency_ms": int(os.environ["MS"])})
json.dump(routes, open(p, "w", encoding="utf-8"))
PY
  if [[ "$code" =~ ^5 ]]; then FAILURES+=("${path}:5xx:${code}"); fi
  if [[ "$code" == "000" ]]; then FAILURES+=("${path}:timeout"); fi
  if [[ "$code" != "200" ]] && [[ ! "$code" =~ ^5 ]]; then FAILURES+=("${path}:status:${code}"); fi
done

OUT_JSON="$REPO_ROOT/bench_logs/rp_edge_route_latency.json"
ROUTES_FILE="$TMP_ROUTES" HOST="$HOST" P95_MAX="$P95_MAX" P99_MAX="$P99_MAX" P100_MAX="$P100_MAX" \
  FAILURES="$(IFS='|'; echo "${FAILURES[*]:-}")" \
  python3 - "$OUT_JSON" <<'PY'
import json, os, sys

routes = json.load(open(os.environ["ROUTES_FILE"], encoding="utf-8"))
ms = sorted(r["latency_ms"] for r in routes)

def pct(p):
    if not ms:
        return 0
    i = min(len(ms) - 1, max(0, int((p / 100) * len(ms)) - 1))
    return ms[i]

p95_max = int(os.environ.get("P95_MAX", "750"))
p99_max = int(os.environ.get("P99_MAX", "1500"))
p100_max = int(os.environ.get("P100_MAX", "3000"))
lat = {"p50": pct(50), "p95": pct(95), "p99": pct(99), "p100": pct(100)}
fail_raw = os.environ.get("FAILURES", "")
failures = [x for x in fail_raw.split("|") if x]
sla = {
    "p95_max_ms": p95_max,
    "p99_max_ms": p99_max,
    "p100_max_ms": p100_max,
    "p95_ok": lat["p95"] <= p95_max,
    "p99_ok": lat["p99"] <= p99_max,
    "p100_ok": lat["p100"] <= p100_max,
}
out = {
    "ok": not failures and sla["p95_ok"] and sla["p99_ok"] and sla["p100_ok"],
    "host": os.environ.get("HOST", "record-platform.test"),
    "routes": routes,
    "latency_percentiles_ms": lat,
    "sla": sla,
    "failures": failures,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print(json.dumps(out))
PY
