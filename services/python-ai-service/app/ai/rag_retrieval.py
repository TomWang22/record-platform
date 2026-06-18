"""T15.3B — Owner-scoped keyword retrieval over RAG corpus."""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.ai.config import (
    AI_EMBEDDING_MODEL,
    AI_RAG_MAX_CHUNKS,
    AI_RAG_MAX_CONTEXT_TOKENS,
    AI_RAG_SHADOW_MIN_EMBEDDED,
    AI_RAG_VECTOR_DIM,
    OLLAMA_BASE_URL,
)
from app.ai.envelope import source_ref
from app.ai.shadow_profiles import (
    profile_diagnostic_meta,
    preferred_source_types,
    resolve_shadow_profile,
    source_type_weights,
)

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


def _build_scope_filters(
    user_id: Optional[str],
    *,
    source_types: Optional[Sequence[str]] = None,
    source_id: Optional[str] = None,
    metadata_listing_id: Optional[str] = None,
    require_embedding_vec: bool = False,
) -> Tuple[List[str], List[Any], int]:
    vis_sql, params = _visibility_clause(user_id)
    params = list(params)
    idx = len(params) + 1
    filters = [vis_sql, "d.source_type <> 'message'"]
    if require_embedding_vec:
        filters.append("c.embedding_vec IS NOT NULL")
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
    return filters, params, idx


def _chunk_passes_privacy(row: Any, *, words: List[str], pin_source: bool, query: str) -> bool:
    content = row["content"] or ""
    if FORBIDDEN_CHUNK_RE.search(content):
        return False
    if row["source_type"] == "message":
        meta = _coerce_metadata(row["metadata"])
        if meta.get("opt_in") is not True:
            return False
    if words and row.get("score", 1) <= 0 and query and not pin_source:
        return False
    return True


def _rows_to_chunks(
    rows: Sequence[Any],
    *,
    words: List[str],
    pin_source: bool,
    query: str,
    max_chunks: int,
    max_tokens: int,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    token_budget = 0
    for row in rows:
        if not _chunk_passes_privacy(row, words=words, pin_source=pin_source, query=query):
            continue
        content = row["content"] or ""
        tok = _estimate_tokens(content)
        if selected and token_budget + tok > max_tokens:
            break
        if len(selected) >= max_chunks:
            break
        selected.append({
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
            "score": row.get("score", 0),
        })
        token_budget += tok
    return selected


async def _embed_query_vector(query: str) -> List[float]:
    import httpx

    payload = {
        "model": AI_EMBEDDING_MODEL,
        "input": f"search_query: {(query or '')[:8000]}",
    }
    timeout = max(5.0, 30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(f"{OLLAMA_BASE_URL}/api/embed", json=payload)
        r.raise_for_status()
        body = r.json()
    embs = body.get("embeddings")
    if embs and isinstance(embs, list) and embs:
        vec = embs[0]
    else:
        vec = body.get("embedding") or []
    if len(vec) != AI_RAG_VECTOR_DIM:
        raise ValueError(f"dimension_mismatch: got {len(vec)} expected {AI_RAG_VECTOR_DIM}")
    return vec


async def count_embedded_chunks_for_scope(
    conn,
    *,
    user_id: Optional[str],
    source_types: Optional[Sequence[str]] = None,
    source_id: Optional[str] = None,
    metadata_listing_id: Optional[str] = None,
) -> int:
    filters, params, _idx = _build_scope_filters(
        user_id,
        source_types=source_types,
        source_id=source_id,
        metadata_listing_id=metadata_listing_id,
        require_embedding_vec=True,
    )
    sql = f"""
        SELECT COUNT(*)::int
        FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE {' AND '.join(filters)}
    """
    return int(await conn.fetchval(sql, *params) or 0)


def _select_route_weighted_chunks(
    rows: Sequence[Any],
    *,
    preferred: Sequence[str],
    weights: Dict[str, float],
    words: List[str],
    pin_source: bool,
    query: str,
    max_chunks: int,
    max_tokens: int,
    scope_by_type: Dict[str, int],
) -> List[Dict[str, Any]]:
    """Shadow-only: reserve slots for owner-visible preferred types, then fill by weighted score."""
    privacy_rows: List[Any] = []
    for row in rows:
        if _chunk_passes_privacy(row, words=words, pin_source=pin_source, query=query):
            privacy_rows.append(row)

    by_type: Dict[str, List[Any]] = {}
    for row in privacy_rows:
        by_type.setdefault(row["source_type"], []).append(row)
    for st in by_type:
        by_type[st].sort(key=lambda r: (-float(r.get("score") or 0), str(r["id"])))

    selected_rows: List[Any] = []
    seen_ids = set()
    per_type_quota = max(1, min(3, max_chunks // max(len(preferred), 1)))

    for st in preferred:
        if scope_by_type.get(st, 0) <= 0:
            continue
        for row in by_type.get(st, [])[:per_type_quota]:
            if str(row["id"]) in seen_ids:
                continue
            selected_rows.append(row)
            seen_ids.add(str(row["id"]))
            if len(selected_rows) >= max_chunks:
                break
        if len(selected_rows) >= max_chunks:
            break

    weighted_rest = _apply_route_weights(
        [r for r in privacy_rows if str(r["id"]) not in seen_ids],
        weights,
    )
    for row in weighted_rest:
        if str(row["id"]) in seen_ids:
            continue
        selected_rows.append(row)
        seen_ids.add(str(row["id"]))
        if len(selected_rows) >= max_chunks * 3:
            break

    return _rows_to_chunks(
        selected_rows,
        words=words,
        pin_source=pin_source,
        query=query,
        max_chunks=max_chunks,
        max_tokens=max_tokens,
    )


def _apply_route_weights(rows: Sequence[Any], weights: Dict[str, float]) -> List[Any]:
    """Re-rank vector rows by cosine score * route weight (after SQL fetch, before privacy select)."""
    weighted = []
    for row in rows:
        base = float(row.get("score") or 0)
        st = row["source_type"]
        w = weights.get(st, 0.35)
        weighted.append((base * w, row))
    weighted.sort(key=lambda x: (-x[0], str(x[1]["id"])))
    return [row for _, row in weighted]


async def count_embedded_by_source_type_for_scope(
    conn,
    *,
    user_id: Optional[str],
    source_types: Optional[Sequence[str]] = None,
) -> Dict[str, int]:
    filters, params, _idx = _build_scope_filters(
        user_id,
        source_types=source_types,
        require_embedding_vec=True,
    )
    sql = f"""
        SELECT d.source_type, COUNT(*)::int AS cnt
        FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE {' AND '.join(filters)}
        GROUP BY d.source_type
    """
    rows = await conn.fetch(sql, *params)
    return {str(r["source_type"]): int(r["cnt"]) for r in rows}


def _merge_vector_rows(*groups: Sequence[Any]) -> List[Any]:
    by_id: Dict[Any, Any] = {}
    for group in groups:
        for row in group:
            by_id[row["id"]] = row
    return list(by_id.values())


async def _fetch_vector_rows(
    conn,
    *,
    filters: List[str],
    params: List[Any],
    vec_param: int,
    limit: int,
    extra_source_type: Optional[str] = None,
) -> List[Any]:
    local_filters = list(filters)
    local_params = list(params)
    idx = len(local_params) + 1
    if extra_source_type:
        local_filters.append(f"d.source_type = ${idx}")
        local_params.append(extra_source_type)
        idx += 1
    local_params.append(limit)
    limit_param = idx
    sql = f"""
        SELECT c.id, c.document_id, c.chunk_index, c.content, c.checksum, c.source_refs,
               d.source_type, d.source_id, d.owner_user_id, d.visibility,
               d.source_updated_at, d.title, d.metadata,
               (1 - (c.embedding_vec <=> ${vec_param}::vector))::float AS score
        FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE {' AND '.join(local_filters)}
        ORDER BY c.embedding_vec <=> ${vec_param}::vector ASC
        LIMIT ${limit_param}
    """
    return list(await conn.fetch(sql, *local_params))


async def _fetch_diversified_vector_rows(
    conn,
    *,
    filters: List[str],
    params: List[Any],
    vec_param: int,
    preferred: Sequence[str],
    scope_by_type: Dict[str, int],
    global_limit: int,
    per_type_limit: int,
) -> List[Any]:
    global_rows = await _fetch_vector_rows(
        conn,
        filters=filters,
        params=params,
        vec_param=vec_param,
        limit=global_limit,
    )
    pool_groups: List[List[Any]] = [global_rows]
    for st in preferred:
        if scope_by_type.get(st, 0) <= 0:
            continue
        type_rows = await _fetch_vector_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            limit=per_type_limit,
            extra_source_type=st,
        )
        if type_rows:
            pool_groups.append(type_rows)
    return _merge_vector_rows(*pool_groups)


async def retrieve_chunks_vector_shadow(
    conn,
    *,
    query: str,
    user_id: Optional[str],
    source_types: Optional[Sequence[str]] = None,
    source_id: Optional[str] = None,
    metadata_listing_id: Optional[str] = None,
    max_chunks: int = AI_RAG_MAX_CHUNKS,
    max_tokens: int = AI_RAG_MAX_CONTEXT_TOKENS,
    route_shadow_profile: Optional[str] = None,
) -> Dict[str, Any]:
    """Diagnostic-only vector retrieval; same privacy scope as keyword path."""
    pin_source = bool(source_id or metadata_listing_id)
    words: List[str] = []

    embedded_count = await count_embedded_chunks_for_scope(
        conn,
        user_id=user_id,
        source_types=source_types,
        source_id=source_id,
        metadata_listing_id=metadata_listing_id,
    )
    if embedded_count < AI_RAG_SHADOW_MIN_EMBEDDED:
        return {
            "enabled": True,
            "status": "insufficient_embeddings",
            "embedded_chunks": embedded_count,
            "candidate_count": 0,
            "chunks": [],
            "chunk_ids": [],
            "latency_ms": 0,
        }

    t0 = time.perf_counter()
    try:
        query_vec = await _embed_query_vector(query)
    except Exception as exc:
        return {
            "enabled": True,
            "status": "embed_failed",
            "embedded_chunks": embedded_count,
            "candidate_count": 0,
            "chunks": [],
            "chunk_ids": [],
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "error": str(exc)[:120],
        }

    filters, params, idx = _build_scope_filters(
        user_id,
        source_types=source_types,
        source_id=source_id,
        metadata_listing_id=metadata_listing_id,
        require_embedding_vec=True,
    )
    vec_lit = "[" + ",".join(f"{x:.8f}" for x in query_vec) + "]"
    params.append(vec_lit)
    vec_param = idx

    resolved_profile = resolve_shadow_profile(route_shadow_profile) if route_shadow_profile else None
    route_mode = route_shadow_profile is not None
    preferred_zero_visible: List[str] = []
    scope_by_type: Dict[str, int] = {}

    if route_mode:
        preferred = preferred_source_types(resolved_profile)
        weights = source_type_weights(resolved_profile)
        scope_by_type = await count_embedded_by_source_type_for_scope(conn, user_id=user_id)
        preferred_zero_visible = [st for st in preferred if scope_by_type.get(st, 0) == 0]
        global_rows = await _fetch_vector_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            limit=max_chunks * 3,
        )
        unweighted_selected = _rows_to_chunks(
            global_rows,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
        )
        pool_rows = list(global_rows)
        for st in preferred:
            if scope_by_type.get(st, 0) <= 0:
                continue
            type_rows = await _fetch_vector_rows(
                conn,
                filters=filters,
                params=params,
                vec_param=vec_param,
                limit=max(6, max_chunks),
                extra_source_type=st,
            )
            pool_rows = _merge_vector_rows(pool_rows, type_rows)
        weighted_selected = _select_route_weighted_chunks(
            pool_rows,
            preferred=preferred,
            weights=weights,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
            scope_by_type=scope_by_type,
        )
    else:
        global_rows = await _fetch_vector_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            limit=max_chunks * 3,
        )
        unweighted_selected = _rows_to_chunks(
            global_rows,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
        )
        weighted_selected = unweighted_selected

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    result: Dict[str, Any] = {
        "enabled": True,
        "status": "ok",
        "embedded_chunks": embedded_count,
        "candidate_count": len(unweighted_selected),
        "chunks": unweighted_selected,
        "chunk_ids": [c["id"] for c in unweighted_selected],
        "latency_ms": latency_ms,
    }
    if route_mode:
        meta = profile_diagnostic_meta(resolved_profile)
        result.update({
            "profile": meta["profile"],
            "preferred_source_types": meta["preferred_source_types"],
            "source_type_weights": meta["source_type_weights"],
            "unweighted_candidate_count": len(unweighted_selected),
            "unweighted_chunks": unweighted_selected,
            "unweighted_chunk_ids": [c["id"] for c in unweighted_selected],
            "weighted_candidate_count": len(weighted_selected),
            "weighted_chunks": weighted_selected,
            "weighted_chunk_ids": [c["id"] for c in weighted_selected],
            "preferred_zero_owner_visible": preferred_zero_visible,
            "embedded_by_source_type": scope_by_type,
            "chunks": weighted_selected,
            "chunk_ids": [c["id"] for c in weighted_selected],
            "candidate_count": len(weighted_selected),
        })
    return result


def build_shadow_vector_diagnostic(
    keyword_chunks: Sequence[Dict[str, Any]],
    shadow_result: Dict[str, Any],
    *,
    unweighted_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    keyword_ids = {str(c.get("id")) for c in keyword_chunks if c.get("id")}
    shadow_ids = set(shadow_result.get("chunk_ids") or [])
    overlap = len(keyword_ids & shadow_ids)
    source_types: Dict[str, int] = {}
    for ch in shadow_result.get("chunks") or []:
        st = ch.get("source_type") or "unknown"
        source_types[st] = source_types.get(st, 0) + 1
    top_source_types = sorted(source_types.items(), key=lambda x: (-x[1], x[0]))[:5]
    diag: Dict[str, Any] = {
        "enabled": True,
        "candidate_count": shadow_result.get("candidate_count", 0),
        "overlap_with_keyword": overlap,
        "top_source_types": [{"source_type": k, "count": v} for k, v in top_source_types],
        "source_type_distribution": dict(source_types),
        "latency_ms": shadow_result.get("latency_ms", 0),
        "embedded_chunks": shadow_result.get("embedded_chunks", 0),
    }
    if unweighted_result is not None:
        unweighted_types: Dict[str, int] = {}
        for ch in unweighted_result.get("chunks") or []:
            st = ch.get("source_type") or "unknown"
            unweighted_types[st] = unweighted_types.get(st, 0) + 1
        unweighted_ids = set(unweighted_result.get("chunk_ids") or [])
        diag["unweighted"] = {
            "candidate_count": unweighted_result.get("candidate_count", 0),
            "overlap_with_keyword": len(keyword_ids & unweighted_ids),
            "source_type_distribution": unweighted_types,
            "top_source_types": [
                {"source_type": k, "count": v}
                for k, v in sorted(unweighted_types.items(), key=lambda x: (-x[1], x[0]))[:5]
            ],
            "latency_ms": unweighted_result.get("latency_ms"),
        }
    if shadow_result.get("profile"):
        diag["profile"] = shadow_result["profile"]
        diag["preferred_source_types"] = shadow_result.get("preferred_source_types") or []
        diag["source_type_weights"] = shadow_result.get("source_type_weights") or {}
        diag["weighted_candidate_count"] = shadow_result.get("weighted_candidate_count")
        diag["unweighted_candidate_count"] = shadow_result.get("unweighted_candidate_count")
        if shadow_result.get("preferred_zero_owner_visible"):
            diag["preferred_zero_owner_visible"] = shadow_result["preferred_zero_owner_visible"]
    status = shadow_result.get("status")
    if status and status != "ok":
        diag["status"] = status
        if shadow_result.get("error"):
            diag["error"] = shadow_result["error"]
    return diag


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

    selected = _rows_to_chunks(
        rows,
        words=words,
        pin_source=pin_source,
        query=query,
        max_chunks=max_chunks,
        max_tokens=max_tokens,
    )

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
    token_budget = sum(_estimate_tokens(c.get("content") or "") for c in selected)
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
