#!/usr/bin/env bash
# T18.6 — Hybrid retrieval shadow diagnostics smoke (keyword default; shadow_vector=1 only).
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
mkdir -p "$(dirname "$REPORT_MD")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T18.6 RAG shadow smoke ==="

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP REPORT_MD REPORT_JSON CURL_RESOLVE="record-platform.test:443:${LB_IP}"
python3 <<'PY'
import json, os, re, subprocess, sys, time

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
md_out = os.environ["REPORT_MD"]
json_out = os.environ["REPORT_JSON"]

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo", re.I)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

PROMPTS = [
    ("auction_risk", "Why is this auction risky?"),
    ("obo_counter", "What should I counter on this OBO listing?"),
    ("underpriced_records", "Which records in my collection look underpriced?"),
    ("seller_summary", "Summarize my seller performance."),
    ("buyer_summary", "Summarize my buyer collection."),
]


def call(path, body, *, shadow: bool):
    cmd = [
        "curl", "-sfS", "--max-time", "60", "--cacert", ca, "--resolve", resolve,
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
    return {
        "shadow": shadow,
        "http_status": int(code_s),
        "latency_ms": lat,
        "source_status": data.get("source_status"),
        "model_used": data.get("model_used"),
        "summary": data.get("summary"),
        "source_refs_count": len(data.get("source_refs") or []),
        "retrieval_mode": (data.get("details") or {}).get("retrieval_mode"),
        "shadow_vector": (data.get("details") or {}).get("shadow_vector"),
        "degraded_reason": data.get("degraded_reason"),
        "raw_blob": json.dumps(data)[:4000],
    }


issues = []
rows = []
for pid, question in PROMPTS:
    body = {"question": question}
    normal = call("/api/ai/rag/query", body, shadow=False)
    shadow = call("/api/ai/rag/query", body, shadow=True)
    row = {
        "prompt_id": pid,
        "question": question,
        "normal": normal,
        "shadow": shadow,
    }
    rows.append(row)

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

    if normal.get("retrieval_mode") and normal.get("retrieval_mode") != "keyword":
        issues.append(f"{pid}: normal retrieval_mode not keyword")

    sv = shadow.get("shadow_vector")
    if not sv:
        issues.append(f"{pid}: shadow_vector diagnostics missing")
    elif sv.get("enabled") is not True:
        issues.append(f"{pid}: shadow_vector.enabled not true")
    else:
        for key in ("candidate_count", "overlap_with_keyword", "latency_ms"):
            if key not in sv:
                issues.append(f"{pid}: shadow_vector missing {key}")

    if normal.get("summary") != shadow.get("summary"):
        issues.append(f"{pid}: summary changed with shadow enabled")
    if normal.get("source_refs_count") != shadow.get("source_refs_count"):
        issues.append(f"{pid}: source_refs count changed with shadow enabled")

summary = {
    "phase": 18,
    "ticket": "T18.6",
    "prompts": len(rows),
    "issues": issues,
    "pass": len(issues) == 0,
    "overlap_summary": [
        {
            "prompt_id": r["prompt_id"],
            "overlap": (r["shadow"].get("shadow_vector") or {}).get("overlap_with_keyword"),
            "shadow_candidates": (r["shadow"].get("shadow_vector") or {}).get("candidate_count"),
            "shadow_latency_ms": (r["shadow"].get("shadow_vector") or {}).get("latency_ms"),
            "shadow_status": (r["shadow"].get("shadow_vector") or {}).get("status"),
        }
        for r in rows
    ],
    "results": rows,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T18.6 RAG shadow smoke",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Prompts: {len(rows)}",
    f"- Issues: {len(issues)}",
    "",
    "| Prompt | normal status | shadow status | keyword refs | shadow candidates | overlap | shadow latency ms |",
    "|--------|---------------|---------------|-------------:|------------------:|--------:|------------------:|",
]
for r in rows:
    n, s = r["normal"], r["shadow"]
    sv = s.get("shadow_vector") or {}
    lines.append(
        f"| {r['prompt_id']} | {n.get('source_status')} | {s.get('source_status')} | "
        f"{n.get('source_refs_count', 0)} | {sv.get('candidate_count', '')} | "
        f"{sv.get('overlap_with_keyword', '')} | {sv.get('latency_ms', '')} |"
    )
if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]
with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY
