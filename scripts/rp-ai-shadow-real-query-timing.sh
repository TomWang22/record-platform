#!/usr/bin/env bash
# T20.10B/T20.10E — Real-query shadow timing harness (read-only; keyword remains default).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

OUTPUT_DIR="${OUTPUT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RAW_JSONL="${RAW_JSONL:-$OUTPUT_DIR/t20-10-shadow-real-query-${STAMP}.jsonl}"
SUMMARY_MD="${SUMMARY_MD:-$OUTPUT_DIR/t20-10-shadow-real-query-${STAMP}.md}"
CURL_TIMEOUT="${SHADOW_DIAG_CURL_TIMEOUT:-180}"
BENCH_WARMUP_RUNS="${BENCH_WARMUP_RUNS:-1}"
mkdir -p "$OUTPUT_DIR"

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="${API_BASE:-https://record-platform.test}"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T20.10B real-query shadow timing (read-only) ==="

LOGIN_JSON="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}")"
TOKEN="$(printf '%s' "$LOGIN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP RAW_JSONL SUMMARY_MD CURL_TIMEOUT CURL_RESOLVE="record-platform.test:443:${LB_IP}"
export BENCH_WARMUP_RUNS

python3 <<'PY'
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "180")
bench_warmup_runs = int(os.environ.get("BENCH_WARMUP_RUNS", "1") or "0")
jsonl_out = os.environ["RAW_JSONL"]
md_out = os.environ["SUMMARY_MD"]

QUERIES = [
    "Summarize the latest offers I have received on my listings and what changed most recently.",
    "Give me an owner-visible summary of OBO activity for my active listings.",
    "What are the most recent pricing or revision changes across my listings?",
    "Summarize listing activity and buyer interest for my catalog this week.",
    "What notifications matter most for my selling activity right now?",
    "Show a concise summary of bidding and offer activity tied to my records.",
    "What changed recently on listing revisions that may affect offer conversion?",
    "Summarize my private seller-side negotiation context without exposing messages.",
]

CASES = [
    ("keyword", None, False, False, None),
    ("shadow_default", None, True, False, None),
    ("shadow_obo_owner", "obo_helper", True, True, "obo,owner_visible"),
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


def call_rag(question, *, shadow: bool, profile: str | None, profile_hints: bool, custom_hints: str | None):
    params = []
    if shadow:
        params.extend(["shadow_vector=1", "shadow_debug=1"])
    if profile:
        params.append(f"shadow_profile={profile}")
    if profile_hints:
        params.append("shadow_profile_hints=1")
    if custom_hints:
        params.append(f"shadow_query_hints={custom_hints}")
    qs = ("?" + "&".join(params)) if params else ""
    with tempfile.NamedTemporaryFile(mode="w+", delete=False) as tmp:
        tmp_path = tmp.name
    cmd = [
        "curl", "-sfS", "--max-time", curl_timeout, "--cacert", ca, "--resolve", resolve,
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
        "-X", "POST", "-H", "Content-Type: application/json",
        "-d", json.dumps({"question": question}),
        "-o", tmp_path,
        "-w", "%{time_total}",
        base + "/api/ai/rag/query" + qs,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    http_time = float(proc.stdout.strip() or 0) if proc.returncode == 0 else 0.0
    try:
        with open(tmp_path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        data = {"error": (proc.stderr or proc.stdout)[:240]}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return {"http_time_s": http_time, "response": data}


rows = []
with open(jsonl_out, "w") as out:
    warmup_query = QUERIES[1]
    for i in range(bench_warmup_runs):
        result = call_rag(
            warmup_query,
            shadow=True,
            profile="obo_helper",
            profile_hints=True,
            custom_hints="obo,owner_visible",
        )
        row = {
            "mode": "warmup_shadow_obo_owner",
            "profile": "obo_helper",
            "query": warmup_query,
            "warmup": True,
            **result,
        }
        rows.append(row)
        out.write(json.dumps(row) + "\n")

    for query in QUERIES:
        for mode, profile, shadow, profile_hints, custom_hints in CASES:
            result = call_rag(
                query,
                shadow=shadow,
                profile=profile,
                profile_hints=profile_hints,
                custom_hints=custom_hints,
            )
            row = {
                "mode": mode,
                "profile": profile or "",
                "query": query,
                "warmup": False,
                **result,
            }
            rows.append(row)
            out.write(json.dumps(row) + "\n")

shadow_totals = []
embed_latencies = []
overlaps = []
doc_overlaps = []
entity_overlaps = []
overlap_reasons = []
selected_counts = []
embed_outliers = []
for r in rows:
    if r.get("warmup"):
        continue
    if not r["mode"].startswith("shadow"):
        continue
    sd = (r.get("response") or {}).get("details", {}).get("shadow_diagnostics") or {}
    ov = sd.get("overlap") or {}
    expl = ov.get("explanation") or {}
    if sd:
        shadow_totals.append(float(sd.get("timings_ms", {}).get("total") or 0))
        embed = sd.get("embed") or {}
        embed_ms = float(embed.get("latency_ms") or sd.get("timings_ms", {}).get("embed") or 0)
        embed_latencies.append(embed_ms)
        if embed.get("timed_out") or embed_ms >= 5000:
            embed_outliers.append({
                "mode": r["mode"],
                "profile": r.get("profile"),
                "embed_ms": embed_ms,
                "timed_out": embed.get("timed_out"),
                "hint_terms": len(sd.get("query_hints") or []),
                "expanded_len": embed.get("expanded_query_length"),
                "cache_hit": embed.get("cache_hit"),
                "query_prefix": (r.get("query") or "")[:72],
            })
    chunk_ov = int(ov.get("count") or 0)
    overlaps.append(chunk_ov)
    doc_overlaps.append(int(ov.get("document_overlap_count") or expl.get("document_overlap_count") or 0))
    entity_overlaps.append(int(ov.get("entity_overlap_count") or expl.get("entity_overlap_count") or 0))
    if chunk_ov == 0:
        reason = expl.get("zero_overlap_reason") or "unknown"
        overlap_reasons.append(reason)
    selected_counts.append(int(sd.get("counts", {}).get("selected_count") or 0))

reason_counts = Counter(overlap_reasons)

summary = {
    "ticket": "T20.10G",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "warmup_runs": bench_warmup_runs,
    "total_runs": len([r for r in rows if not r.get("warmup")]),
    "shadow_runs": sum(1 for r in rows if r["mode"].startswith("shadow") and not r.get("warmup")),
    "shadow_total_ms_p50": percentile(shadow_totals, 50),
    "shadow_total_ms_p95": percentile(shadow_totals, 95),
    "embed_ms_p50": percentile(embed_latencies, 50),
    "embed_ms_p95": percentile(embed_latencies, 95),
    "shadow_overlap_zero_runs": sum(1 for o in overlaps if o == 0),
    "shadow_doc_overlap_gt0_runs": sum(1 for o in doc_overlaps if o > 0),
    "shadow_entity_overlap_gt0_runs": sum(1 for o in entity_overlaps if o > 0),
    "shadow_empty_runs": sum(1 for c in selected_counts if c == 0),
    "embed_outlier_count": len(embed_outliers),
    "zero_overlap_reason_counts": dict(sorted(reason_counts.items())),
}

lines = [
    "# T20.10 real-query timing",
    "",
    f"- Raw: `{jsonl_out}`",
    f"- Generated: {summary['generated_at']}",
    f"- Warmup runs (excluded from aggregates): {summary['warmup_runs']}",
    "",
    "## Aggregate",
    "",
    f"- shadow p50 total ms: {summary['shadow_total_ms_p50']}",
    f"- shadow p95 total ms: {summary['shadow_total_ms_p95']}",
    f"- embed p50 ms: {summary['embed_ms_p50']}",
    f"- embed p95 ms: {summary['embed_ms_p95']}",
    f"- embed outliers (>=5s or timeout): {summary['embed_outlier_count']}",
    f"- zero-overlap shadow runs: {summary['shadow_overlap_zero_runs']}/{summary['shadow_runs']}",
    f"- document-overlap >0 runs: {summary['shadow_doc_overlap_gt0_runs']}/{summary['shadow_runs']}",
    f"- entity-overlap >0 runs: {summary['shadow_entity_overlap_gt0_runs']}/{summary['shadow_runs']}",
    f"- zero-result shadow runs: {summary['shadow_empty_runs']}/{summary['shadow_runs']}",
    "",
]
if summary.get("zero_overlap_reason_counts"):
    lines.extend([
        "## Zero-overlap reasons (chunk overlap=0)",
        "",
    ])
    for reason, cnt in summary["zero_overlap_reason_counts"].items():
        lines.append(f"- {reason}: {cnt}")
    lines.append("")
if embed_outliers:
    lines.extend([
        "## Embed outliers",
        "",
        "| mode | profile | embed_ms | timed_out | hint_terms | expanded_len | cache_hit | query |",
        "|---|---:|---:|:---:|:---:|:---:|:---:|---|",
    ])
    for o in embed_outliers:
        lines.append(
            f"| {o['mode']} | {o.get('profile') or ''} | {o.get('embed_ms')} | "
            f"{o.get('timed_out')} | {o.get('hint_terms')} | {o.get('expanded_len')} | "
            f"{o.get('cache_hit')} | {o.get('query_prefix')} |"
        )
    lines.append("")

lines.extend([
    "## Per-run summary",
    "",
    "| mode | profile | warmup | http_time_s | selected_count | chunk_ov | doc_ov | entity_ov | reason | total_ms | query |",
    "|---|---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|---|",
])
for r in rows:
    sd = (r.get("response") or {}).get("details", {}).get("shadow_diagnostics") or {}
    counts = sd.get("counts") or {}
    overlap = sd.get("overlap") or {}
    expl = overlap.get("explanation") or {}
    timings = sd.get("timings_ms") or {}
    q = r["query"][:72] + ("…" if len(r["query"]) > 72 else "")
    reason = expl.get("zero_overlap_reason") or ("" if overlap.get("count") else "")
    lines.append(
        f"| {r['mode']} | {r.get('profile') or ''} | {r.get('warmup', False)} | {r.get('http_time_s', 0):.3f} | "
        f"{counts.get('selected_count', '')} | {overlap.get('count', '')} | "
        f"{overlap.get('document_overlap_count', '')} | {overlap.get('entity_overlap_count', '')} | "
        f"{reason} | {timings.get('total', '')} | {q} |"
    )

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Wrote:\n  {jsonl_out}\n  {md_out}")
print(
    f"shadow p50/p95 ms: {summary['shadow_total_ms_p50']} / {summary['shadow_total_ms_p95']} | "
    f"embed p50/p95 ms: {summary['embed_ms_p50']} / {summary['embed_ms_p95']}"
)
sys.exit(0)
PY

echo "✅ T20.10G benchmark summary written"
