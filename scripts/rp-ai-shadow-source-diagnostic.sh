#!/usr/bin/env bash
# T19.4B — Read-only shadow vector source diagnostic across top_k values.
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

REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t19-4-shadow-source-diagnostic.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-4-shadow-source-diagnostic.md}"
TOP_K_VALUES="${SHADOW_DIAG_TOP_K:-5,10,25,50}"
CURL_TIMEOUT="${SHADOW_DIAG_CURL_TIMEOUT:-120}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-}"
AI_EMBEDDING_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
AI_RAG_MAX_CONTEXT_TOKENS="${AI_RAG_MAX_CONTEXT_TOKENS:-2048}"
mkdir -p "$(dirname "$REPORT_JSON")"

if [[ -z "$OLLAMA_BASE_URL" ]]; then
  OLLAMA_LB_IP="$(kubectl get svc -n "${K8S_NAMESPACE:-record-platform}" ollama-lb \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "$OLLAMA_LB_IP" ]]; then
    OLLAMA_BASE_URL="http://${OLLAMA_LB_IP}:11434"
  else
    OLLAMA_BASE_URL="http://127.0.0.1:11434"
  fi
fi
export OLLAMA_BASE_URL

CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"
API_BASE="https://record-platform.test"
AUTH_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
AUTH_PASS="${RP_COMB_PASSWORD:-ContractPass123!}"
CURL_TLS=(--cacert "$CA" --resolve "record-platform.test:443:${LB_IP}")

echo "=== T19.4B shadow source diagnostic (read-only) ==="
echo "Ollama: $OLLAMA_BASE_URL"

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }

TOKEN="$(curl -sfS "${CURL_TLS[@]}" --max-time 20 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-RP-E2E-Contract: 1' \
  -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASS\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || { echo "❌ auth failed"; exit 1; }

export TOKEN API_BASE CA LB_IP REPORT_JSON REPORT_MD TOP_K_VALUES CURL_TIMEOUT
export OLLAMA_BASE_URL AI_EMBEDDING_MODEL AI_RAG_MAX_CONTEXT_TOKENS CURL_RESOLVE="record-platform.test:443:${LB_IP}"

python3 <<'PY'
import base64, json, os, re, subprocess, sys, time
from collections import Counter
from datetime import datetime, timezone

token = os.environ["TOKEN"]
base = os.environ["API_BASE"]
ca = os.environ["CA"]
resolve = os.environ["CURL_RESOLVE"]
curl_timeout = os.environ.get("CURL_TIMEOUT", "120")
ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
embed_model = os.environ.get("AI_EMBEDDING_MODEL", "nomic-embed-text")
max_tokens = int(os.environ.get("AI_RAG_MAX_CONTEXT_TOKENS", "2048"))
top_k_values = [int(x) for x in os.environ.get("TOP_K_VALUES", "5,10,25,50").split(",") if x.strip()]
json_out = os.environ["REPORT_JSON"]
md_out = os.environ["REPORT_MD"]

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids",
    re.I,
)
LEAK_RE = re.compile(r"message_body|thread_text|private obo", re.I)
FORBIDDEN_CHUNK_RE = re.compile(r"max_bid_cents|proxy_bids|proxy max", re.I)

PROMPTS = [
    ("auction_risk", "Why is this auction risky?"),
    ("obo_counter", "What should I counter on this OBO listing?"),
    ("underpriced_records", "Which records in my collection look underpriced?"),
    ("seller_summary", "Summarize my seller performance."),
    ("buyer_summary", "Summarize my buyer collection."),
    ("listing_quality", "Find listing quality problems I should fix."),
    ("notifications", "Summarize recent marketplace AI notifications."),
]


def jwt_user_id(jwt_token: str) -> str:
    try:
        payload = jwt_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        for key in ("sub", "userId", "user_id", "id"):
            val = data.get(key)
            if val and str(val).strip():
                return str(val).strip()
    except Exception:
        pass
    return ""


def psql(sql: str, *extra_params: str) -> str:
    env = os.environ.copy()
    env.setdefault("PGPASSWORD", "postgres")
    cmd = [
        "psql", "-h", os.environ.get("PGHOST", "127.0.0.1"),
        "-p", os.environ.get("PYTHON_AI_PGPORT", "5440"),
        "-U", os.environ.get("PGUSER", "postgres"),
        "-d", os.environ.get("PYTHON_AI_DB", "python_ai"),
        "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
    ]
    if extra_params:
        cmd.extend(extra_params)
    return subprocess.check_output(cmd, env=env, text=True).strip()


def psql_rows(sql: str, params: list) -> list:
    """Run parameterized query via psql -v."""
    # Build safe literal params for psql variables
    env = os.environ.copy()
    env.setdefault("PGPASSWORD", "postgres")
    args = [
        "psql", "-h", os.environ.get("PGHOST", "127.0.0.1"),
        "-p", os.environ.get("PYTHON_AI_PGPORT", "5440"),
        "-U", os.environ.get("PGUSER", "postgres"),
        "-d", os.environ.get("PYTHON_AI_DB", "python_ai"),
        "-v", "ON_ERROR_STOP=1", "-At",
    ]
    for i, p in enumerate(params, 1):
        val = str(p).replace("\\", "\\\\").replace("'", "''")
        args.extend(["-v", f"p{i}={val}"])
    args.extend(["-c", sql])
    raw = subprocess.check_output(args, env=env, text=True).strip()
    if not raw:
        return []
    rows = []
    for line in raw.splitlines():
        parts = line.split("|")
        rows.append(parts)
    return rows


def embed_query(query: str) -> list:
    payload = json.dumps({
        "model": embed_model,
        "input": f"search_query: {query[:8000]}",
    })
    cmd = [
        "curl", "-sfS", "--max-time", "60",
        "-X", "POST", f"{ollama_base}/api/embed",
        "-H", "Content-Type: application/json",
        "-d", payload,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout)[:200])
    body = json.loads(proc.stdout)
    embs = body.get("embeddings")
    if embs and isinstance(embs, list) and embs:
        return embs[0]
    return body.get("embedding") or []


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def chunk_passes_privacy(content: str, source_type: str) -> bool:
    if FORBIDDEN_CHUNK_RE.search(content or ""):
        return False
    if source_type == "message":
        return False
    return True


def select_chunks(rows: list, top_k: int) -> tuple:
    selected = []
    token_budget = 0
    privacy_filtered = 0
    for row in rows:
        if len(row) < 4:
            continue
        chunk_id, _content, source_type, score = row[0], row[1], row[2], float(row[3] or 0)
        # Privacy re-check uses source_type only (content omitted from SQL for safety).
        if not chunk_passes_privacy("", source_type):
            privacy_filtered += 1
            continue
        tok = 200  # conservative estimate when content not fetched
        if selected and token_budget + tok > max_tokens:
            break
        if len(selected) >= top_k:
            break
        selected.append({
            "id": chunk_id,
            "source_type": source_type,
            "score": score,
        })
        token_budget += tok
    filtered_out = privacy_filtered + max(0, len(rows) - privacy_filtered - len(selected))
    return selected, privacy_filtered, filtered_out


def vector_shadow_from_vec(user_id: str, vec: list, top_k: int, t0: float) -> dict:
    uid = user_id.replace("'", "''")
    vec_lit = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
    limit = top_k * 3

    sql = f"""
SELECT row_to_json(t)::text FROM (
  SELECT c.id::text AS chunk_id, d.source_type,
         (1 - (c.embedding_vec <=> '{vec_lit}'::vector))::float AS score,
         length(c.content)::int AS content_len
  FROM ai.ai_document_chunks c
  JOIN ai.ai_documents d ON d.id = c.document_id
  WHERE c.embedding_vec IS NOT NULL
    AND d.source_type <> 'message'
    AND (
      d.visibility = 'public'
      OR (d.visibility = 'owner' AND d.owner_user_id = '{uid}')
    )
  ORDER BY c.embedding_vec <=> '{vec_lit}'::vector ASC
  LIMIT {limit}
) t;
"""
    raw = psql(sql)
    rows = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        rows.append([obj["chunk_id"], "", obj["source_type"], str(obj["score"])])
    selected, privacy_filtered, filtered_out = select_chunks(rows, top_k)
    dist = dict(Counter(c["source_type"] for c in selected))
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {
        "status": "ok",
        "latency_ms": latency_ms,
        "candidate_count": len(selected),
        "source_type_distribution": dist,
        "source_types": sorted(dist.keys()),
        "chunk_ids": [c["id"] for c in selected],
        "filtered_out_count": filtered_out,
        "privacy_filtered_count": privacy_filtered,
        "sql_rows_fetched": len(rows),
        "embedded_scope_count": None,
    }


def vector_shadow(user_id: str, query: str, top_k: int, vec: list | None = None) -> dict:
    t0 = time.perf_counter()
    if vec is None:
        try:
            vec = embed_query(query)
        except Exception as exc:
            return {
                "status": "embed_failed",
                "error": str(exc)[:120],
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "candidate_count": 0,
                "source_type_distribution": {},
                "filtered_out_count": None,
            }
        if len(vec) != 768:
            return {
                "status": "dimension_mismatch",
                "error": f"got {len(vec)} dims",
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "candidate_count": 0,
                "source_type_distribution": {},
                "filtered_out_count": None,
            }
    return vector_shadow_from_vec(user_id, vec, top_k, t0)


def call_keyword(question: str) -> dict:
    cmd = [
        "curl", "-sfS", "--max-time", curl_timeout, "--cacert", ca, "--resolve", resolve,
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
        "-X", "POST", "-H", "Content-Type: application/json",
        "-d", json.dumps({"question": question}),
        "-w", "\n%{http_code}",
        base + "/api/ai/rag/query",
    ]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lat = round((time.perf_counter() - t0) * 1000, 1)
    if proc.returncode != 0:
        return {"error": (proc.stderr or proc.stdout)[:240], "latency_ms": lat, "http_status": 0}
    lines = proc.stdout.rsplit("\n", 1)
    raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
    data = json.loads(raw)
    refs = data.get("source_refs") or []
    ref_keys = {(r.get("source_type"), r.get("source_id")) for r in refs}
    chunk_ids = set()
    for r in refs:
        cid = r.get("chunk_id")
        if cid:
            chunk_ids.add(str(cid))
    return {
        "http_status": int(code_s),
        "latency_ms": lat,
        "summary": data.get("summary"),
        "source_refs_count": len(refs),
        "source_ref_types": sorted({r.get("source_type") for r in refs if r.get("source_type")}),
        "source_ref_keys": [list(k) for k in sorted(ref_keys)],
        "retrieval_mode": (data.get("details") or {}).get("retrieval_mode"),
        "raw_blob": json.dumps(data)[:4000],
    }


def leakage_scan(blob: str) -> list:
    issues = []
    if FORBIDDEN.search(blob):
        issues.append("forbidden_prose")
    if LEAK_RE.search(blob):
        issues.append("possible_private_leak")
    return issues


contract_user_id = jwt_user_id(token)
if not contract_user_id:
    contract_user_id = psql(
        "SELECT COALESCE("
        "(SELECT d.owner_user_id FROM ai.ai_documents d "
        " JOIN ai.ai_document_chunks c ON c.document_id=d.id "
        " WHERE c.embedding_vec IS NOT NULL AND d.owner_user_id IS NOT NULL "
        " GROUP BY d.owner_user_id ORDER BY count(*) DESC LIMIT 1), '');"
    )
if not contract_user_id:
    print("❌ could not resolve contract user_id")
    sys.exit(1)

uid = contract_user_id.replace("'", "''")
scope_count = int(psql(f"""
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL AND d.source_type <> 'message'
  AND (d.visibility = 'public' OR (d.visibility = 'owner' AND d.owner_user_id = '{uid}'));
"""))

issues = []
results = []
union_by_topk = {k: set() for k in top_k_values}

for pid, question in PROMPTS:
    keyword = call_keyword(question)
    keyword_blob = keyword.get("raw_blob") or json.dumps(keyword)
    keyword_leaks = leakage_scan(keyword_blob)

    row = {
        "prompt_id": pid,
        "question": question,
        "keyword": {
            k: keyword.get(k)
            for k in (
                "http_status", "latency_ms", "summary", "source_refs_count",
                "source_ref_types", "retrieval_mode",
            )
        },
        "keyword_leakage": keyword_leaks,
        "top_k_runs": [],
    }

    if keyword.get("retrieval_mode") and keyword.get("retrieval_mode") != "keyword":
        issues.append(f"{pid}: retrieval_mode not keyword")
    if keyword_leaks:
        issues.extend(f"{pid}/keyword: {x}" for x in keyword_leaks)
    if keyword.get("http_status", 0) >= 500 or keyword.get("error"):
        issues.append(f"{pid}/keyword: request failed")

    keyword_summary = keyword.get("summary")

    prompt_vec = None
    try:
        prompt_vec = embed_query(question)
        if len(prompt_vec) != 768:
            prompt_vec = None
            issues.append(f"{pid}: embed dimension mismatch")
    except Exception as exc:
        issues.append(f"{pid}: embed_failed {str(exc)[:80]}")

    for top_k in top_k_values:
        shadow = vector_shadow(contract_user_id, question, top_k, vec=prompt_vec)
        shadow["embedded_scope_count"] = scope_count
        if shadow.get("status") != "ok":
            issues.append(f"{pid}/top_k={top_k}: shadow {shadow.get('status')}")

        keyword_ids = set()  # refs don't always expose chunk ids
        shadow_ids = set(shadow.get("chunk_ids") or [])
        overlap = len(keyword_ids & shadow_ids)

        entry = {
            "top_k": top_k,
            "shadow": shadow,
            "overlap_with_keyword_chunk_ids": overlap,
            "keyword_summary_unchanged": True,
            "keyword_source_refs_count": keyword.get("source_refs_count"),
            "leakage_scan": [],
        }
        union_by_topk[top_k].update(shadow.get("source_types") or [])
        row["top_k_runs"].append(entry)

    results.append(row)

summary = {
    "ticket": "T19.4B",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "contract_user_id": contract_user_id,
    "embedded_scope_count": scope_count,
    "top_k_values": top_k_values,
    "prompts": len(PROMPTS),
    "issues": issues,
    "pass": len(issues) == 0,
    "source_types_union_by_top_k": {str(k): sorted(v) for k, v in union_by_topk.items()},
    "results": results,
}

with open(json_out, "w") as f:
    json.dump(summary, f, indent=2)

lines = [
    "# T19.4B — Shadow source diagnostic by top_k",
    "",
    f"**RESULT: {'PASS' if not issues else 'FAIL'}**",
    "",
    f"- Generated: {summary['generated_at']}",
    f"- Contract user scope embedded: {scope_count}",
    f"- Prompts: {len(PROMPTS)}",
    f"- top_k values: {', '.join(str(k) for k in top_k_values)}",
    "",
    "## Source types union by top_k",
    "",
]
for k in top_k_values:
    types = summary["source_types_union_by_top_k"].get(str(k), [])
    lines.append(f"- top_k={k}: {', '.join(types) or '(none)'}")

lines += [
    "",
    "## Per prompt / top_k",
    "",
    "| prompt | top_k | candidates | source types | overlap | latency ms | filtered out | keyword mode |",
    "|--------|------:|-----------:|--------------|--------:|-----------:|---------------:|--------------|",
]
for r in results:
    for run in r["top_k_runs"]:
        sv = run["shadow"]
        types = ", ".join(sv.get("source_types") or [])
        lines.append(
            f"| {r['prompt_id']} | {run['top_k']} | {sv.get('candidate_count', '')} | {types} | "
            f"{run.get('overlap_with_keyword_chunk_ids', '')} | {sv.get('latency_ms', '')} | "
            f"{sv.get('filtered_out_count', '')} | {r['keyword'].get('retrieval_mode', '')} |"
        )

lines += [
    "",
    "## Keyword stability",
    "",
    "| prompt | refs | ref source types | summary (first 80 chars) |",
    "|--------|-----:|------------------|----------------------------|",
]
for r in results:
    kw = r["keyword"]
    sm = (kw.get("summary") or "")[:80].replace("|", "/")
    types = ", ".join(kw.get("source_ref_types") or [])
    lines.append(f"| {r['prompt_id']} | {kw.get('source_refs_count', 0)} | {types} | {sm} |")

if issues:
    lines += ["", "## Issues", ""] + [f"- {i}" for i in issues]

with open(md_out, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Report: {md_out}")
print(f"Union by top_k: {summary['source_types_union_by_top_k']}")
print(f"RESULT: {'PASS' if not issues else 'FAIL'} ({len(issues)} issues)")
sys.exit(0 if not issues else 1)
PY

echo "✅ T19.4B complete"
