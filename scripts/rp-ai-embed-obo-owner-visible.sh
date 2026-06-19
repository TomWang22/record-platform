#!/usr/bin/env bash
# T19.7C — Embed only owner-visible obo_offer_summary chunks for contract users (no broad backfill).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

NS="${K8S_NAMESPACE:-record-platform}"
LIMIT="${OBO_EMBED_LIMIT:-100}"
BATCH_SIZE="${OBO_EMBED_BATCH_SIZE:-10}"
EMBED_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
EXPECTED_DIM="${EMBEDDING_EXPECTED_DIM:-768}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t19-7-obo-owner-visible-embedding.md}"

E2E_EMAIL="${RP_COMB_EMAIL:-e2e-contract@record-platform.local}"
BUYER_EMAIL="${RP_BUYER_EMAIL:-buyer-contract@record-platform.local}"
SELLER_EMAIL="${RP_SELLER_EMAIL:-seller-contract@record-platform.local}"
# Default: e2e-contract only (T19.7 repair). Set OBO_EMBED_ALL_CONTRACT_USERS=1 for all three.
OBO_EMBED_ALL="${OBO_EMBED_ALL_CONTRACT_USERS:-0}"

mkdir -p "$(dirname "$REPORT_MD")"

echo "=== T19.7C targeted OBO owner-visible embedding ==="

rp_python_ai_psql_connect_check || { echo "❌ python_ai DB unreachable"; exit 1; }
kubectl -n "$NS" get deploy python-ai-service >/dev/null 2>&1 || { echo "❌ python-ai-service not found"; exit 1; }

resolve_uid() {
  local email="$1"
  psql -h 127.0.0.1 -p 5437 -U postgres -d auth -At -c \
    "SELECT id::text FROM auth.users WHERE email='${email//\'/''}' LIMIT 1;" 2>/dev/null || true
}

E2E_UID="$(resolve_uid "$E2E_EMAIL")"
BUYER_UID="$(resolve_uid "$BUYER_EMAIL")"
SELLER_UID="$(resolve_uid "$SELLER_EMAIL")"
if [[ "$OBO_EMBED_ALL" == "1" ]]; then
  OWNER_IDS="$(printf '%s,%s,%s' "$E2E_UID" "$BUYER_UID" "$SELLER_UID" | tr ',' '\n' | grep -v '^$' | paste -sd, -)"
else
  OWNER_IDS="$E2E_UID"
fi
[[ -n "$OWNER_IDS" ]] || { echo "❌ no contract user IDs resolved"; exit 1; }

PRE_TOTAL="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
PRE_OBO_OWNER="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL AND d.source_type='obo_offer_summary'
  AND d.owner_user_id::text = ANY(string_to_array('$OWNER_IDS', ','));")"

rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_status TEXT;" >/dev/null
rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;" >/dev/null

export LIMIT BATCH_SIZE EMBED_MODEL EXPECTED_DIM OLLAMA_URL NS OWNER_IDS

WORKER="$(mktemp)"
trap 'rm -f "$WORKER"' EXIT
cat >"$WORKER" <<'PY'
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request

LIMIT = int(os.environ["LIMIT"])
BATCH_SIZE = int(os.environ["BATCH_SIZE"])
EMBED_MODEL = os.environ["EMBED_MODEL"]
EXPECTED_DIM = int(os.environ["EXPECTED_DIM"])
OLLAMA_URL = os.environ["OLLAMA_URL"].rstrip("/")
OWNER_IDS = [x.strip() for x in os.environ["OWNER_IDS"].split(",") if x.strip()]

import asyncpg

DB_URL = os.environ.get(
    "POSTGRES_URL_PYTHON_AI",
    "postgresql://postgres:postgres@host.docker.internal:5440/python_ai",
)

FORBIDDEN = ("max_bid_cents", "proxy_bids", "message_body", "thread_text", "private obo")


def embed_text(text: str) -> list:
    payload = json.dumps({"model": EMBED_MODEL, "input": f"search_document: {text[:8000]}"}).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/embed", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.load(resp)
    embs = body.get("embeddings")
    vec = (embs[0] if embs else None) or body.get("embedding") or []
    if len(vec) != EXPECTED_DIM:
        raise ValueError(f"dimension_mismatch: got {len(vec)} expected {EXPECTED_DIM}")
    return vec


async def main() -> dict:
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT c.id::text AS chunk_id, c.content, c.checksum AS chunk_checksum, d.source_type,
                   d.owner_user_id::text AS owner_user_id
            FROM ai.ai_document_chunks c
            JOIN ai.ai_documents d ON d.id = c.document_id
            WHERE c.embedding_vec IS NULL
              AND d.source_type = 'obo_offer_summary'
              AND d.owner_user_id::text = ANY($1::text[])
              AND d.source_type <> 'message'
            ORDER BY d.owner_user_id, c.created_at, c.chunk_index
            LIMIT $2
            """,
            OWNER_IDS,
            LIMIT,
        )
        skipped_leak = 0
        updated = 0
        errors = []
        by_owner: dict = {}
        for r in rows:
            content = r["content"] or ""
            low = content.lower()
            if any(x in low for x in FORBIDDEN):
                skipped_leak += 1
                continue
            try:
                vec = embed_text(content)
                vec_lit = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
                result = await conn.execute(
                    """
                    UPDATE ai.ai_document_chunks
                    SET embedding_vec = $1::vector, embedding_model = $2,
                        embedding_status = 'embedded', embedding_updated_at = now()
                    WHERE id = $3::uuid AND embedding_vec IS NULL AND checksum = $4
                    """,
                    vec_lit, EMBED_MODEL, r["chunk_id"], r["chunk_checksum"],
                )
                if result.split()[-1] != "0":
                    updated += 1
                    oid = r["owner_user_id"]
                    by_owner[oid] = by_owner.get(oid, 0) + 1
            except Exception as e:
                errors.append({"chunk_id": r["chunk_id"], "error": str(e)[:200]})
        return {
            "ok": len(errors) == 0,
            "selected_count": len(rows),
            "updated_count": updated,
            "skipped_leak": skipped_leak,
            "by_owner_user_id": by_owner,
            "errors": errors,
        }
    finally:
        await conn.close()


print(json.dumps(asyncio.run(main())))
PY

POD="$(kubectl -n "$NS" get pod -l app=python-ai-service -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" cp "$WORKER" "${POD}:/tmp/obo_embed_worker.py" -c app >/dev/null
SUMMARY="$(kubectl -n "$NS" exec deploy/python-ai-service -c app -- env \
  LIMIT="$LIMIT" BATCH_SIZE="$BATCH_SIZE" EMBED_MODEL="$EMBED_MODEL" EXPECTED_DIM="$EXPECTED_DIM" \
  OLLAMA_URL="$OLLAMA_URL" OWNER_IDS="$OWNER_IDS" \
  python3 /tmp/obo_embed_worker.py 2>&1)" || { echo "$SUMMARY"; exit 1; }

echo "$SUMMARY" | python3 -m json.tool >/dev/null 2>&1 || { echo "$SUMMARY"; exit 1; }

POST_TOTAL="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
POST_OBO_OWNER="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL AND d.source_type='obo_offer_summary'
  AND d.owner_user_id::text = ANY(string_to_array('$OWNER_IDS', ','));")"
E2E_OBO_EMBED="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL AND d.source_type='obo_offer_summary'
  AND d.owner_user_id='$E2E_UID';")"
ADDED=$((POST_TOTAL - PRE_TOTAL))

WRONG_DIM="$(rp_python_ai_psql "
SELECT count(*) FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL AND vector_dims(embedding_vec) <> 768;")"
[[ "$WRONG_DIM" == "0" ]] || { echo "❌ dimension mismatch"; exit 1; }

UPDATED="$(echo "$SUMMARY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("updated_count",0))')"

export REPORT_MD PRE_TOTAL POST_TOTAL PRE_OBO_OWNER POST_OBO_OWNER E2E_OBO_EMBED ADDED UPDATED SUMMARY OWNER_IDS EMBED_MODEL EXPECTED_DIM LIMIT
python3 <<'PY'
import json, os
from datetime import datetime, timezone

summary = json.loads(os.environ["SUMMARY"])
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
md = os.environ["REPORT_MD"]
lines = [
    "# T19.7C — Targeted OBO owner-visible embedding",
    "",
    f"**Generated:** {now}",
    f"**RESULT: {'PASS' if summary.get('ok') else 'FAIL'}**",
    "",
    f"- model: `{os.environ['EMBED_MODEL']}`",
    f"- expected_dim: {os.environ['EXPECTED_DIM']}",
    f"- limit: {os.environ['LIMIT']}",
    f"- owner_user_ids: {os.environ['OWNER_IDS']}",
    "",
    "## Counts",
    "",
    f"- embedded total before: {os.environ['PRE_TOTAL']}",
    f"- embedded total after: {os.environ['POST_TOTAL']}",
    f"- embedded added (total delta): {os.environ['ADDED']}",
    f"- obo owner-visible embedded before: {os.environ['PRE_OBO_OWNER']}",
    f"- obo owner-visible embedded after: {os.environ['POST_OBO_OWNER']}",
    f"- e2e-contract obo embedded: {os.environ['E2E_OBO_EMBED']}",
    f"- chunks updated this run: {os.environ['UPDATED']}",
    f"- skipped (leak guard): {summary.get('skipped_leak', 0)}",
    "",
    "## Safety",
    "",
    "- retrieval_mode: **keyword**",
    "- vector_retrieval_enabled: **no**",
    "- broad Tranche 2: **no**",
    "- source_type filter: **obo_offer_summary only**",
    "",
]
open(md, "w").write("\n".join(lines) + "\n")
print(f"Report: {md}")
if not summary.get("ok"):
    raise SystemExit(1)
PY

echo "✅ T19.7C complete (added=$ADDED updated=$UPDATED e2e_obo_embedded=$E2E_OBO_EMBED)"
