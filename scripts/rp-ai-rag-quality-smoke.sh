#!/usr/bin/env bash
# Phase 17 T17.3 — RAG quality smoke (grounding validation).
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

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/phase-17-rag-quality-smoke.md}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/phase-17-rag-quality-smoke.json}"
mkdir -p "$(dirname "$REPORT_MD")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "=== Phase 17 RAG quality smoke (T17.3) ==="

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

LISTING_ID="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/listings/search?limit=1" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("items") or [{}])[0].get("id",""))')"
RECORD_ID="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/records" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if isinstance(d,list) and d else "")')"
AUCTION_ID=""
if rp_python_ai_psql_connect_check; then
  AUCTION_ID="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT source_id::text FROM ai.ai_documents WHERE source_type='auction_bid_summary' LIMIT 1), '');" \
    || echo "")"
else
  echo "⚠️ python_ai DB unreachable — auction_risk prompt may use empty listing context"
fi

export TOKEN API_BASE CA LB_IP REPORT_MD REPORT_JSON LISTING_ID RECORD_ID AUCTION_ID CURL_RESOLVE="record-platform.test:443:${LB_IP}"
python3 <<'PY'
import json, os, re, subprocess, sys, time

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
md_out = os.environ["REPORT_MD"]
json_out = os.environ["REPORT_JSON"]
listing_id = os.environ.get("LISTING_ID", "")
auction_id = os.environ.get("AUCTION_ID", "")

def call(name, method, path, body=None):
    cmd = ["curl", "-sfS", "--max-time", "45", "--cacert", ca, "--resolve", resolve,
           "-H", f"Authorization: Bearer {token}", "-H", "X-RP-E2E-Contract: 1",
           "-w", "\n%{http_code}"]
    if body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(body)]
    else:
        cmd += ["-X", method]
    cmd.append(base + path)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lat = round((time.perf_counter() - t0) * 1000, 1)
    if proc.returncode != 0:
        return {"prompt_id": name, "error": (proc.stderr or proc.stdout)[:200], "latency_ms": lat}
    lines = proc.stdout.rsplit("\n", 1)
    raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {"prompt_id": name, "http_status": int(code_s or 0), "latency_ms": lat, "parse_error": True}
    d["_probe"] = {"prompt_id": name, "http_status": int(code_s), "latency_ms": lat}
    return d

FORBIDDEN = re.compile(r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max", re.I)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

prompts = [
    ("underpriced_records", "POST", "/api/ai/rag/query", {"question": "What records in my collection look underpriced?"}),
]
if listing_id:
    prompts.append(("obo_counter", "POST", "/api/ai/listings/pricing-advice", {"listing_id": listing_id}))
if auction_id:
    prompts.append(("auction_risk", "POST", "/api/ai/auctions/risk", {"listing_id": auction_id}))
prompts.append(("seller_summary", "POST", "/api/ai/seller/summary", {}))
prompts.append(("buyer_summary", "POST", "/api/ai/buyer/collection-summary", {}))

results = []
issues = []
for pid, method, path, body in prompts:
    row = call(pid, method, path, body)
    row["prompt_id"] = pid
    row["path"] = path
    results.append(row)

    blob = json.dumps(row)
    if FORBIDDEN.search(blob):
        issues.append(f"{pid}: forbidden prose")
    if row.get("http_status", row.get("_probe", {}).get("http_status", 200)) >= 500:
        issues.append(f"{pid}: 5xx")
    status = row.get("source_status")
    refs = row.get("source_refs") or []
    if status == "live" and len(refs) == 0:
        issues.append(f"{pid}: live without source_refs")
    if status == "degraded" and not row.get("degraded_reason"):
        issues.append(f"{pid}: degraded without reason")
    # Private message heuristic
    if "message_body" in blob.lower() or "thread_text" in blob.lower():
        issues.append(f"{pid}: possible private message leak")

summary = {
    "phase": 17,
    "ticket": "T17.3",
    "prompts": len(results),
    "issues": issues,
    "pass": len(issues) == 0,
    "results": results,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# Phase 17 RAG quality smoke (T17.3)",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Prompts run: {len(results)}",
    f"- Issues: {len(issues)}",
    "",
    "| Prompt | status | model | refs | latency ms | degraded_reason |",
    "|--------|--------|-------|-----:|-----------:|-----------------|",
]
for r in results:
    probe = r.get("_probe", {})
    lines.append(
        f"| {r.get('prompt_id')} | {r.get('source_status')} | {r.get('model_used')} | "
        f"{len(r.get('source_refs') or [])} | {probe.get('latency_ms', r.get('latency_ms',''))} | {r.get('degraded_reason','')} |"
    )
if issues:
    lines += ["", "## Issues", ""]
    for i in issues:
        lines.append(f"- ❌ {i}")
else:
    lines += ["", "- ✅ grounded or structured degraded", "- ✅ no forbidden prose", "- ✅ no private message text"]
lines += ["", f"JSON: `{json_out}`"]

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"{'✅' if not issues else '❌'} phase-17-rag-quality-smoke → {md_out}")
sys.exit(1 if issues else 0)
PY
