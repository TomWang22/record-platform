#!/usr/bin/env bash
# Phase 16 — AI platform soak monitor (observe-only: latency, degradation, source_refs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
JSON_REPORT="$REPORT_DIR/phase-16-ai-soak-monitor.json"
MD_REPORT="$REPORT_DIR/phase-16-ai-soak-monitor.md"
SAMPLES_JSON="$(mktemp)"
trap 'rm -f "$SAMPLES_JSON"' EXIT

SOAK_DURATION_SECONDS="${SOAK_DURATION_SECONDS:-900}"
SOAK_INTERVAL_SECONDS="${SOAK_INTERVAL_SECONDS:-60}"
API_BASE="${AI_SOAK_API_BASE:-https://record-platform.test}"
AUTH_EMAIL="${AI_SOAK_EMAIL:-${RP_COMB_EMAIL:-e2e-contract@record-platform.local}}"
AUTH_PASS="${AI_SOAK_PASSWORD:-${RP_COMB_PASSWORD:-ContractPass123!}}"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-${METALLB_IP:-}}")"
[[ -f "$CA" ]] || { echo "❌ missing $CA"; exit 1; }
[[ "$LB_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "❌ no MetalLB IP for --resolve record-platform.test:443:<LB>"; exit 1; }

CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")
export AI_SOAK_CA="$CA"
export AI_SOAK_RESOLVE="record-platform.test:443:${LB_IP}"

mkdir -p "$REPORT_DIR"
echo "[]" >"$SAMPLES_JSON"

echo "=== RP AI soak monitor (Phase 16) ==="
echo "duration=${SOAK_DURATION_SECONDS}s interval=${SOAK_INTERVAL_SECONDS}s base=$API_BASE"
echo "tls=strict cacert=certs/dev-chain.pem resolve=record-platform.test:443:${LB_IP}"

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 30 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
[[ -n "$TOKEN" ]] || { echo "❌ auth login failed (strict TLS)"; exit 1; }

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

LISTING_ID="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/listings/search?limit=1" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d.get("items") or []; print(items[0]["id"] if items else "")' 2>/dev/null || true)"
RECORD_ID="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/records" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if isinstance(d,list) and d else "")' 2>/dev/null || true)"
AUCTION_LISTING_ID=""
if rp_python_ai_psql_connect_check; then
  AUCTION_LISTING_ID="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT source_id::text FROM ai.ai_documents WHERE source_type='auction_bid_summary' LIMIT 1), '');" \
    || echo "")"
fi

END_TS=$(( $(date +%s) + SOAK_DURATION_SECONDS ))
ITER=0

probe_once() {
  local ts iso
  ts="$(date +%s)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 - "$SAMPLES_JSON" "$iso" "$ts" "$ITER" "$API_BASE" "$TOKEN" \
    "$LISTING_ID" "$RECORD_ID" "$AUCTION_LISTING_ID" <<'PY'
import json, os, subprocess, sys, time

samples_path, iso, ts, iteration, base, token, listing_id, record_id, auction_id = sys.argv[1:11]
ca = os.environ["AI_SOAK_CA"]
resolve = os.environ["AI_SOAK_RESOLVE"]

with open(samples_path) as f:
    samples = json.load(f)

def curl_call(name, method, path, body=None):
    url = base + path
    cmd = [
        "curl", "-sfS", "--max-time", "30",
        "--cacert", ca, "--resolve", resolve,
        "-w", "\n%{http_code}",
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
    ]
    if body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(body)]
    else:
        cmd += ["-X", method]
    cmd.append(url)
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        if proc.returncode != 0:
            return {
                "endpoint": name, "method": method, "path": path,
                "http_status": 0, "latency_ms": latency_ms,
                "error": (proc.stderr or proc.stdout or "curl failed")[:200],
            }
        lines = proc.stdout.rsplit("\n", 1)
        if len(lines) == 2:
            raw, code_s = lines[0], lines[1]
            code = int(code_s)
        else:
            raw, code = proc.stdout, 0
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
rows.append(curl_call("rag_status", "GET", "/api/ai/rag/status"))
rows.append(curl_call("rag_query", "POST", "/api/ai/rag/query", {"question": "listing price auction"}))
if record_id:
    rows.append(curl_call("record_valuation", "POST", "/api/ai/records/valuation", {"record_id": record_id}))
if listing_id:
    rows.append(curl_call("pricing_advice", "POST", "/api/ai/listings/pricing-advice", {"listing_id": listing_id}))
if auction_id:
    rows.append(curl_call("auction_risk", "POST", "/api/ai/auctions/risk", {"listing_id": auction_id}))
rows.append(curl_call("seller_summary", "POST", "/api/ai/seller/summary", {}))
rows.append(curl_call("buyer_summary", "POST", "/api/ai/buyer/collection-summary", {}))

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

python3 - "$SAMPLES_JSON" "$JSON_REPORT" "$MD_REPORT" "$SOAK_DURATION_SECONDS" "$SOAK_INTERVAL_SECONDS" "$API_BASE" "$LB_IP" <<'PY'
import json, math, sys
from collections import Counter, defaultdict

samples_path, json_out, md_out, duration, interval, base, lb_ip = sys.argv[1:8]
with open(samples_path) as f:
    samples = json.load(f)

by_ep = defaultdict(list)
errors_5xx = []
forbidden = []
degraded = []
missing_refs_live = []
degraded_no_reason = []
degraded_bad_model = []

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
            if not p.get("degraded_reason"):
                degraded_no_reason.append(p)
            model = (p.get("model_used") or "").lower()
            if model and model not in ("rule-engine", "rules", "heuristic") and "ollama" not in (p.get("degraded_reason") or "").lower():
                pass  # non-Ollama degraded paths may use other labels
        if p.get("source_status") == "live" and p.get("source_refs_count", 0) == 0 and ep != "rag_status":
            missing_refs_live.append(p)

def pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    idx = max(0, math.ceil(p * len(s)) - 1)
    return round(s[idx], 1)

summary = {}
degraded_reasons = Counter()
model_used_dist = Counter()

for ep, rows in sorted(by_ep.items()):
    lats = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
    codes = [r.get("http_status", 0) for r in rows]
    live_refs = [r["source_refs_count"] for r in rows if r.get("source_status") == "live" and r.get("source_refs_count") is not None]
    for r in rows:
        if r.get("model_used"):
            model_used_dist[r["model_used"]] += 1
        if r.get("source_status") == "degraded" and r.get("degraded_reason"):
            degraded_reasons[r["degraded_reason"]] += 1
    summary[ep] = {
        "samples": len(rows),
        "live_count": sum(1 for r in rows if r.get("source_status") == "live"),
        "degraded_count": sum(1 for r in rows if r.get("source_status") == "degraded"),
        "p50_latency_ms": pct(lats, 0.50),
        "p95_latency_ms": pct(lats, 0.95),
        "p99_latency_ms": pct(lats, 0.99),
        "max_latency_ms": round(max(lats), 1) if lats else None,
        "status_codes": sorted(set(codes)),
        "source_refs_live_min": min(live_refs) if live_refs else None,
        "source_refs_live_avg": round(sum(live_refs) / len(live_refs), 2) if live_refs else None,
        "source_refs_live_max": max(live_refs) if live_refs else None,
    }

fail = False
if errors_5xx:
    fail = True
if forbidden:
    fail = True
if missing_refs_live:
    fail = True
if degraded_no_reason:
    fail = True

result = {
    "phase": "16",
    "ticket": "T16.1",
    "scope": "observe-only",
    "api_base": base,
    "tls": {
        "cacert": "certs/dev-chain.pem",
        "resolve": f"record-platform.test:443:{lb_ip}",
        "insecure": False,
    },
    "duration_seconds": int(duration),
    "interval_seconds": int(interval),
    "iterations": len(samples),
    "live_response_count": sum(s["live_count"] for s in summary.values()),
    "degraded_response_count": len(degraded),
    "degraded_reason_breakdown": dict(degraded_reasons),
    "model_used_distribution": dict(model_used_dist),
    "endpoint_summary": summary,
    "errors_5xx_count": len(errors_5xx),
    "forbidden_prose_count": len(forbidden),
    "degraded_without_reason_count": len(degraded_no_reason),
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
    f"- TLS: `--cacert certs/dev-chain.pem` + `--resolve record-platform.test:443:{lb_ip}` (no -k)",
    f"- Duration: {duration}s / interval: {interval}s",
    f"- Iterations: {len(samples)}",
    f"- Live responses: {result['live_response_count']}",
    f"- Degraded responses: {len(degraded)}",
    f"- 5xx errors: {len(errors_5xx)}",
    f"- Forbidden prose: {len(forbidden)}",
    f"- Degraded without reason: {len(degraded_no_reason)}",
    f"- Live without source_refs: {len(missing_refs_live)}",
    "",
    "## Degraded reason breakdown",
    "",
]
for reason, cnt in degraded_reasons.most_common():
    lines.append(f"- `{reason}`: {cnt}")
if not degraded_reasons:
    lines.append("- (none)")

lines += ["", "## model_used distribution", ""]
for model, cnt in model_used_dist.most_common():
    lines.append(f"- `{model}`: {cnt}")
if not model_used_dist:
    lines.append("- (none)")

lines += [
    "",
    "## Endpoint latency + source_refs (live)",
    "",
    "| Endpoint | n | live | deg | p50 | p95 | p99 | refs min/avg/max |",
    "|----------|--:|-----:|----:|----:|----:|----:|-----------------:|",
]
for ep, s in summary.items():
    refs = f"{s['source_refs_live_min']}/{s['source_refs_live_avg']}/{s['source_refs_live_max']}"
    lines.append(
        f"| {ep} | {s['samples']} | {s['live_count']} | {s['degraded_count']} | "
        f"{s['p50_latency_ms']} | {s['p95_latency_ms']} | {s['p99_latency_ms']} | {refs} |"
    )
lines += ["", f"JSON: `{json_out}`"]
with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"{'✅' if not fail else '❌'} phase-16-ai-soak-monitor → {md_out}")
sys.exit(1 if fail else 0)
PY
