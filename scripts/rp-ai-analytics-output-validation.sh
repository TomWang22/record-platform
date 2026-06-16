#!/usr/bin/env bash
# T18.7D — Analytics → python-ai output validation (grounding, features, no leakage).
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

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t18-7-analytics-output-validation.md}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t18-7-analytics-output-validation.json}"
mkdir -p "$(dirname "$REPORT_MD")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T18.7 analytics output validation ==="

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
OBO_LISTING_ID=""
if rp_python_ai_psql_connect_check; then
  AUCTION_ID="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT source_id::text FROM ai.ai_documents WHERE source_type='auction_bid_summary' LIMIT 1), '');" \
    || echo "")"
  OBO_LISTING_ID="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT metadata->>'listing_id' FROM ai.ai_documents WHERE source_type='obo_offer_summary' AND metadata->>'listing_id' IS NOT NULL LIMIT 1), '');" \
    || echo "")"
fi
[[ -n "$OBO_LISTING_ID" ]] || OBO_LISTING_ID="$LISTING_ID"

export TOKEN API_BASE CA LB_IP REPORT_MD REPORT_JSON LISTING_ID RECORD_ID AUCTION_ID OBO_LISTING_ID CURL_RESOLVE="record-platform.test:443:${LB_IP}"
python3 <<'PY'
import json, os, re, subprocess, sys, time
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
md_out = os.environ["REPORT_MD"]
json_out = os.environ["REPORT_JSON"]
listing_id = os.environ.get("LISTING_ID", "")
record_id = os.environ.get("RECORD_ID", "")
auction_id = os.environ.get("AUCTION_ID", "")
obo_listing_id = os.environ.get("OBO_LISTING_ID", listing_id)

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo negotiation", re.I)
FAKE_LLM = re.compile(r"as an ai language model|i cannot help|chatgpt|openai gpt", re.I)

FLOWS = [
    {
        "flow_id": "seller_summary",
        "description": "seller summary uses analytics features + source_refs",
        "method": "POST",
        "path": "/api/ai/seller/summary",
        "body": {},
        "expect_details": ["counts_by_source_type", "metrics"],
        "expect_ref_types": ["listing", "obo_offer_summary", "auction_bid_summary", "notification"],
    },
    {
        "flow_id": "buyer_collection_summary",
        "description": "buyer collection uses records features + source_refs",
        "method": "POST",
        "path": "/api/ai/buyer/collection-summary",
        "body": {},
        "expect_details": ["record_count", "acquisition_patterns"],
        "expect_ref_types": ["record"],
    },
    {
        "flow_id": "obo_helper",
        "description": "OBO helper uses offer summaries + pricing features, no message bodies",
        "method": "GET",
        "path": f"/api/ai/offer-insights?listing_id={obo_listing_id}" if obo_listing_id else None,
        "body": None,
        "expect_details": ["signals", "privacy"],
        "expect_ref_types": ["listing", "obo_offer_summary"],
        "skip_if": not obo_listing_id,
    },
    {
        "flow_id": "auction_risk",
        "description": "auction risk uses bid summaries, no proxy max",
        "method": "POST",
        "path": "/api/ai/auctions/risk",
        "body": {"listing_id": auction_id} if auction_id else None,
        "expect_details": ["signals", "bidder_masking"],
        "expect_ref_types": ["auction_bid_summary"],
        "skip_if": not auction_id,
    },
    {
        "flow_id": "record_valuation",
        "description": "record valuation uses record metadata + comparable source_refs",
        "method": "POST",
        "path": "/api/ai/records/valuation",
        "body": {"record_id": record_id} if record_id else None,
        "expect_details": ["valuation_band"],
        "expect_ref_types": ["record"],
        "skip_if": not record_id,
    },
    {
        "flow_id": "listing_pricing_advice",
        "description": "listing pricing advice uses listing features + source_refs",
        "method": "POST",
        "path": "/api/ai/listings/pricing-advice",
        "body": {"listing_id": listing_id} if listing_id else None,
        "expect_details": ["quality_signals", "negotiation_guidance"],
        "expect_ref_types": ["listing"],
        "skip_if": not listing_id,
    },
]


def call(flow):
    method = flow["method"]
    path = flow["path"]
    body = flow.get("body")
    cmd = [
        "curl", "-sfS", "--max-time", "60", "--cacert", ca, "--resolve", resolve,
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
        "-w", "\n%{http_code}",
    ]
    if method == "POST":
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(body or {})]
    else:
        cmd += ["-X", method]
    cmd.append(base + path)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lat = round((time.perf_counter() - t0) * 1000, 1)
    if proc.returncode != 0:
        return {
            "flow_id": flow["flow_id"],
            "error": (proc.stderr or proc.stdout)[:240],
            "latency_ms": lat,
            "http_status": 0,
        }
    lines = proc.stdout.rsplit("\n", 1)
    raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"flow_id": flow["flow_id"], "parse_error": True, "http_status": int(code_s or 0), "latency_ms": lat}
    details = data.get("details") or {}
    refs = data.get("source_refs") or []
    return {
        "flow_id": flow["flow_id"],
        "description": flow["description"],
        "path": path,
        "input_payload": body if body is not None else {"query": path.split("?", 1)[-1]},
        "http_status": int(code_s),
        "latency_ms": lat,
        "source_status": data.get("source_status"),
        "model_used": data.get("model_used"),
        "summary": data.get("summary"),
        "confidence": data.get("confidence"),
        "degraded_reason": data.get("degraded_reason"),
        "details_keys": sorted(details.keys()),
        "details": {k: details[k] for k in list(details.keys())[:12]},
        "source_refs_count": len(refs),
        "source_ref_types": sorted({r.get("source_type") for r in refs if r.get("source_type")}),
        "contract_id": data.get("contract_id"),
        "raw_blob": json.dumps(data)[:5000],
    }


issues = []
results = []
for flow in FLOWS:
    if flow.get("skip_if"):
        results.append({"flow_id": flow["flow_id"], "skipped": True, "reason": "missing fixture id"})
        continue
    row = call(flow)
    results.append(row)
    fid = flow["flow_id"]
    blob = row.get("raw_blob") or json.dumps(row)

    if row.get("http_status", 0) >= 500:
        issues.append(f"{fid}: http {row.get('http_status')}")
    if row.get("error"):
        issues.append(f"{fid}: curl error")
    if FORBIDDEN.search(blob):
        issues.append(f"{fid}: forbidden prose")
    if LEAK_RE.search(blob):
        issues.append(f"{fid}: private message leak")
    if FAKE_LLM.search(blob):
        issues.append(f"{fid}: fake LLM prose")

    status = row.get("source_status")
    refs = row.get("source_refs_count", 0)
    if status == "live" and refs == 0:
        issues.append(f"{fid}: live without source_refs")
    if status == "degraded" and not row.get("degraded_reason"):
        issues.append(f"{fid}: degraded without reason")

    for key in flow.get("expect_details") or []:
        if key not in (row.get("details_keys") or []):
            issues.append(f"{fid}: missing details.{key}")

    model = (row.get("model_used") or "").lower()
    if any(x in model for x in ("torch", "tensorflow", "huggingface", "hf_")):
        issues.append(f"{fid}: disallowed runtime provider {row.get('model_used')}")

    # Grounding: summary should not claim specific dollar amounts without valuation_band / signals
    if fid == "auction_risk" and "proxy" in blob.lower():
        issues.append(f"{fid}: proxy max leak in auction risk")

summary = {
    "ticket": "T18.7D",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "flows_run": len([r for r in results if not r.get("skipped")]),
    "issues": issues,
    "pass": len(issues) == 0,
    "results": results,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T18.7 analytics output validation",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Flows run: {summary['flows_run']}",
    f"- Issues: {len(issues)}",
    "",
    "| Flow | status | model | refs | latency ms | degraded_reason | details keys |",
    "|------|--------|-------|-----:|-----------:|-----------------|--------------|",
]
for r in results:
    if r.get("skipped"):
        lines.append(f"| {r['flow_id']} | skipped | | | | {r.get('reason','')} | |")
        continue
    lines.append(
        f"| {r['flow_id']} | {r.get('source_status')} | {r.get('model_used')} | "
        f"{r.get('source_refs_count', 0)} | {r.get('latency_ms')} | {r.get('degraded_reason','')} | "
        f"{', '.join(r.get('details_keys') or [])[:6]} |"
    )
if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]
else:
    lines += [
        "",
        "- Grounded or structured degraded responses",
        "- No forbidden leakage / fake LLM prose",
        "- Analytics feature fields present on seller/buyer flows",
    ]
with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY
