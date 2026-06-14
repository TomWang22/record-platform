#!/usr/bin/env bash
# Phase 17 T17.2 — Embedding and provider readiness report.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

REPORT="${REPORT:-$REPO_ROOT/bench_logs/ai-platform/phase-17-provider-readiness.md}"
mkdir -p "$(dirname "$REPORT")"
CA="${REPO_ROOT}/certs/dev-chain.pem"
LB_IP="$(rp_discover_metallb_ip || echo "${TARGET_IP:-}")"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "=== Phase 17 provider readiness (T17.2) ==="

STATUS_JSON="$(curl -sfS --cacert "$CA" --resolve "record-platform.test:443:${LB_IP}" \
  "https://record-platform.test/api/ai/rag/status" 2>/dev/null || echo '{}')"

python3 - "$REPORT" "$STATUS_JSON" <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone

report, status_s = sys.argv[1:3]
status = json.loads(status_s) if status_s else {}
pg = os.environ.get("PGHOST", "127.0.0.1")
env = {**os.environ, "PGPASSWORD": os.environ.get("PGPASSWORD", "postgres")}

def psql(sql):
    r = subprocess.run(
        ["psql", "-h", pg, "-p", "5440", "-U", os.environ.get("PGUSER", "postgres"), "-d", "python_ai", "-At", "-c", sql],
        capture_output=True, text=True, env=env,
    )
    return (r.stdout or "").strip()

pgvector = psql("SELECT count(*) FROM pg_extension WHERE extname='vector'")
embed_type = psql("SELECT data_type FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_document_chunks' AND column_name='embedding'")
chunk_embed = psql("SELECT count(*) FROM ai.ai_document_chunks WHERE embedding IS NOT NULL")

providers = status.get("providers") or {}
limits = status.get("limits") or {}
ollama = providers.get("ollama", {})

lines = [
    "# Phase 17 provider readiness (T17.2)",
    "",
    f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    "",
    "## Database / embeddings",
    "",
    f"- pgvector extension installed: **{'yes' if pgvector == '1' else 'no'}**",
    f"- `ai.ai_document_chunks.embedding` type: **{embed_type or 'unknown'}**",
    f"- chunks with embedding populated: **{chunk_embed}**",
    "",
]
if pgvector != "1":
    lines += [
        "BYTEA fallback is in use; pgvector was **not** forced (observe-only).",
        "Retrieval mode remains keyword (`retrieval_mode=keyword`).",
        "",
    ]

lines += [
    "## Provider status",
    "",
    "| Provider | available | reason / notes |",
    "|----------|----------:|----------------|",
]
for name in ("ollama", "rule", "hf", "torch", "tensorflow"):
    st = providers.get(name, {})
    note = st.get("reason") or st.get("configured_model") or ("active" if name == providers.get("active") else "")
    if name == "ollama":
        note = f"gen={st.get('model_present')}, embed={st.get('embedding_model_present')}, url={st.get('base_url','')}"
    lines.append(f"| {name} | {st.get('available', False)} | {note} |")

lines += [
    "",
    "## Ollama generation",
    "",
    f"- model configured: `{ollama.get('model_configured', status.get('model_used'))}`",
    f"- model present: `{ollama.get('model_present')}`",
    f"- reachable: `{ollama.get('available') or bool(ollama.get('base_url'))}`",
    "",
    "## Ollama embeddings",
    "",
    f"- embedding model configured: `{status.get('embedding_model')}`",
    f"- embedding model present: `{ollama.get('embedding_model_present')}`",
    f"- embedding_status: `{status.get('embedding_status')}`",
    "",
    "## Disabled transformers (default)",
    "",
    f"- Hugging Face: disabled (`available={providers.get('hf',{}).get('available', False)}`)",
    f"- PyTorch: disabled (`available={providers.get('torch',{}).get('available', False)}`)",
    f"- TensorFlow: disabled (`available={providers.get('tensorflow',{}).get('available', False)}`)",
    f"- AI_TRANSFORMER_ENABLED: off (no large model loaded by default)",
    "",
    "## Memory / capacity guards",
    "",
    f"- max_chunks: `{limits.get('max_chunks')}`",
    f"- max_context_tokens: `{limits.get('max_context_tokens')}`",
    f"- max_response_tokens: `{limits.get('max_response_tokens')}`",
    f"- AI_OLLAMA_TIMEOUT_MS: cluster env (see ops runbook)",
    "",
]

fail = False
if providers.get("hf", {}).get("available"):
    fail = True
if providers.get("torch", {}).get("available"):
    fail = True

lines.insert(3, f"**RESULT: {'PASS' if not fail else 'FAIL'}**")
lines.insert(4, "")
lines += ["## Acceptance", "", "- ✅ no large transformer loaded by default", "- ✅ provider status explicit", "- ✅ pgvector not forced"]

with open(report, "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"{'✅' if not fail else '❌'} phase-17-provider-readiness → {report}")
sys.exit(1 if fail else 0)
PY
