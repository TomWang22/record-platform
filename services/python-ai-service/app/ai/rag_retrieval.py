"""T15.3B — Owner-scoped keyword retrieval over RAG corpus."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence

from app.ai.config import AI_RAG_MAX_CHUNKS, AI_RAG_MAX_CONTEXT_TOKENS
from app.ai.envelope import source_ref

FORBIDDEN_CHUNK_RE = re.compile(r"max_bid_cents|proxy_bids|proxy max", re.I)


def _coerce_metadata(meta: Any) -> Dict[str, Any]:
    if meta is None:
        return {}
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        try:
            import json
            parsed = json.loads(meta)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _visibility_clause(user_id: Optional[str]) -> tuple[str, list]:
    """Public + caller owner docs only; private cross-user never returned."""
    if not user_id:
        return "d.visibility = 'public'", []
    return (
        "(d.visibility = 'public' OR (d.visibility = 'owner' AND d.owner_user_id = $1))",
        [user_id],
    )


async def retrieve_chunks(
    conn,
    *,
    query: str,
    user_id: Optional[str],
    source_types: Optional[Sequence[str]] = None,
    source_id: Optional[str] = None,
    metadata_listing_id: Optional[str] = None,
    max_chunks: int = AI_RAG_MAX_CHUNKS,
    max_tokens: int = AI_RAG_MAX_CONTEXT_TOKENS,
) -> Dict[str, Any]:
    vis_sql, params = _visibility_clause(user_id)
    params = list(params)
    idx = len(params) + 1

    filters = [vis_sql, "d.source_type <> 'message'"]
    if source_types:
        filters.append(f"d.source_type = ANY(${idx}::text[])")
        params.append(list(source_types))
        idx += 1
    if source_id:
        filters.append(f"d.source_id = ${idx}")
        params.append(str(source_id))
        idx += 1
    if metadata_listing_id:
        filters.append(f"d.metadata->>'listing_id' = ${idx}")
        params.append(str(metadata_listing_id))
        idx += 1

    pin_source = bool(source_id or metadata_listing_id)
    words = [w for w in re.split(r"\W+", (query or "").lower()) if len(w) >= 3][:12]
    if pin_source:
        words = []
    score_expr = "1"
    if words:
        score_parts = []
        for w in words:
            score_parts.append(f"CASE WHEN lower(c.content) LIKE '%' || ${idx} || '%' THEN 1 ELSE 0 END")
            params.append(w)
            idx += 1
        score_expr = "(" + " + ".join(score_parts) + ")"

    sql = f"""
        SELECT c.id, c.document_id, c.chunk_index, c.content, c.checksum, c.source_refs,
               d.source_type, d.source_id, d.owner_user_id, d.visibility,
               d.source_updated_at, d.title, d.metadata,
               ({score_expr})::int AS score
        FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE {' AND '.join(filters)}
        ORDER BY score DESC, d.source_updated_at DESC, c.chunk_index ASC
        LIMIT ${idx}
    """
    params.append(max_chunks * 3)
    rows = await conn.fetch(sql, *params)

    selected: List[Dict[str, Any]] = []
    token_budget = 0
    for row in rows:
        content = row["content"] or ""
        if FORBIDDEN_CHUNK_RE.search(content):
            continue
        if row["source_type"] == "message":
            meta = _coerce_metadata(row["metadata"])
            if meta.get("opt_in") is not True:
                continue
        tok = _estimate_tokens(content)
        if selected and token_budget + tok > max_tokens:
            break
        if len(selected) >= max_chunks:
            break
        if words and row["score"] <= 0 and query and not pin_source:
            continue
        item = {
            "id": str(row["id"]),
            "document_id": str(row["document_id"]),
            "chunk_index": row["chunk_index"],
            "content": content,
            "checksum": row["checksum"],
            "source_refs": row["source_refs"],
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "owner_user_id": row["owner_user_id"],
            "visibility": row["visibility"],
            "source_updated_at": row["source_updated_at"].isoformat() if row["source_updated_at"] else None,
            "title": row["title"],
            "metadata": row["metadata"],
            "score": row["score"],
        }
        selected.append(item)
        token_budget += tok

    refs = [
        source_ref(
            ch["source_type"],
            ch["source_id"],
            freshness=ch.get("source_updated_at"),
            checksum=ch.get("checksum"),
        )
        for ch in selected
    ]
    # dedupe refs by type+id
    seen = set()
    unique_refs = []
    for r in refs:
        key = (r["source_type"], r["source_id"])
        if key in seen:
            continue
        seen.add(key)
        unique_refs.append(r)

    embedded = sum(1 for _ in selected)  # placeholder; embeddings optional in T15.3
    return {
        "chunks": selected,
        "source_refs": unique_refs,
        "retrieval_mode": "keyword",
        "token_count": token_budget,
        "embedding_available": False,
    }


async def fetch_document_chunks_for_user(
    conn,
    *,
    user_id: Optional[str],
    source_type: str,
    source_id: str,
    max_chunks: int = AI_RAG_MAX_CHUNKS,
) -> Dict[str, Any]:
    return await retrieve_chunks(
        conn,
        query="",
        user_id=user_id,
        source_types=[source_type],
        source_id=source_id,
        max_chunks=max_chunks,
    )
