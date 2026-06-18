#!/usr/bin/env bash
# T19.4B/T19.5B — Read-only shadow vector source diagnostic (global + route-weighted profiles).
# COMMIT GUARD: commit only after all gates pass and embedded count unchanged.
#   T19_DIAG_GATES_PASSED=1 EMBEDDED_EXPECTED=4547 bash scripts/lib/rp-ai-diagnostics-commit-guard.sh
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

REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t19-5-route-shadow-diagnostic.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-5-route-shadow-diagnostic.md}"
CURL_TIMEOUT="${SHADOW_DIAG_CURL_TIMEOUT:-180}"
mkdir -p "$(dirname "$REPORT_JSON")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T19.5B route shadow diagnostic (read-only) ==="

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP REPORT_JSON REPORT_MD CURL_TIMEOUT CURL_RESOLVE="record-platform.test:443:${LB_IP}"

python3 <<'PY'
import json, os, re, subprocess, sys, statistics
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "120")
json_out = os.environ["REPORT_JSON"]
md_out = os.environ["REPORT_MD"]

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo", re.I)

# prompt_id, question, shadow_profile
PROMPTS = [
    ("obo_counter", "What should I counter on this OBO listing?", "obo_helper"),
    ("underpriced_records", "Which records in my collection look underpriced?", "record_valuation"),
    ("seller_summary", "Summarize my seller performance.", "seller_sales_summary"),
    ("buyer_summary", "Summarize my buyer collection.", "buyer_collection_summary"),
    ("listing_quality", "Find listing quality problems I should fix.", "pricing_recommendation"),
    ("notifications", "Summarize recent marketplace AI notifications.", "generic_rag"),
    ("auction_risk", "Why is this auction risky?", "auction_risk"),
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


def dist_from_sv(sv):
    if not sv:
        return {}
    if sv.get("source_type_distribution"):
        return dict(sv["source_type_distribution"])
    out = {}
    for item in sv.get("top_source_types") or []:
        st = item.get("source_type")
        if st:
            out[st] = out.get(st, 0) + int(item.get("count") or 0)
    return out


def types_from_dist(dist):
    return sorted(dist.keys())


def call_rag(question, *, shadow: bool, profile: str | None = None, retries: int = 2):
    last = {}
    for attempt in range(retries + 1):
        params = []
        if shadow:
            params.append("shadow_vector=1")
        if profile:
            params.append(f"shadow_profile={profile}")
        qs = ("?" + "&".join(params)) if params else ""
        cmd = [
            "curl", "-sfS", "--max-time", curl_timeout, "--cacert", ca, "--resolve", resolve,
            "-H", f"Authorization: Bearer {token}",
            "-H", "X-RP-E2E-Contract: 1",
            "-X", "POST", "-H", "Content-Type: application/json",
            "-d", json.dumps({"question": question}),
            "-w", "\n%{http_code}",
            base + "/api/ai/rag/query" + qs,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            last = {"error": (proc.stderr or proc.stdout)[:240], "http_status": 0}
            if attempt < retries and "504" in (proc.stderr or proc.stdout):
                continue
            return last
        lines = proc.stdout.rsplit("\n", 1)
        raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {"parse_error": True, "http_status": int(code_s or 0)}
        sv = (data.get("details") or {}).get("shadow_vector") or {}
        uw = sv.get("unweighted") or {}
        last = {
            "http_status": int(code_s),
            "summary": data.get("summary"),
            "source_refs_count": len(data.get("source_refs") or []),
            "retrieval_mode": (data.get("details") or {}).get("retrieval_mode"),
            "shadow_vector": sv,
            "weighted_dist": dist_from_sv(sv),
            "unweighted_dist": dist_from_sv(uw) if uw else dist_from_sv(sv),
            "weighted_types": types_from_dist(dist_from_sv(sv)),
            "unweighted_types": types_from_dist(dist_from_sv(uw)) if uw else types_from_dist(dist_from_sv(sv)),
            "weighted_candidates": sv.get("weighted_candidate_count", sv.get("candidate_count")),
            "unweighted_candidates": (uw.get("candidate_count") if uw else sv.get("unweighted_candidate_count")),
            "overlap_weighted": sv.get("overlap_with_keyword"),
            "overlap_unweighted": uw.get("overlap_with_keyword"),
            "profile": sv.get("profile"),
            "preferred_source_types": sv.get("preferred_source_types") or [],
            "preferred_zero_owner_visible": sv.get("preferred_zero_owner_visible") or [],
            "latency_ms": sv.get("latency_ms"),
            "raw_blob": json.dumps(data)[:4000],
        }
        if int(code_s) < 500:
            return last
        if attempt < retries:
            continue
    return last


def leakage_scan(blob):
    issues = []
    if FORBIDDEN.search(blob or ""):
        issues.append("forbidden_prose")
    if LEAK_RE.search(blob or ""):
        issues.append("possible_private_leak")
    return issues


issues = []
rows = []
weighted_lats = []
all_weighted_types = set()

for pid, question, profile in PROMPTS:
    keyword = call_rag(question, shadow=False)
    shadow = call_rag(question, shadow=True, profile=profile)

    row = {
        "prompt_id": pid,
        "question": question,
        "profile": profile,
        "keyword": {k: keyword.get(k) for k in ("http_status", "summary", "source_refs_count", "retrieval_mode")},
        "shadow": shadow,
    }
    rows.append(row)

    if shadow.get("latency_ms") is not None:
        weighted_lats.append(float(shadow["latency_ms"]))
    for st in shadow.get("weighted_types") or []:
        all_weighted_types.add(st)

    for label, resp in (("keyword", keyword), ("shadow", shadow)):
        if resp.get("http_status", 0) >= 500 or resp.get("error"):
            issues.append(f"{pid}/{label}: request failed")
        for leak in leakage_scan(resp.get("raw_blob") or json.dumps(resp)):
            issues.append(f"{pid}/{label}: {leak}")

    if keyword.get("retrieval_mode") and keyword.get("retrieval_mode") != "keyword":
        issues.append(f"{pid}: retrieval_mode not keyword")
    if shadow.get("summary") != keyword.get("summary"):
        issues.append(f"{pid}: summary changed with shadow enabled")
    if shadow.get("source_refs_count") != keyword.get("source_refs_count"):
        issues.append(f"{pid}: source_refs count changed with shadow enabled")
    if shadow.get("profile") and shadow["profile"] != profile:
        resolved = profile.replace("pricing_recommendation", "obo_helper").replace(
            "buyer_collection_summary", "record_valuation"
        )
        if shadow["profile"] != resolved:
            issues.append(f"{pid}: profile mismatch expected={profile} got={shadow.get('profile')}")

# Acceptance: surfaced types across weighted profiles (owner-filter aware)
record_profiles = {"record_valuation", "buyer_collection_summary"}
obo_profiles = {"obo_helper", "pricing_recommendation"}
notif_profiles = {"seller_sales_summary", "generic_rag", "auction_risk"}

record_surfaced = any(
    "record" in (r["shadow"].get("weighted_types") or [])
    for r in rows if r["profile"] in record_profiles
)
obo_surfaced = any(
    "obo_offer_summary" in (r["shadow"].get("weighted_types") or [])
    for r in rows if r["profile"] in obo_profiles
)
notif_surfaced = any(
    "notification" in (r["shadow"].get("weighted_types") or [])
    for r in rows if r["profile"] in notif_profiles
)

record_zero_reason = []
obo_zero_reason = []
notif_zero_reason = []
for r in rows:
    z = r["shadow"].get("preferred_zero_owner_visible") or []
    if "record" in z:
        record_zero_reason.append(r["prompt_id"])
    if "obo_offer_summary" in z:
        obo_zero_reason.append(r["prompt_id"])
    if "notification" in z:
        notif_zero_reason.append(r["prompt_id"])

if not record_surfaced and not record_zero_reason:
    issues.append("record: not surfaced in record/buyer profiles and not owner-filtered")
if not obo_surfaced and len(obo_zero_reason) < len([r for r in rows if r["profile"] in obo_profiles]):
    issues.append("obo_offer_summary: not surfaced where owner-visible candidates expected")
if not notif_surfaced and len(notif_zero_reason) == 0:
    issues.append("notification: not surfaced in seller/generic profiles and not owner-filtered")
if len(all_weighted_types) < 4:
    issues.append(f"weighted_union_types: only {sorted(all_weighted_types)} (need >=4 when owner-visible)")

summary = {
    "ticket": "T19.5B",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "prompts": len(rows),
    "issues": issues,
    "pass": len(issues) == 0,
    "weighted_source_types_union": sorted(all_weighted_types),
    "record_surfaced": record_surfaced,
    "obo_offer_summary_surfaced": obo_surfaced,
    "notification_surfaced": notif_surfaced,
    "record_zero_owner_visible_prompts": record_zero_reason,
    "obo_zero_owner_visible_prompts": obo_zero_reason,
    "notification_zero_owner_visible_prompts": notif_zero_reason,
    "shadow_latency_p50_ms": percentile(weighted_lats, 50),
    "shadow_latency_p95_ms": percentile(weighted_lats, 95),
    "results": rows,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T19.5B — Route shadow diagnostic (unweighted vs weighted profiles)",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Prompts: {len(rows)}",
    f"- Issues: {len(issues)}",
    f"- Weighted source types (union): {', '.join(summary['weighted_source_types_union']) or '(none)'}",
    f"- Latency p50/p95 ms: {summary['shadow_latency_p50_ms']} / {summary['shadow_latency_p95_ms']}",
    f"- record surfaced: {record_surfaced} (zero-owner prompts: {record_zero_reason or 'none'})",
    f"- obo_offer_summary surfaced: {obo_surfaced} (zero-owner prompts: {obo_zero_reason or 'none'})",
    f"- notification surfaced: {notif_surfaced} (zero-owner prompts: {notif_zero_reason or 'none'})",
    "",
    "| prompt | profile | unweighted types | weighted types | uw cand | w cand | uw overlap | w overlap | latency ms |",
    "|--------|---------|------------------|----------------|--------:|-------:|-----------:|----------:|-----------:|",
]
for r in rows:
    s = r["shadow"]
    lines.append(
        f"| {r['prompt_id']} | {r['profile']} | {', '.join(s.get('unweighted_types') or [])} | "
        f"{', '.join(s.get('weighted_types') or [])} | {s.get('unweighted_candidates', '')} | "
        f"{s.get('weighted_candidates', '')} | {s.get('overlap_unweighted', '')} | "
        f"{s.get('overlap_weighted', '')} | {s.get('latency_ms', '')} |"
    )

lines += [
    "",
    "## Keyword stability",
    "",
    "| prompt | refs | retrieval_mode | summary unchanged |",
    "|--------|-----:|----------------|-------------------|",
]
for r in rows:
    kw = r["keyword"]
    unchanged = r["shadow"].get("summary") == kw.get("summary")
    lines.append(
        f"| {r['prompt_id']} | {kw.get('source_refs_count', 0)} | {kw.get('retrieval_mode', '')} | {unchanged} |"
    )

if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"Union weighted types: {summary['weighted_source_types_union']}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY

echo "✅ T19.5B complete"
