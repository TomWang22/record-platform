#!/usr/bin/env bash
# T18.7 / T19.3 — Controlled per-source-type embedding backfill (bounded new rows; keyword default).
# One actual write pass per tranche lock — see EMBEDDING_BACKFILL_TRANCHE_ID / EMBEDDING_BACKFILL_FORCE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

NS="${K8S_NAMESPACE:-record-platform}"
TOTAL_LIMIT="${EMBEDDING_BACKFILL_TOTAL_LIMIT:-1000}"
PER_TYPE_LIMITS="${EMBEDDING_BACKFILL_PER_TYPE_LIMITS:-record=250,listing=250,obo_offer_summary=150,auction_bid_summary=150,notification=100,listing_revision=100}"
BATCH_SIZE="${EMBEDDING_BACKFILL_BATCH_SIZE:-10}"
DRY_RUN="${EMBEDDING_BACKFILL_DRY_RUN:-0}"
EMBED_MODEL="${AI_EMBEDDING_MODEL:-nomic-embed-text}"
EXPECTED_DIM="${EMBEDDING_EXPECTED_DIM:-768}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://ollama.${NS}.svc.cluster.local:11434}"
REPORT_JSON="${REPORT_JSON:-$REPO_ROOT/bench_logs/ai-platform/t18-7-controlled-backfill.json}"
REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t18-7-controlled-backfill-plan.md}"
TRANCHE_ID="${EMBEDDING_BACKFILL_TRANCHE_ID:-}"
TRANCHE_LOCK="${EMBEDDING_BACKFILL_TRANCHE_LOCK:-}"
EMBEDDING_BACKFILL_FORCE="${EMBEDDING_BACKFILL_FORCE:-0}"
MAX_NEW="${EMBEDDING_BACKFILL_MAX_NEW:-$TOTAL_LIMIT}"
TICKET="${EMBEDDING_BACKFILL_TICKET:-T18.7}"

if [[ -z "$TRANCHE_LOCK" ]] && [[ -n "$TRANCHE_ID" ]]; then
  TRANCHE_LOCK="$REPO_ROOT/bench_logs/ai-platform/${TRANCHE_ID}-actual-run.json"
fi

mkdir -p "$(dirname "$REPORT_JSON")"

echo "=== Controlled embedding backfill ($TICKET) ==="
echo "total_limit=$TOTAL_LIMIT max_new=$MAX_NEW per_type=$PER_TYPE_LIMITS batch_size=$BATCH_SIZE dry_run=$DRY_RUN"
[[ -n "$TRANCHE_ID" ]] && echo "tranche_id=$TRANCHE_ID tranche_lock=$TRANCHE_LOCK force=$EMBEDDING_BACKFILL_FORCE"

if ! rp_python_ai_psql_connect_check; then
  echo "❌ python_ai DB unreachable on port ${PYTHON_AI_PGPORT:-5440}" >&2
  exit 1
fi

if ! kubectl -n "$NS" get deploy python-ai-service >/dev/null 2>&1; then
  echo "❌ python-ai-service deployment not found in $NS" >&2
  exit 1
fi

rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_status TEXT;" >/dev/null
rp_python_ai_psql "ALTER TABLE ai.ai_document_chunks ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;" >/dev/null

PRE_EMBEDDED_COUNT="$(PGPASSWORD="${PGPASSWORD:-postgres}" PGCONNECT_TIMEOUT=5 \
  psql -h "${PYTHON_AI_PGHOST:-127.0.0.1}" -p "${PYTHON_AI_PGPORT:-5440}" -U "${PGUSER:-postgres}" -d python_ai \
  -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
echo "pre_embedded_count=$PRE_EMBEDDED_COUNT"

if [[ "$DRY_RUN" == "0" ]]; then
  if [[ -n "$TRANCHE_LOCK" ]] && [[ -f "$TRANCHE_LOCK" ]] && [[ "$EMBEDDING_BACKFILL_FORCE" != "1" ]]; then
    echo "❌ tranche actual-run lock exists: $TRANCHE_LOCK" >&2
    echo "   One write pass per tranche. Set EMBEDDING_BACKFILL_FORCE=1 only after explicit ops approval." >&2
    exit 1
  fi
fi

export TOTAL_LIMIT PER_TYPE_LIMITS BATCH_SIZE DRY_RUN EMBED_MODEL EXPECTED_DIM OLLAMA_URL NS

WORKER="$(mktemp)"
SUMMARY_FILE="$(mktemp)"
trap 'rm -f "$WORKER" "$SUMMARY_FILE"' EXIT
cat >"$WORKER" <<'PY'
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request

TOTAL_LIMIT = int(os.environ["TOTAL_LIMIT"])
BATCH_SIZE = int(os.environ["BATCH_SIZE"])
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"
EMBED_MODEL = os.environ["EMBED_MODEL"]
EXPECTED_DIM = int(os.environ["EXPECTED_DIM"])
OLLAMA_URL = os.environ["OLLAMA_URL"].rstrip("/")

FORBIDDEN_RE = r"max_bid_cents|proxy_bids|proxy max|message_body|thread_text"

def parse_per_type_limits(raw: str) -> dict:
    out: dict = {}
    for part in raw.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = int(v.strip())
    return out

PER_TYPE_LIMITS = parse_per_type_limits(os.environ["PER_TYPE_LIMITS"])

try:
    import asyncpg
except ImportError:
    print(json.dumps({"ok": False, "error": "asyncpg not installed in python-ai-service"}))
    sys.exit(1)

DB_URL = os.environ.get(
    "POSTGRES_URL_PYTHON_AI",
    "postgresql://postgres:postgres@host.docker.internal:5440/python_ai",
)

SELECT_SQL = """
    SELECT c.id::text AS chunk_id,
           c.content,
           d.source_type,
           d.owner_user_id,
           d.visibility,
           c.source_refs::text AS source_refs_json,
           c.checksum AS chunk_checksum
    FROM ai.ai_document_chunks c
    JOIN ai.ai_documents d ON d.id = c.document_id
    WHERE c.embedding_vec IS NULL
      AND (c.embedding_status IS NULL
           OR c.embedding_status IN ('pending', 'degraded', 'missing'))
      AND d.source_type = $1
      AND d.source_type <> 'message'
      AND COALESCE(c.content, '') !~* $2
    ORDER BY c.created_at, c.chunk_index
    LIMIT $3
"""


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

    async def reconnect() -> None:
        nonlocal conn
        if conn is not None and not conn.is_closed():
            await conn.close()
        conn = await asyncpg.connect(DB_URL)

    async def update_chunk(chunk_id: str, vec_lit: str, checksum: str) -> bool:
        nonlocal conn
        for attempt in range(3):
            try:
                if conn.is_closed():
                    await reconnect()
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
                    checksum,
                )
                return result.split()[-1] != "0"
            except (asyncpg.InterfaceError, asyncpg.ConnectionDoesNotExistError, OSError) as e:
                if attempt < 2:
                    await reconnect()
                    continue
                raise RuntimeError(f"db_update_failed: {e}") from e
        return False

    try:
        rows = []
        plan_by_type: dict = {}
        for st, type_limit in PER_TYPE_LIMITS.items():
            if len(rows) >= TOTAL_LIMIT:
                break
            take = min(type_limit, TOTAL_LIMIT - len(rows))
            batch = await conn.fetch(SELECT_SQL, st, FORBIDDEN_RE, take)
            plan_by_type[st] = {
                "requested": type_limit,
                "selected": len(batch),
            }
            rows.extend(batch)

        selected = []
        for r in rows:
            selected.append({
                "chunk_id": r["chunk_id"],
                "source_type": r["source_type"],
                "owner_user_id": r["owner_user_id"],
                "visibility": r["visibility"],
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
                "total_limit": TOTAL_LIMIT,
                "selected_count": len(selected),
                "updated_count": 0,
                "plan_by_type": plan_by_type,
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
                    if await update_chunk(chunk_id, vec_lit, r["chunk_checksum"]):
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

        distinct_types = len(by_type)
        ok = len(errors) == 0 and (
            updated == 0 or distinct_types >= 2 or TOTAL_LIMIT <= 200
        )
        return {
            "ok": ok,
            "dry_run": False,
            "total_limit": TOTAL_LIMIT,
            "selected_count": len(rows),
            "updated_count": updated,
            "distinct_source_types_updated": distinct_types,
            "plan_by_type": plan_by_type,
            "by_source_type": by_type,
            "errors": errors,
        }
    finally:
        if conn is not None and not conn.is_closed():
            await conn.close()


result = asyncio.run(main())
print(json.dumps(result))
if not result.get("ok"):
    sys.exit(1)
PY

if ! cat "$WORKER" | kubectl -n "$NS" exec -i deploy/python-ai-service -c app -- env \
  TOTAL_LIMIT="$TOTAL_LIMIT" \
  PER_TYPE_LIMITS="$PER_TYPE_LIMITS" \
  BATCH_SIZE="$BATCH_SIZE" \
  DRY_RUN="$DRY_RUN" \
  EMBED_MODEL="$EMBED_MODEL" \
  EXPECTED_DIM="$EXPECTED_DIM" \
  OLLAMA_URL="$OLLAMA_URL" \
  python3 - >"$SUMMARY_FILE" 2>&1; then
  cat "$SUMMARY_FILE" >&2
  exit 1
fi

python3 -m json.tool "$SUMMARY_FILE" >/dev/null 2>&1 || { cat "$SUMMARY_FILE"; exit 1; }

export REPORT_JSON REPORT_MD SUMMARY_FILE TOTAL_LIMIT PER_TYPE_LIMITS BATCH_SIZE DRY_RUN EMBED_MODEL EXPECTED_DIM \
  PRE_EMBEDDED_COUNT MAX_NEW TRANCHE_ID TRANCHE_LOCK TICKET
python3 <<'PY'
import json, os
from datetime import datetime, timezone

with open(os.environ["SUMMARY_FILE"], encoding="utf-8") as f:
    summary = json.loads(f.read())
report_json = os.environ["REPORT_JSON"]
report_md = os.environ["REPORT_MD"]
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
pre_embedded = int(os.environ.get("PRE_EMBEDDED_COUNT", "0"))
max_new = int(os.environ.get("MAX_NEW", "0"))
ticket = os.environ.get("TICKET", "T18.7")

payload = {
    "generated": now,
    "ticket": ticket,
    "dry_run": summary.get("dry_run", False),
    "pre_embedded_count": pre_embedded,
    "total_limit": int(os.environ["TOTAL_LIMIT"]),
    "max_new_embeddings": max_new,
    "per_type_limits": os.environ["PER_TYPE_LIMITS"],
    "batch_size": int(os.environ["BATCH_SIZE"]),
    "embedding_model": os.environ["EMBED_MODEL"],
    "expected_dim": int(os.environ["EXPECTED_DIM"]),
    "selected_count": summary.get("selected_count", 0),
    "updated_count": summary.get("updated_count", 0),
    "distinct_source_types_updated": summary.get("distinct_source_types_updated"),
    "plan_by_type": summary.get("plan_by_type", {}),
    "by_source_type": summary.get("by_source_type", {}),
    "errors": summary.get("errors", []),
    "ok": summary.get("ok", False),
    "retrieval_mode": "keyword",
    "vector_retrieval_enabled": False,
    "full_corpus_backfill": False,
}
open(report_json, "w").write(json.dumps(payload, indent=2) + "\n")

lines = [
    f"# {ticket} controlled embedding backfill plan",
    "",
    f"**Generated:** {now}",
    f"**RESULT: {'PASS' if payload['ok'] else 'FAIL'}**",
    "",
    "## Config",
    "",
    f"- dry_run: **{payload['dry_run']}**",
    f"- pre_embedded_count: {pre_embedded}",
    f"- max_new_embeddings: {max_new}",
    f"- total_limit: {payload['total_limit']}",
    f"- per_type_limits: `{payload['per_type_limits']}`",
    f"- batch_size: {payload['batch_size']}",
    f"- embedding_model: `{payload['embedding_model']}`",
    "",
    "## Selection plan",
    "",
    "| source_type | requested | selected |",
    "|-------------|----------:|---------:|",
]
for st, plan in sorted((payload.get("plan_by_type") or {}).items()):
    lines.append(f"| {st} | {plan.get('requested', '')} | {plan.get('selected', '')} |")
lines += [
    "",
    "## Results",
    "",
    f"- selected: {payload['selected_count']}",
    f"- updated: {payload['updated_count']}",
    "",
    "### Updated by source_type",
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
    "- skips: message docs, proxy max, private OBO message bodies",
    "- preserves: source text, owner scope, visibility, source_refs",
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

echo ""
echo "=== SQL proof ==="
rp_python_ai_psql "
SELECT d.source_type, c.embedding_status, c.embedding_model, count(*)
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE c.embedding_vec IS NOT NULL
GROUP BY 1,2,3
ORDER BY 1,2,3;"

WRONG_DIM="$(rp_python_ai_psql "
SELECT count(*) AS wrong_dim
FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL
  AND vector_dims(embedding_vec) <> 768;")"
echo "wrong_dim=$WRONG_DIM"
[[ "$WRONG_DIM" == "0" ]] || { echo "❌ dimension mismatch"; exit 1; }

MSG_EMB="$(rp_python_ai_psql "
SELECT count(*) AS message_embeddings
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type='message'
  AND c.embedding_vec IS NOT NULL;")"
echo "message_embeddings=$MSG_EMB"
[[ "$MSG_EMB" == "0" ]] || { echo "❌ message embeddings present"; exit 1; }

PROXY_LEAKS="$(rp_python_ai_psql "
SELECT count(*) AS proxy_leaks
FROM ai.ai_document_chunks
WHERE embedding_vec IS NOT NULL
  AND content ~* 'max_bid_cents|proxy_bids|proxy max';")"
echo "proxy_leaks=$PROXY_LEAKS"
[[ "$PROXY_LEAKS" == "0" ]] || { echo "❌ proxy max in embedded chunks"; exit 1; }

UPDATED="$(python3 -c 'import json; print(json.load(open("'"$SUMMARY_FILE"'")).get("updated_count",0))')"
WORKER_OK="$(python3 -c 'import json; print("1" if json.load(open("'"$SUMMARY_FILE"'")).get("ok") else "0")')"
ERROR_COUNT="$(python3 -c 'import json; print(len(json.load(open("'"$SUMMARY_FILE"'")).get("errors",[])))')"

POST_EMBEDDED_COUNT="$(PGPASSWORD="${PGPASSWORD:-postgres}" PGCONNECT_TIMEOUT=5 \
  psql -h "${PYTHON_AI_PGHOST:-127.0.0.1}" -p "${PYTHON_AI_PGPORT:-5440}" -U "${PGUSER:-postgres}" -d python_ai \
  -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
echo "post_embedded_count=$POST_EMBEDDED_COUNT"
NEW_EMBEDDED=$((POST_EMBEDDED_COUNT - PRE_EMBEDDED_COUNT))
echo "new_embeddings_added=$NEW_EMBEDDED"

if [[ "$DRY_RUN" == "0" ]]; then
  if [[ "$NEW_EMBEDDED" -gt "$MAX_NEW" ]]; then
    echo "❌ added $NEW_EMBEDDED embeddings; max_new=$MAX_NEW (pre=$PRE_EMBEDDED_COUNT post=$POST_EMBEDDED_COUNT)" >&2
    exit 1
  fi
  if [[ -n "$TRANCHE_LOCK" ]]; then
  python3 - "$TRANCHE_LOCK" "$TRANCHE_ID" "$PRE_EMBEDDED_COUNT" "$POST_EMBEDDED_COUNT" "$NEW_EMBEDDED" \
    "$UPDATED" "$WORKER_OK" "$ERROR_COUNT" "$TICKET" <<'PY'
import json, sys
from datetime import datetime, timezone

lock_path, tranche_id, pre, post, new_added, updated, worker_ok, error_count, ticket = sys.argv[1:10]
payload = {
    "tranche_id": tranche_id or None,
    "ticket": ticket,
    "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "pre_embedded_count": int(pre),
    "post_embedded_count": int(post),
    "new_embeddings_added": int(new_added),
    "worker_updated_count": int(updated),
    "worker_ok": worker_ok == "1",
    "error_count": int(error_count),
    "status": "complete" if worker_ok == "1" and int(error_count) == 0 else "partial_failure",
    "rerun_requires": "EMBEDDING_BACKFILL_FORCE=1",
}
with open(lock_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
print(f"tranche_lock_written={lock_path}")
PY
  fi
  if [[ "$WORKER_OK" != "1" ]] || [[ "$ERROR_COUNT" -gt 0 ]]; then
    echo "❌ partial backfill failure (updated=$UPDATED errors=$ERROR_COUNT)" >&2
    echo "   STOP — do not rerun actual backfill. Report partial count; rerun gates only if needed." >&2
    echo "   Further writes require EMBEDDING_BACKFILL_FORCE=1 after ops review." >&2
    exit 1
  fi
fi

if [[ "$DRY_RUN" == "0" ]] && [[ "$UPDATED" -gt 0 ]]; then
  DISTINCT="$(python3 -c 'import json; print(json.load(open("'"$SUMMARY_FILE"'")).get("distinct_source_types_updated",0))')"
  TOTAL_LIMIT_INT="$(python3 -c 'import json; print(json.load(open("'"$SUMMARY_FILE"'")).get("total_limit",0))')"
  if [[ "${DISTINCT:-0}" -lt 2 ]] && [[ "${TOTAL_LIMIT_INT:-0}" -gt 200 ]]; then
    echo "❌ backfill not balanced across source types (distinct=$DISTINCT)" >&2
    exit 1
  fi
fi

echo "✅ controlled backfill complete (updated=$UPDATED new=$NEW_EMBEDDED dry_run=$DRY_RUN)"
