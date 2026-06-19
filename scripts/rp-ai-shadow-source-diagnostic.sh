#!/usr/bin/env bash
# T19.4B/T19.5B/T19.6C — Read-only shadow vector quality diagnostic.
# Compares: unweighted global | route-weighted | route-weighted + query hints.
# COMMIT GUARD: commit only after all gates pass and embedded count unchanged.
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

REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t19-6-route-shadow-quality.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-6-route-shadow-quality.md}"
CURL_TIMEOUT="${SHADOW_DIAG_CURL_TIMEOUT:-180}"
mkdir -p "$(dirname "$REPORT_JSON")"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T19.6C route shadow quality diagnostic (read-only) ==="

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

LOGIN_JSON="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}")"
TOKEN="$(printf '%s' "$LOGIN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP REPORT_JSON REPORT_MD CURL_TIMEOUT CURL_RESOLVE="record-platform.test:443:${LB_IP}" LOGIN_JSON

python3 <<'PY'
import base64
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "120")
json_out = os.environ["REPORT_JSON"]
md_out = os.environ["REPORT_MD"]
login_json = os.environ.get("LOGIN_JSON", "{}")

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo", re.I)

PROMPTS = [
    ("obo_counter", "What should I counter on this OBO listing?", "obo_helper"),
    ("underpriced_records", "Which records in my collection look underpriced?", "record_valuation"),
    ("seller_summary", "Summarize my seller performance.", "seller_sales_summary"),
    ("buyer_summary", "Summarize my buyer collection.", "buyer_collection_summary"),
    ("listing_quality", "Find listing quality problems I should fix.", "pricing_recommendation"),
    ("notifications", "Summarize recent marketplace AI notifications.", "generic_rag"),
    ("auction_risk", "Why is this auction risky?", "auction_risk"),
]


def user_id_from_token(jwt_token: str) -> str | None:
    try:
        payload = jwt_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return str(data.get("sub") or data.get("userId") or "")
    except Exception:
        return None


def psql_scalar(sql: str) -> int:
    cmd = [
        "env", "PGPASSWORD=postgres", "PGCONNECT_TIMEOUT=5",
        "psql", "-h", "127.0.0.1", "-p", "5440", "-U", "postgres", "-d", "python_ai",
        "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 0
    try:
        return int((proc.stdout or "0").strip() or 0)
    except ValueError:
        return 0


def obo_owner_visible_diagnostic(user_id: str | None) -> dict:
    total_embedded = psql_scalar(
        """
        SELECT COUNT(*) FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE c.embedding_vec IS NOT NULL AND d.source_type = 'obo_offer_summary'
        """
    )
    public_embedded = psql_scalar(
        """
        SELECT COUNT(*) FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE c.embedding_vec IS NOT NULL AND d.source_type = 'obo_offer_summary'
          AND d.visibility = 'public'
        """
    )
    owner_embedded = 0
    user_obo_docs = 0
    if user_id:
        uid = user_id.replace("'", "''")
        owner_embedded = psql_scalar(
            f"""
            SELECT COUNT(*) FROM ai.ai_document_chunks c
            JOIN ai.ai_documents d ON d.id = c.document_id
            WHERE c.embedding_vec IS NOT NULL AND d.source_type = 'obo_offer_summary'
              AND (d.visibility = 'public'
                   OR (d.visibility = 'owner' AND d.owner_user_id = '{uid}'::uuid))
            """
        )
        user_obo_docs = psql_scalar(
            f"""
            SELECT COUNT(*) FROM ai.ai_documents
            WHERE source_type = 'obo_offer_summary' AND owner_user_id = '{uid}'::uuid
            """
        )
    recommended_fix = None
    if owner_embedded == 0 and total_embedded > 0:
        recommended_fix = (
            "Seed or ingest owner-visible obo_offer_summary documents for the contract user "
            "(owner visibility + embedded chunks). Global OBO embeddings exist but none are "
            "visible to this user."
        )
    elif total_embedded == 0:
        recommended_fix = "Ingest and embed obo_offer_summary documents before shadow OBO routing can surface them."
    return {
        "total_embedded_obo_offer_summary": total_embedded,
        "owner_visible_embedded_obo": owner_embedded,
        "public_visible_embedded_obo": public_embedded,
        "contract_user_obo_documents": user_obo_docs,
        "contract_user_id": user_id,
        "recommended_fix": recommended_fix,
    }


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


def parse_shadow_response(data):
    sv = (data.get("details") or {}).get("shadow_vector") or {}
    uw = sv.get("unweighted") or {}
    weighted_dist = dist_from_sv(sv)
    unweighted_dist = dist_from_sv(uw) if uw else weighted_dist
    return {
        "shadow_vector": sv,
        "source_types": types_from_dist(weighted_dist),
        "unweighted_types": types_from_dist(unweighted_dist),
        "candidate_count": sv.get("weighted_candidate_count", sv.get("candidate_count")),
        "unweighted_candidates": uw.get("candidate_count") if uw else sv.get("unweighted_candidate_count"),
        "overlap": sv.get("overlap_with_keyword"),
        "unweighted_overlap": uw.get("overlap_with_keyword"),
        "profile": sv.get("profile"),
        "preferred_zero_owner_visible": sv.get("preferred_zero_owner_visible") or [],
        "query_hint_applied": sv.get("query_hint_applied"),
        "expanded_query_terms": sv.get("expanded_query_terms") or [],
        "latency_ms": sv.get("latency_ms"),
        "top_results": sv.get("top_results") or [],
    }


def call_rag(question, *, shadow: bool, profile: str | None = None, query_hints: bool = False, retries: int = 2):
    last = {}
    for attempt in range(retries + 1):
        params = []
        if shadow:
            params.append("shadow_vector=1")
        if profile:
            params.append(f"shadow_profile={profile}")
        if query_hints:
            params.append("shadow_query_hints=1")
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
        parsed = parse_shadow_response(data)
        last = {
            "http_status": int(code_s),
            "summary": data.get("summary"),
            "source_refs_count": len(data.get("source_refs") or []),
            "retrieval_mode": (data.get("details") or {}).get("retrieval_mode"),
            "raw_blob": json.dumps(data)[:4000],
            **parsed,
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


def check_keyword_stable(pid, keyword, *shadow_responses):
    issues = []
    for label, resp in shadow_responses:
        if resp.get("http_status", 0) >= 500 or resp.get("error"):
            issues.append(f"{pid}/{label}: request failed")
        for leak in leakage_scan(resp.get("raw_blob") or json.dumps(resp)):
            issues.append(f"{pid}/{label}: {leak}")
    if keyword.get("retrieval_mode") and keyword.get("retrieval_mode") != "keyword":
        issues.append(f"{pid}: retrieval_mode not keyword")
    for label, resp in shadow_responses:
        if resp.get("summary") != keyword.get("summary"):
            issues.append(f"{pid}/{label}: summary changed with shadow enabled")
        if resp.get("source_refs_count") != keyword.get("source_refs_count"):
            issues.append(f"{pid}/{label}: source_refs count changed with shadow enabled")
    return issues


contract_user_id = user_id_from_token(token)
obo_diag = obo_owner_visible_diagnostic(contract_user_id)

issues = []
rows = []
unweighted_types_union = set()
weighted_types_union = set()
hinted_types_union = set()
hinted_lats = []

for pid, question, profile in PROMPTS:
    keyword = call_rag(question, shadow=False)
    unweighted = call_rag(question, shadow=True)
    weighted = call_rag(question, shadow=True, profile=profile)
    hinted = call_rag(question, shadow=True, profile=profile, query_hints=True)

    row = {
        "prompt_id": pid,
        "question": question,
        "profile": profile,
        "keyword": {k: keyword.get(k) for k in ("http_status", "summary", "source_refs_count", "retrieval_mode")},
        "unweighted_global": unweighted,
        "route_weighted": weighted,
        "route_weighted_hints": hinted,
    }
    rows.append(row)

    for st in unweighted.get("source_types") or []:
        unweighted_types_union.add(st)
    for st in weighted.get("source_types") or []:
        weighted_types_union.add(st)
    for st in hinted.get("source_types") or []:
        hinted_types_union.add(st)
    if hinted.get("latency_ms") is not None:
        hinted_lats.append(float(hinted["latency_ms"]))

    issues.extend(check_keyword_stable(
        pid, keyword,
        ("unweighted", unweighted),
        ("weighted", weighted),
        ("hinted", hinted),
    ))

    resolved = profile.replace("pricing_recommendation", "obo_helper").replace(
        "buyer_collection_summary", "record_valuation"
    )
    for label, resp in (("weighted", weighted), ("hinted", hinted)):
        if resp.get("profile") and resp["profile"] not in (profile, resolved):
            issues.append(f"{pid}/{label}: profile mismatch expected={profile} got={resp.get('profile')}")
    if hinted.get("query_hint_applied") is not True:
        issues.append(f"{pid}/hinted: query_hint_applied not true")

record_profiles = {"record_valuation", "buyer_collection_summary"}
obo_profiles = {"obo_helper", "pricing_recommendation"}

record_surfaced = any(
    "record" in (r["route_weighted_hints"].get("source_types") or [])
    for r in rows if r["profile"] in record_profiles
)
obo_surfaced = any(
    "obo_offer_summary" in (r["route_weighted_hints"].get("source_types") or [])
    for r in rows if r["profile"] in obo_profiles
)
obo_zero_reason = []
for r in rows:
    z = r["route_weighted_hints"].get("preferred_zero_owner_visible") or []
    if "obo_offer_summary" in z:
        obo_zero_reason.append(r["prompt_id"])

if not record_surfaced:
    issues.append("record: not surfaced in hinted record/buyer profiles")
if not obo_surfaced:
    if obo_diag.get("owner_visible_embedded_obo", 0) == 0:
        pass  # explained by OBO diagnostic
    elif len(obo_zero_reason) < len([r for r in rows if r["profile"] in obo_profiles]):
        issues.append("obo_offer_summary: not surfaced where owner-visible candidates expected")
if len(hinted_types_union) < 5:
    issues.append(f"hinted_union_types: only {sorted(hinted_types_union)} (need >=5 when owner-visible)")
if len(hinted_types_union) < len(weighted_types_union):
    issues.append("hinted_types: regression vs route-weighted diversity")

summary = {
    "ticket": "T19.6C",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "prompts": len(rows),
    "issues": issues,
    "pass": len(issues) == 0,
    "obo_owner_visible_diagnostic": obo_diag,
    "source_types_without_hints_union": sorted(unweighted_types_union),
    "source_types_route_weighted_union": sorted(weighted_types_union),
    "source_types_route_weighted_hints_union": sorted(hinted_types_union),
    "obo_offer_summary_surfaced": obo_surfaced,
    "obo_zero_owner_visible_prompts": obo_zero_reason,
    "shadow_latency_p50_ms": percentile(hinted_lats, 50),
    "shadow_latency_p95_ms": percentile(hinted_lats, 95),
    "results": rows,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T19.6C — Route shadow quality (unweighted vs weighted vs weighted+hints)",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Prompts: {len(rows)}",
    f"- Issues: {len(issues)}",
    f"- Types (unweighted global): {', '.join(summary['source_types_without_hints_union']) or '(none)'}",
    f"- Types (route weighted): {', '.join(summary['source_types_route_weighted_union']) or '(none)'}",
    f"- Types (weighted + hints): {', '.join(summary['source_types_route_weighted_hints_union']) or '(none)'}",
    f"- Latency p50/p95 ms (hinted): {summary['shadow_latency_p50_ms']} / {summary['shadow_latency_p95_ms']}",
    "",
    "## OBO owner-visible diagnostic (T19.6B)",
    "",
    f"- Total embedded obo_offer_summary: {obo_diag['total_embedded_obo_offer_summary']}",
    f"- Owner-visible embedded for contract user: {obo_diag['owner_visible_embedded_obo']}",
    f"- Public visible embedded OBO: {obo_diag['public_visible_embedded_obo']}",
    f"- Contract user OBO documents: {obo_diag['contract_user_obo_documents']}",
    f"- Recommended fix: {obo_diag.get('recommended_fix') or 'none'}",
    "",
    "| prompt | profile | uw types | w types | w+h types | uw cand | w cand | h cand | h overlap | h latency | hints |",
    "|--------|---------|----------|---------|-----------|--------:|-------:|-------:|----------:|----------:|-------|",
]
for r in rows:
    uw, w, h = r["unweighted_global"], r["route_weighted"], r["route_weighted_hints"]
    lines.append(
        f"| {r['prompt_id']} | {r['profile']} | {', '.join(uw.get('source_types') or [])} | "
        f"{', '.join(w.get('source_types') or [])} | {', '.join(h.get('source_types') or [])} | "
        f"{uw.get('candidate_count', '')} | {w.get('candidate_count', '')} | {h.get('candidate_count', '')} | "
        f"{h.get('overlap', '')} | {h.get('latency_ms', '')} | {h.get('query_hint_applied', '')} |"
    )

lines += [
    "",
    "## Top results (hinted, labels/source_ids only)",
    "",
]
for r in rows:
    tops = r["route_weighted_hints"].get("top_results") or []
    labels = ", ".join(
        f"{t.get('source_type')}:{t.get('source_id')}" for t in tops[:5]
    ) or "(none)"
    lines.append(f"- **{r['prompt_id']}**: {labels}")

lines += [
    "",
    "## Keyword stability",
    "",
    "| prompt | refs | retrieval_mode | summary unchanged |",
    "|--------|-----:|----------------|-------------------|",
]
for r in rows:
    kw = r["keyword"]
    unchanged = all(
        r[k].get("summary") == kw.get("summary")
        for k in ("unweighted_global", "route_weighted", "route_weighted_hints")
    )
    lines.append(
        f"| {r['prompt_id']} | {kw.get('source_refs_count', 0)} | {kw.get('retrieval_mode', '')} | {unchanged} |"
    )

if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"Unweighted types: {summary['source_types_without_hints_union']}")
print(f"Weighted types: {summary['source_types_route_weighted_union']}")
print(f"Hinted types: {summary['source_types_route_weighted_hints_union']}")
print(f"OBO owner-visible: {obo_diag['owner_visible_embedded_obo']} / total {obo_diag['total_embedded_obo_offer_summary']}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY

echo "✅ T19.6C complete"
