#!/usr/bin/env bash
# T20.10B — Real-query shadow timing harness (read-only; keyword remains default).
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

python3 <<'PY'
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "180")
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
                **result,
            }
            rows.append(row)
            out.write(json.dumps(row) + "\n")

shadow_totals = []
overlaps = []
selected_counts = []
for r in rows:
    if not r["mode"].startswith("shadow"):
        continue
    sd = (r.get("response") or {}).get("details", {}).get("shadow_diagnostics") or {}
    if sd:
        shadow_totals.append(float(sd.get("timings_ms", {}).get("total") or 0))
    overlaps.append(int(sd.get("overlap", {}).get("count") or 0))
    selected_counts.append(int(sd.get("counts", {}).get("selected_count") or 0))

summary = {
    "ticket": "T20.10B",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "total_runs": len(rows),
    "shadow_runs": sum(1 for r in rows if r["mode"].startswith("shadow")),
    "shadow_total_ms_p50": percentile(shadow_totals, 50),
    "shadow_total_ms_p95": percentile(shadow_totals, 95),
    "shadow_overlap_zero_runs": sum(1 for o in overlaps if o == 0),
    "shadow_empty_runs": sum(1 for c in selected_counts if c == 0),
}

lines = [
    "# T20.10 real-query timing",
    "",
    f"- Raw: `{jsonl_out}`",
    f"- Generated: {summary['generated_at']}",
    "",
    "## Aggregate",
    "",
    f"- shadow p50 total ms: {summary['shadow_total_ms_p50']}",
    f"- shadow p95 total ms: {summary['shadow_total_ms_p95']}",
    f"- zero-overlap shadow runs: {summary['shadow_overlap_zero_runs']}/{summary['shadow_runs']}",
    f"- zero-result shadow runs: {summary['shadow_empty_runs']}/{summary['shadow_runs']}",
    "",
    "## Per-run summary",
    "",
    "| mode | profile | http_time_s | selected_count | overlap_count | total_ms | query |",
    "|---|---:|---:|---:|---:|---:|---|",
]
for r in rows:
    sd = (r.get("response") or {}).get("details", {}).get("shadow_diagnostics") or {}
    counts = sd.get("counts") or {}
    overlap = sd.get("overlap") or {}
    timings = sd.get("timings_ms") or {}
    q = r["query"][:72] + ("…" if len(r["query"]) > 72 else "")
    lines.append(
        f"| {r['mode']} | {r.get('profile') or ''} | {r.get('http_time_s', 0):.3f} | "
        f"{counts.get('selected_count', '')} | {overlap.get('count', '')} | "
        f"{timings.get('total', '')} | {q} |"
    )

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Wrote:\n  {jsonl_out}\n  {md_out}")
print(f"shadow p50/p95 ms: {summary['shadow_total_ms_p50']} / {summary['shadow_total_ms_p95']}")
sys.exit(0)
PY

echo "✅ T20.10B complete"
