#!/usr/bin/env bash
# Phase 16 — AI platform soak monitor (latency, degradation, source_refs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
JSON_REPORT="$REPORT_DIR/phase-16-ai-soak-monitor.json"
MD_REPORT="$REPORT_DIR/phase-16-ai-soak-monitor.md"
SAMPLES_JSON="$(mktemp)"
trap 'rm -f "$SAMPLES_JSON"' EXIT

SOAK_DURATION_SECONDS="${SOAK_DURATION_SECONDS:-900}"
SOAK_INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-60}"
API_BASE="${AI_SOAK_API_BASE:-${RP_PUBLIC_ORIGIN:-https://record-platform.test}}"
CA="${NODE_EXTRA_CA_CERTS:-$(rp_dev_edge_ca_file)}"
AUTH_EMAIL="${AI_SOAK_EMAIL:-${RP_COMB_EMAIL:-e2e-contract@record-platform.local}}"
AUTH_PASS="${AI_SOAK_PASSWORD:-${RP_COMB_PASSWORD:-ContractPass123!}}"

mkdir -p "$REPORT_DIR"
echo "[]" >"$SAMPLES_JSON"

echo "=== RP AI soak monitor (Phase 16) ==="
echo "duration=${SOAK_DURATION_SECONDS}s interval=${SOAK_INTERVAL_SECONDS}s base=$API_BASE"

CURL_OPTS=(--max-time 30 -w '\n%{http_code}\n%{time_total}')
[[ -f "$CA" ]] && CURL_OPTS+=(--cacert "$CA")

TOKEN="$(curl -sfS "${CURL_OPTS[@]}" -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" 2>/dev/null \
  | sed '$d' | sed '$d' | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
[[ -n "$TOKEN" ]] || { echo "❌ auth login failed"; exit 1; }

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

LISTING_ID="$(curl -sfS --cacert "$CA" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/listings/search?limit=1" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; print(items[0]["id"] if items else "")' 2>/dev/null || true)"
RECORD_ID="$(curl -sfS --cacert "$CA" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/records" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if isinstance(d,list) and d else "")' 2>/dev/null || true)"
AUCTION_LISTING_ID="$(psql -h "$PGHOST" -p 5440 -U "$PGUSER" -d python_ai -At -c \
  "SELECT source_id FROM ai.ai_documents WHERE source_type='auction_bid_summary' LIMIT 1" 2>/dev/null || true)"

END_TS=$(( $(date +%s) + SOAK_DURATION_SECONDS ))
ITER=0

probe_once() {
  local ts iso
  ts="$(date +%s)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 - "$SAMPLES_JSON" "$iso" "$ts" "$ITER" "$API_BASE" "$TOKEN" "$CA" \
    "$LISTING_ID" "$RECORD_ID" "$AUCTION_LISTING_ID" <<'PY'
import json, subprocess, sys, time
from urllib.request import Request, urlopen
import ssl

samples_path, iso, ts, iteration, base, token, ca, listing_id, record_id, auction_id = sys.argv[1:11]
with open(samples_path) as f:
    samples = json.load(f)

ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()

def call(name, method, path, body=None):
    url = base + path
    headers = {"Authorization": f"Bearer {token}", "X-RP-E2E-Contract": "1"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = Request(url, data=data, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with urlopen(req, context=ctx, timeout=30) as r:
            raw = r.read().decode()
            code = r.status
    except Exception as e:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "endpoint": name, "method": method, "path": path,
            "http_status": 0, "latency_ms": latency_ms, "error": str(e)[:200],
        }
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    row = {
        "endpoint": name, "method": method, "path": path,
        "http_status": code, "latency_ms": latency_ms,
    }
    try:
        d = json.loads(raw)
        row["source_status"] = d.get("source_status")
        row["model_used"] = d.get("model_used")
        row["degraded_reason"] = d.get("degraded_reason")
        refs = d.get("source_refs") or []
        row["source_refs_count"] = len(refs)
        blob = raw.lower()
        for term in ("demo", "mock", "sample fallback"):
            if term in blob:
                row["forbidden_prose"] = term
    except json.JSONDecodeError:
        row["parse_error"] = True
    return row

rows = []
rows.append(call("rag_status", "GET", "/api/ai/rag/status"))
rows.append(call("rag_query", "POST", "/api/ai/rag/query", {"question": "listing price auction"}))
if record_id:
    rows.append(call("record_valuation", "POST", "/api/ai/records/valuation", {"record_id": record_id}))
if listing_id:
    rows.append(call("pricing_advice", "POST", "/api/ai/listings/pricing-advice", {"listing_id": listing_id}))
if auction_id:
    rows.append(call("auction_risk", "POST", "/api/ai/auctions/risk", {"listing_id": auction_id}))
rows.append(call("seller_summary", "POST", "/api/ai/seller/summary", {}))
rows.append(call("buyer_summary", "POST", "/api/ai/buyer/collection-summary", {}))

samples.append({"iteration": int(iteration), "timestamp": iso, "unix": int(ts), "probes": rows})
with open(samples_path, "w") as f:
    json.dump(samples, f, indent=2)
PY
}

while [[ $(date +%s) -lt $END_TS ]]; do
  probe_once
  ITER=$((ITER + 1))
  echo "soak iteration $ITER @ $(date -u +%H:%M:%SZ)"
  [[ $(date +%s) -ge $END_TS ]] && break
  sleep "$SOAK_INTERVAL_SECONDS"
done

python3 - "$SAMPLES_JSON" "$JSON_REPORT" "$MD_REPORT" "$SOAK_DURATION_SECONDS" "$SOAK_INTERVAL_SECONDS" "$API_BASE" <<'PY'
import json, math, sys
from collections import defaultdict

samples_path, json_out, md_out, duration, interval, base = sys.argv[1:7]
with open(samples_path) as f:
    samples = json.load(f)

by_ep = defaultdict(list)
errors_5xx = []
forbidden = []
degraded = []
missing_refs_live = []

for sample in samples:
    for p in sample.get("probes", []):
        ep = p["endpoint"]
        by_ep[ep].append(p)
        code = p.get("http_status", 0)
        if code >= 500:
            errors_5xx.append(p)
        if p.get("forbidden_prose"):
            forbidden.append(p)
        if p.get("source_status") == "degraded":
            degraded.append(p)
        if p.get("source_status") == "live" and p.get("source_refs_count", 0) == 0 and ep != "rag_status":
            missing_refs_live.append(p)

def p95(vals):
    if not vals:
        return None
    s = sorted(vals)
    idx = max(0, math.ceil(0.95 * len(s)) - 1)
    return s[idx]

summary = {}
for ep, rows in sorted(by_ep.items()):
    lats = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
    codes = [r.get("http_status", 0) for r in rows]
    summary[ep] = {
        "samples": len(rows),
        "p95_latency_ms": p95(lats),
        "max_latency_ms": max(lats) if lats else None,
        "status_codes": sorted(set(codes)),
        "degraded_count": sum(1 for r in rows if r.get("source_status") == "degraded"),
        "live_count": sum(1 for r in rows if r.get("source_status") == "live"),
    }

fail = False
if errors_5xx:
    fail = True
if forbidden:
    fail = True
if missing_refs_live:
    fail = True

result = {
    "phase": "16",
    "ticket": "T16.1",
    "api_base": base,
    "duration_seconds": int(duration),
    "interval_seconds": int(interval),
    "iterations": len(samples),
    "endpoint_summary": summary,
    "errors_5xx_count": len(errors_5xx),
    "forbidden_prose_count": len(forbidden),
    "degraded_response_count": len(degraded),
    "missing_refs_on_live_count": len(missing_refs_live),
    "pass": not fail,
    "samples": samples,
}

with open(json_out, "w") as f:
    json.dump(result, f, indent=2)

lines = [
    "# Phase 16 AI soak monitor (T16.1)",
    "",
    f"**RESULT: {'PASS' if not fail else 'FAIL'}**",
    "",
    f"- API base: `{base}`",
    f"- Duration: {duration}s / interval: {interval}s",
    f"- Iterations: {len(samples)}",
    f"- 5xx errors: {len(errors_5xx)}",
    f"- Forbidden prose: {len(forbidden)}",
    f"- Degraded responses: {len(degraded)} (structured allowed)",
    f"- Live without source_refs: {len(missing_refs_live)}",
    "",
    "## Endpoint p95 latency (ms)",
    "",
    "| Endpoint | Samples | p95 ms | max ms | degraded | live |",
    "|----------|--------:|-------:|-------:|---------:|-----:|",
]
for ep, s in summary.items():
    lines.append(
        f"| {ep} | {s['samples']} | {s['p95_latency_ms']} | {s['max_latency_ms']} | {s['degraded_count']} | {s['live_count']} |"
    )
lines += ["", f"JSON: `{json_out}`"]
with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"{'✅' if not fail else '❌'} phase-16-ai-soak-monitor → {md_out}")
sys.exit(1 if fail else 0)
PY
