#!/usr/bin/env bash
# T18.6/T18.7 — Hybrid retrieval shadow diagnostics smoke (keyword default; shadow_vector=1 only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t18-6-rag-shadow-smoke.md}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t18-6-rag-shadow-smoke.json}"
COMPARE_MD="${COMPARE_MD:-$REPO_ROOT/bench_logs/ai-platform/t18-7-shadow-quality-comparison.md}"
BASELINE_JSON="${SHADOW_BASELINE_JSON:-$REPO_ROOT/bench_logs/ai-platform/t18-7-shadow-baseline.json}"
CAPTURE_BASELINE="${SHADOW_CAPTURE_BASELINE:-0}"
CURL_TIMEOUT="${SHADOW_SMOKE_CURL_TIMEOUT:-120}"
mkdir -p "$(dirname "$REPORT_MD")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T18.6/T18.7 RAG shadow smoke ==="

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP REPORT_MD REPORT_JSON COMPARE_MD BASELINE_JSON CAPTURE_BASELINE CURL_TIMEOUT CURL_RESOLVE="record-platform.test:443:${LB_IP}"
python3 <<'PY'
import json, os, re, statistics, subprocess, sys, time
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "120")
md_out = os.environ["REPORT_MD"]
json_out = os.environ["REPORT_JSON"]
compare_md = os.environ["COMPARE_MD"]
baseline_json = os.environ["BASELINE_JSON"]
capture_baseline = os.environ.get("CAPTURE_BASELINE", "0") == "1"

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo", re.I)
FAKE_LLM = re.compile(r"as an ai|i cannot|lorem ipsum|chatgpt|openai", re.I)

PROMPTS = [
    ("auction_risk", "Why is this auction risky?"),
    ("obo_counter", "What should I counter on this OBO listing?"),
    ("underpriced_records", "Which records in my collection look underpriced?"),
    ("seller_summary", "Summarize my seller performance."),
    ("buyer_summary", "Summarize my buyer collection."),
    ("listing_quality", "Find listing quality problems I should fix."),
]


def percentile(vals, pct):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * pct / 100.0
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return round(s[f], 1)
    return round(s[f] + (s[c] - s[f]) * (k - f), 1)


def call(path, body, *, shadow: bool):
    cmd = [
        "curl", "-sfS", "--max-time", curl_timeout, "--cacert", ca, "--resolve", resolve,
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
        "-X", "POST", "-H", "Content-Type: application/json",
        "-d", json.dumps(body),
        "-w", "\n%{http_code}",
    ]
    url = base + path + ("?shadow_vector=1" if shadow else "")
    cmd.append(url)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lat = round((time.perf_counter() - t0) * 1000, 1)
    if proc.returncode != 0:
        return {
            "shadow": shadow,
            "error": (proc.stderr or proc.stdout)[:240],
            "latency_ms": lat,
            "http_status": 0,
        }
    lines = proc.stdout.rsplit("\n", 1)
    raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"shadow": shadow, "parse_error": True, "http_status": int(code_s or 0), "latency_ms": lat}
    sv = (data.get("details") or {}).get("shadow_vector") or {}
    top_types = [t.get("source_type") for t in (sv.get("top_source_types") or []) if t.get("source_type")]
    return {
        "shadow": shadow,
        "http_status": int(code_s),
        "latency_ms": lat,
        "source_status": data.get("source_status"),
        "model_used": data.get("model_used"),
        "summary": data.get("summary"),
        "source_refs_count": len(data.get("source_refs") or []),
        "retrieval_mode": (data.get("details") or {}).get("retrieval_mode"),
        "shadow_vector": sv or None,
        "shadow_source_types": top_types,
        "degraded_reason": data.get("degraded_reason"),
        "raw_blob": json.dumps(data)[:4000],
    }


issues = []
rows = []
shadow_lats = []
all_shadow_types = set()

for pid, question in PROMPTS:
    body = {"question": question}
    normal = call("/api/ai/rag/query", body, shadow=False)
    shadow = call("/api/ai/rag/query", body, shadow=True)
    row = {"prompt_id": pid, "question": question, "normal": normal, "shadow": shadow}
    rows.append(row)

    sv = shadow.get("shadow_vector") or {}
    if sv.get("latency_ms") is not None:
        shadow_lats.append(float(sv["latency_ms"]))
    for st in shadow.get("shadow_source_types") or []:
        all_shadow_types.add(st)

    for label, resp in (("normal", normal), ("shadow", shadow)):
        if resp.get("http_status", 0) >= 500:
            issues.append(f"{pid}/{label}: http {resp.get('http_status')}")
        if resp.get("error"):
            issues.append(f"{pid}/{label}: curl error")
        blob = resp.get("raw_blob") or json.dumps(resp)
        if FORBIDDEN.search(blob):
            issues.append(f"{pid}/{label}: forbidden prose")
        if LEAK_RE.search(blob):
            issues.append(f"{pid}/{label}: possible private message leak")
        if FAKE_LLM.search(blob):
            issues.append(f"{pid}/{label}: fake LLM prose")

    if normal.get("retrieval_mode") and normal.get("retrieval_mode") != "keyword":
        issues.append(f"{pid}: normal retrieval_mode not keyword")
    if not shadow.get("shadow_vector"):
        issues.append(f"{pid}: shadow_vector diagnostics missing")
    elif shadow["shadow_vector"].get("enabled") is not True:
        issues.append(f"{pid}: shadow_vector.enabled not true")
    if normal.get("summary") != shadow.get("summary"):
        issues.append(f"{pid}: summary changed with shadow enabled")
    if normal.get("source_refs_count") != shadow.get("source_refs_count"):
        issues.append(f"{pid}: source_refs count changed with shadow enabled")

# T18.7: require shadow diversity when enough embeddings exist
embedded_total = max((r["shadow"].get("shadow_vector") or {}).get("embedded_chunks", 0) for r in rows)
if embedded_total >= 200 and len(all_shadow_types) < 3:
    issues.append(f"shadow_source_types: only {sorted(all_shadow_types)} (need >=3 with embedded_total={embedded_total})")

overlap_rows = []
for r in rows:
    sv = r["shadow"].get("shadow_vector") or {}
    overlap_rows.append({
        "prompt_id": r["prompt_id"],
        "overlap": sv.get("overlap_with_keyword"),
        "shadow_candidates": sv.get("candidate_count"),
        "shadow_latency_ms": sv.get("latency_ms"),
        "shadow_source_types": r["shadow"].get("shadow_source_types") or [],
        "embedded_chunks": sv.get("embedded_chunks"),
    })

summary = {
    "phase": 18,
    "ticket": "T18.7" if os.path.exists(baseline_json) or capture_baseline else "T18.6",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "prompts": len(rows),
    "issues": issues,
    "pass": len(issues) == 0,
    "shadow_latency_p50_ms": percentile(shadow_lats, 50),
    "shadow_latency_p95_ms": percentile(shadow_lats, 95),
    "shadow_source_types_union": sorted(all_shadow_types),
    "overlap_summary": overlap_rows,
    "results": rows,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

if capture_baseline:
    with open(baseline_json, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Baseline captured → {baseline_json}")

baseline = None
if os.path.exists(baseline_json) and not capture_baseline:
    with open(baseline_json) as f:
        baseline = json.load(f)

lines = [
    "# T18.6/T18.7 RAG shadow smoke",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Prompts: {len(rows)}",
    f"- Issues: {len(issues)}",
    f"- Shadow latency p50/p95 ms: {summary['shadow_latency_p50_ms']} / {summary['shadow_latency_p95_ms']}",
    f"- Shadow source types (union): {', '.join(summary['shadow_source_types_union']) or '(none)'}",
    "",
    "| Prompt | normal status | keyword refs | shadow candidates | overlap | shadow types | shadow latency ms |",
    "|--------|---------------|-------------:|------------------:|--------:|--------------|------------------:|",
]
for r in rows:
    n, s = r["normal"], r["shadow"]
    sv = s.get("shadow_vector") or {}
    types = ", ".join(r["shadow"].get("shadow_source_types") or [])
    lines.append(
        f"| {r['prompt_id']} | {n.get('source_status')} | {n.get('source_refs_count', 0)} | "
        f"{sv.get('candidate_count', '')} | {sv.get('overlap_with_keyword', '')} | {types} | {sv.get('latency_ms', '')} |"
    )
if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]
with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

if baseline and not capture_baseline:
    comp = [
        "# T18.7 shadow quality comparison (before vs after controlled backfill)",
        "",
        f"**Generated:** {summary['generated_at']}",
        f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
        "",
        "## Latency",
        "",
        "| phase | p50 ms | p95 ms |",
        "|-------|-------:|-------:|",
        f"| before | {baseline.get('shadow_latency_p50_ms')} | {baseline.get('shadow_latency_p95_ms')} |",
        f"| after | {summary['shadow_latency_p50_ms']} | {summary['shadow_latency_p95_ms']} |",
        "",
        "## Shadow source types (union)",
        "",
        f"- before: {', '.join(baseline.get('shadow_source_types_union') or []) or '(none)'}",
        f"- after: {', '.join(summary['shadow_source_types_union']) or '(none)'}",
        "",
        "## Overlap by prompt",
        "",
        "| prompt | overlap before | overlap after | candidates before | candidates after |",
        "|--------|---------------:|--------------:|------------------:|-----------------:|",
    ]
    before_map = {x["prompt_id"]: x for x in baseline.get("overlap_summary", [])}
    for row in overlap_rows:
        b = before_map.get(row["prompt_id"], {})
        comp.append(
            f"| {row['prompt_id']} | {b.get('overlap', '')} | {row.get('overlap', '')} | "
            f"{b.get('shadow_candidates', '')} | {row.get('shadow_candidates', '')} |"
        )
    comp += [
        "",
        "## Notes",
        "",
        "- Keyword `summary` and `source_refs` must match normal vs shadow (validated).",
        "- Low overlap expected when keyword ranks unembedded source types; improves as balanced embeddings grow.",
        "- Retrieval default remains **keyword**; shadow is opt-in only.",
        "",
    ]
    if issues:
        comp += ["## Issues", ""] + [f"- {i}" for i in issues]
    with open(compare_md, "w") as f:
        f.write("\n".join(comp) + "\n")
    print(f"Comparison → {compare_md}")

print(f"Report: {md_out}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY
