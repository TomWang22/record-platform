#!/usr/bin/env bash
# T18.5 — Small batch embedding backfill (<=100 chunks; no full corpus; no vector retrieval flip).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

NS="${K8S_NAMESPACE:-record-platform}"
LIMIT="${EMBEDDING_BACKFILL_LIMIT:-100}"
BATCH_SIZE="${EMBEDDING_BACKFILL_BATCH_SIZE:-10}"
SOURCE_TYPES="${EMBEDDING_BACKFILL_SOURCE_TYPES:-record,listing,auction_bid_summary,obo_offer_summary}"
DRY_RUN="${EMBEDDING_BACKFILL_DRY_RUN:-0}"
EMBED_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
EXPECTED_DIM="${EMBEDDING_EXPECTED_DIM:-768}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t18-5-small-backfill.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t18-5-small-backfill.md}"

mkdir -p "$(dirname "$REPORT_JSON")"

echo "=== T18.5 small batch embedding backfill ==="
echo "limit=$LIMIT batch_size=$BATCH_SIZE dry_run=$DRY_RUN source_types=$SOURCE_TYPES"

if ! rp_python_ai_psql_connect_check; then
  echo "❌ python_ai DB unreachable on port ${PYTHON_AI_PGPORT:-5440}" >&2
  exit 1
fi

if ! kubectl -n "$NS" get deploy python-ai-service >/dev/null 2>&1; then
  echo "❌ python-ai-service deployment not found in $NS" >&2
  exit 1
fi

# Idempotent chunk status columns (additive).
rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_status TEXT;" >/dev/null
rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;" >/dev/null

export LIMIT BATCH_SIZE SOURCE_TYPES DRY_RUN EMBED_MODEL EXPECTED_DIM OLLAMA_URL NS

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
SOURCE_TYPES = [s.strip() for s in os.environ["SOURCE_TYPES"].split(",") if s.strip()]
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"
EMBED_MODEL = os.environ["EMBED_MODEL"]
EXPECTED_DIM = int(os.environ["EXPECTED_DIM"])
OLLAMA_URL = os.environ["OLLAMA_URL"].rstrip("/")

try:
    import asyncpg
except ImportError:
    print(json.dumps({"ok": False, "error": "asyncpg not installed in python-ai-service"}))
    sys.exit(1)

DB_URL = os.environ.get(
    "POSTGRES_URL_PYTHON_AI",
    "postgresql://postgres:postgres@host.docker.internal:5440/python_ai",
)


def embed_text(text: str) -> list:
    payload = json.dumps({
        "model": EMBED_MODEL,
        "input": f"search_document: {text[:8000]}",
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ollama_http_{e.code}: {e.read().decode()[:200]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"ollama_unreachable: {e}") from e

    embs = body.get("embeddings")
    if embs and isinstance(embs, list) and embs:
        vec = embs[0]
    else:
        vec = body.get("embedding") or []
    if len(vec) != EXPECTED_DIM:
        raise ValueError(f"dimension_mismatch: got {len(vec)} expected {EXPECTED_DIM}")
    return vec


async def main() -> dict:
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT c.id::text AS chunk_id,
                   c.content,
                   d.source_type,
                   d.owner_user_id,
                   c.source_refs::text AS source_refs_json,
                   c.checksum AS chunk_checksum
            FROM ai.ai_document_chunks c
            JOIN ai.ai_documents d ON d.id = c.document_id
            WHERE c.embedding_vec IS NULL
              AND (c.embedding_status IS NULL
                   OR c.embedding_status IN ('pending', 'degraded', 'missing'))
              AND d.source_type = ANY($1::text[])
              AND d.source_type <> 'message'
            ORDER BY d.source_type, c.created_at, c.chunk_index
            LIMIT $2
            """,
            SOURCE_TYPES,
            LIMIT,
        )

        selected = []
        for r in rows:
            selected.append({
                "chunk_id": r["chunk_id"],
                "source_type": r["source_type"],
                "owner_user_id": r["owner_user_id"],
                "content_len": len(r["content"] or ""),
                "source_refs": r["source_refs_json"],
                "chunk_checksum": r["chunk_checksum"],
            })

        if DRY_RUN:
            by_type: dict = {}
            for s in selected:
                by_type[s["source_type"]] = by_type.get(s["source_type"], 0) + 1
            return {
                "ok": True,
                "dry_run": True,
                "selected_count": len(selected),
                "updated_count": 0,
                "by_source_type": by_type,
                "selected": selected,
                "errors": [],
            }

        updated = 0
        errors = []
        by_type: dict = {}

        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i : i + BATCH_SIZE]
            for r in batch:
                chunk_id = r["chunk_id"]
                try:
                    vec = embed_text(r["content"] or "")
                    vec_lit = "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
                    result = await conn.execute(
                        """
                        UPDATE ai.ai_document_chunks
                        SET embedding_vec = $1::vector,
                            embedding_model = $2,
                            embedding_status = 'embedded',
                            embedding_updated_at = now()
                        WHERE id = $3::uuid
                          AND embedding_vec IS NULL
                          AND checksum = $4
                        """,
                        vec_lit,
                        EMBED_MODEL,
                        chunk_id,
                        r["chunk_checksum"],
                    )
                    if result.split()[-1] != "0":
                        updated += 1
                        st = r["source_type"]
                        by_type[st] = by_type.get(st, 0) + 1
                except ValueError as e:
                    if "dimension_mismatch" in str(e):
                        print(json.dumps({
                            "ok": False,
                            "error": str(e),
                            "chunk_id": chunk_id,
                            "updated_count": updated,
                        }))
                        sys.exit(2)
                    errors.append({"chunk_id": chunk_id, "error": str(e)})
                except Exception as e:
                    errors.append({"chunk_id": chunk_id, "error": str(e)[:200]})

        return {
            "ok": len(errors) == 0,
            "dry_run": False,
            "selected_count": len(rows),
            "updated_count": updated,
            "by_source_type": by_type,
            "errors": errors,
        }
    finally:
        await conn.close()


result = asyncio.run(main())
print(json.dumps(result))
if not result.get("ok"):
    sys.exit(1)
PY

SUMMARY="$(cat "$WORKER" | kubectl -n "$NS" exec -i deploy/python-ai-service -c app -- env \
  LIMIT="$LIMIT" \
  BATCH_SIZE="$BATCH_SIZE" \
  SOURCE_TYPES="$SOURCE_TYPES" \
  DRY_RUN="$DRY_RUN" \
  EMBED_MODEL="$EMBED_MODEL" \
  EXPECTED_DIM="$EXPECTED_DIM" \
  OLLAMA_URL="$OLLAMA_URL" \
  python3 - 2>&1)" || {
  echo "$SUMMARY" >&2
  exit 1
}

echo "$SUMMARY" | python3 -m json.tool >/dev/null 2>&1 || { echo "$SUMMARY"; exit 1; }

export REPORT_JSON REPORT_MD SUMMARY LIMIT BATCH_SIZE DRY_RUN SOURCE_TYPES EMBED_MODEL EXPECTED_DIM
python3 <<'PY'
import json, os
from datetime import datetime, timezone

summary = json.loads(os.environ["SUMMARY"])
report_json = os.environ["REPORT_JSON"]
report_md = os.environ["REPORT_MD"]
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

payload = {
    "generated": now,
    "ticket": "T18.5",
    "dry_run": summary.get("dry_run", False),
    "limit": int(os.environ["LIMIT"]),
    "batch_size": int(os.environ["BATCH_SIZE"]),
    "source_types": os.environ["SOURCE_TYPES"].split(","),
    "embedding_model": os.environ["EMBED_MODEL"],
    "expected_dim": int(os.environ["EXPECTED_DIM"]),
    "selected_count": summary.get("selected_count", 0),
    "updated_count": summary.get("updated_count", 0),
    "by_source_type": summary.get("by_source_type", {}),
    "errors": summary.get("errors", []),
    "ok": summary.get("ok", False),
    "retrieval_mode": "keyword",
    "vector_retrieval_enabled": False,
    "full_corpus_backfill": False,
}
open(report_json, "w").write(json.dumps(payload, indent=2) + "\n")

lines = [
    "# T18.5 small batch embedding backfill",
    "",
    f"**Generated:** {now}",
    f"**RESULT: {'PASS' if payload['ok'] else 'FAIL'}**",
    "",
    "## Run",
    "",
    f"- dry_run: **{payload['dry_run']}**",
    f"- limit: {payload['limit']}",
    f"- batch_size: {payload['batch_size']}",
    f"- source_types: {', '.join(payload['source_types'])}",
    f"- embedding_model: `{payload['embedding_model']}`",
    f"- expected_dim: {payload['expected_dim']}",
    "",
    "## Results",
    "",
    f"- selected: {payload['selected_count']}",
    f"- updated: {payload['updated_count']}",
    "",
    "### By source_type",
    "",
]
for k, v in sorted(payload["by_source_type"].items()):
    lines.append(f"- {k}: {v}")
if payload["errors"]:
    lines += ["", "### Errors", ""]
    for e in payload["errors"][:20]:
        lines.append(f"- {e}")
lines += [
    "",
    "## Safety",
    "",
    "- retrieval_mode: **keyword** (unchanged)",
    "- vector_retrieval_enabled: **no**",
    "- full_corpus_backfill: **no**",
    "",
]
open(report_md, "w").write("\n".join(lines) + "\n")
print(f"✅ reports → {report_json} , {report_md}")
if not payload["ok"]:
    raise SystemExit(1)
PY

# SQL proof (host psql).
echo ""
echo "=== SQL proof ==="
rp_python_ai_psql "
SELECT embedding_status, embedding_model, count(*)
FROM ai.ai_document_chunks
GROUP BY 1,2
ORDER BY 1,2;"

rp_python_ai_psql "
SELECT d.source_type, count(*) AS embedded_chunks
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY 1
ORDER BY 1;"

WRONG_DIM="$(rp_python_ai_psql "
SELECT count(*) AS wrong_dim
FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL
  AND vector_dims(embedding_vec) <> 768;")"
echo "wrong_dim=$WRONG_DIM"
if [[ "$WRONG_DIM" != "0" ]]; then
  echo "❌ dimension mismatch in DB" >&2
  exit 1
fi

echo "✅ T18.5 small batch backfill complete (updated=$(echo "$SUMMARY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("updated_count",0))'))"
