"""T15.3B — Owner-scoped keyword retrieval over RAG corpus."""
from __future__ import annotations

import hashlib
import re
import time
from collections import Counter, OrderedDict
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.ai.config import (
    AI_EMBEDDING_MODEL,
    AI_RAG_MAX_CHUNKS,
    AI_RAG_MAX_CONTEXT_TOKENS,
    AI_RAG_SHADOW_EMBED_CACHE_MAX,
    AI_RAG_SHADOW_EMBED_HINT_MAX_CHARS,
    AI_RAG_SHADOW_EMBED_TIMEOUT_MS,
    AI_RAG_SHADOW_ENTITY_HINTS,
    AI_RAG_SHADOW_MIN_EMBEDDED,
    AI_RAG_SHADOW_NEIGHBOR_EXPANSION,
    AI_RAG_VECTOR_DIM,
    OLLAMA_BASE_URL,
)
from app.ai.envelope import source_ref
from app.ai.shadow_profiles import (
    SHADOW_ENTITY_LISTING_FETCH_LIMIT,
    SHADOW_ENTITY_LISTING_ID_CAP,
    SHADOW_ENTITY_HINT_SCORE_MULTIPLIER,
    SHADOW_NEIGHBOR_DOCS_CONSIDERED,
    SHADOW_NEIGHBOR_GLOBAL_CAP,
    SHADOW_NEIGHBOR_PER_DOC,
    candidate_pool_is_sufficient,
    expand_query_with_hints,
    infer_shadow_profile_from_query,
    is_obo_focused,
    needs_global_fallback,
    non_primary_source_caps,
    pool_diversity_satisfied,
    preferred_type_quotas,
    profile_diagnostic_meta,
    preferred_source_types,
    resolve_shadow_fetch_strategy,
    resolve_shadow_profile,
    resolved_profile_for_diagnostics,
    source_type_quota_satisfied,
    source_type_weights,
)

FORBIDDEN_CHUNK_RE = re.compile(r"max_bid_cents|proxy_bids|proxy max", re.I)


def _now_ms() -> int:
    return int(time.perf_counter() * 1000)


def _elapsed_ms(start_ms: int) -> int:
    return max(0, _now_ms() - start_ms)


def _safe_chunk_id(chunk: Mapping[str, Any]) -> str:
    value = chunk.get("id") or chunk.get("chunk_id") or ""
    return str(value)


def _safe_source_type(chunk: Mapping[str, Any]) -> str:
    value = chunk.get("source_type") or "unknown"
    return str(value)


def _count_by_source_type(chunks: Iterable[Mapping[str, Any]]) -> Dict[str, int]:
    counter: Counter[str] = Counter()
    for chunk in chunks:
        counter[_safe_source_type(chunk)] += 1
    return dict(sorted(counter.items(), key=lambda item: item[0]))


def _collect_chunk_ids(chunks: Iterable[Mapping[str, Any]]) -> List[str]:
    ids: List[str] = []
    for chunk in chunks:
        chunk_id = _safe_chunk_id(chunk)
        if chunk_id:
            ids.append(chunk_id)
    return ids


@dataclass(slots=True)
class ShadowTimingDiagnostics:
    embed: int = 0
    candidate_fetch: int = 0
    source_filter: int = 0
    privacy_filter: int = 0
    rerank_select: int = 0
    total: int = 0


@dataclass(slots=True)
class ShadowEmbedDiagnostics:
    provider: str = "ollama"
    model: str = ""
    query_length: int = 0
    expanded_query_length: int = 0
    profile_hints_enabled: bool = False
    hint_terms_count: int = 0
    hint_expansion_truncated: bool = False
    timeout_ms: int = 0
    retry_count: int = 0
    cache_hit: bool = False
    latency_ms: int = 0
    timed_out: bool = False
    error: Optional[str] = None
    fallback_reason: Optional[str] = None


@dataclass(slots=True)
class ShadowCountDiagnostics:
    candidate_count_raw: int = 0
    candidate_count_after_source_filters: int = 0
    candidate_count_after_privacy_filters: int = 0
    selected_count: int = 0


@dataclass(slots=True)
class ShadowBySourceTypeDiagnostics:
    raw: Dict[str, int] = field(default_factory=dict)
    post_source_filter: Dict[str, int] = field(default_factory=dict)
    post_privacy_filter: Dict[str, int] = field(default_factory=dict)
    selected: Dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class ShadowPrivacyDiagnostics:
    blocked_message_count: int = 0
    blocked_proxy_count: int = 0
    blocked_owner_scope_count: int = 0
    blocked_other_count: int = 0


def _collect_document_ids(chunks: Iterable[Mapping[str, Any]]) -> List[str]:
    ids: List[str] = []
    for chunk in chunks:
        doc_id = chunk.get("document_id")
        if doc_id:
            ids.append(str(doc_id))
    return ids


# T20.10K — map source_type to canonical entity-id field for parity diagnostics.
_SOURCE_TYPE_ENTITY_ID_FIELD: dict[str, str] = {
    "listing": "listing_id",
    "record": "record_id",
    "obo_offer_summary": "offer_id",
}


# T20.10K / T20.10AC — safe metadata entity fields for shadow overlap hints (no body text).
_SAFE_ENTITY_METADATA_FIELDS: Tuple[str, ...] = (
    "listing_id",
    "record_id",
    "offer_id",
    "obo_offer_id",
    "auction_id",
    "bid_id",
)


def _entity_keys_for_chunk(chunk: Mapping[str, Any]) -> set[str]:
    """Shadow-only overlap keys from source_id and safe metadata fields (no body text)."""
    keys: set[str] = set()
    source_type = chunk.get("source_type")
    source_id = chunk.get("source_id")
    if source_type and source_id:
        keys.add(f"{source_type}:{source_id}")
        alias_field = _SOURCE_TYPE_ENTITY_ID_FIELD.get(str(source_type))
        if alias_field:
            keys.add(f"{alias_field}:{source_id}")
    meta = _coerce_metadata(chunk.get("metadata"))
    for field in _SAFE_ENTITY_METADATA_FIELDS:
        value = meta.get(field)
        if value:
            keys.add(f"{field}:{value}")
    return keys


def _collect_entity_keys(chunks: Iterable[Mapping[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for chunk in chunks:
        keys.update(_entity_keys_for_chunk(chunk))
    return keys


def _entity_keys_for_row(row: Mapping[str, Any]) -> set[str]:
    keys: set[str] = set()
    source_type = row.get("source_type")
    source_id = row.get("source_id")
    if source_type and source_id:
        keys.add(f"{source_type}:{source_id}")
        alias_field = _SOURCE_TYPE_ENTITY_ID_FIELD.get(str(source_type))
        if alias_field:
            keys.add(f"{alias_field}:{source_id}")
    meta = _coerce_metadata(row.get("metadata"))
    for field in _SAFE_ENTITY_METADATA_FIELDS:
        value = meta.get(field)
        if value:
            keys.add(f"{field}:{value}")
    return keys


def extract_keyword_entity_hint_keys(
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]],
) -> set[str]:
    """T20.10AC A1 — entity keys from keyword-selected chunks (metadata only)."""
    return _collect_entity_keys(keyword_chunks or [])


def listing_ids_from_entity_keys(entity_keys: set[str]) -> List[str]:
    """Bounded listing_id values for optional typed entity fetch."""
    listing_ids: List[str] = []
    for key in sorted(entity_keys):
        if key.startswith("listing_id:"):
            listing_ids.append(key.split(":", 1)[1])
    return listing_ids[:SHADOW_ENTITY_LISTING_ID_CAP]


def _entity_overlap_count_in_rows(
    entity_keys: set[str],
    rows: Sequence[Mapping[str, Any]],
) -> int:
    if not entity_keys:
        return 0
    pool_keys = set()
    for row in rows:
        pool_keys.update(_entity_keys_for_row(row))
    return len(entity_keys.intersection(pool_keys))


def _apply_entity_hint_score_boost(
    rows: Sequence[Any],
    entity_keys: set[str],
    *,
    multiplier: float = SHADOW_ENTITY_HINT_SCORE_MULTIPLIER,
) -> Tuple[List[Any], int]:
    """T20.10AC A2 — bounded score boost for rows sharing keyword entity keys."""
    if not entity_keys:
        return list(rows), 0
    boosted_rows: List[Any] = []
    boosted_count = 0
    for row in rows:
        row_copy = dict(row)
        if _entity_keys_for_row(row_copy).intersection(entity_keys):
            base = float(row_copy.get("score") or 0)
            row_copy["score"] = base * multiplier
            boosted_count += 1
        boosted_rows.append(row_copy)
    return boosted_rows, boosted_count


def _keyword_alignment_targets(
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]],
) -> Tuple[set[str], set[str], set[str]]:
    chunk_ids: set[str] = set()
    document_ids: set[str] = set()
    entity_keys: set[str] = set()
    for chunk in keyword_chunks or []:
        chunk_id = chunk.get("id")
        if chunk_id:
            chunk_ids.add(str(chunk_id))
        doc_id = chunk.get("document_id")
        if doc_id:
            document_ids.add(str(doc_id))
        entity_keys.update(_entity_keys_for_chunk(chunk))
    return chunk_ids, document_ids, entity_keys


def _shared_source_type_alignment(
    keyword_chunks: Sequence[Mapping[str, Any]],
    shadow_chunks: Sequence[Mapping[str, Any]],
) -> Dict[str, Dict[str, int]]:
    kw_by_type: Dict[str, List[Mapping[str, Any]]] = {}
    sh_by_type: Dict[str, List[Mapping[str, Any]]] = {}
    for chunk in keyword_chunks:
        st = str(chunk.get("source_type") or "")
        if st:
            kw_by_type.setdefault(st, []).append(chunk)
    for chunk in shadow_chunks:
        st = str(chunk.get("source_type") or "")
        if st:
            sh_by_type.setdefault(st, []).append(chunk)
    shared_types = set(kw_by_type).intersection(sh_by_type)
    alignment: Dict[str, Dict[str, int]] = {}
    for st in sorted(shared_types):
        kw_entities = _collect_entity_keys(kw_by_type[st])
        sh_entities = _collect_entity_keys(sh_by_type[st])
        kw_docs = set(_collect_document_ids(kw_by_type[st]))
        sh_docs = set(_collect_document_ids(sh_by_type[st]))
        alignment[st] = {
            "keyword_count": len(kw_by_type[st]),
            "shadow_count": len(sh_by_type[st]),
            "shared_entity_count": len(kw_entities.intersection(sh_entities)),
            "shared_document_count": len(kw_docs.intersection(sh_docs)),
        }
    return alignment


def _classify_zero_overlap_reason(
    *,
    chunk_overlap: int,
    document_overlap: int,
    entity_overlap: int,
    keyword_source_types: Dict[str, int],
    shadow_source_types: Dict[str, int],
    keyword_count: int,
    shadow_count: int,
) -> Optional[str]:
    if chunk_overlap > 0:
        return None
    if keyword_count == 0 or shadow_count == 0:
        return "one_path_empty"
    if entity_overlap > 0:
        return "shared_entity_different_chunks"
    if document_overlap > 0:
        return "same_document_different_chunks"
    kw_types = set(keyword_source_types)
    sh_types = set(shadow_source_types)
    shared_types = kw_types.intersection(sh_types)
    if not shared_types:
        return "source_type_mismatch"
    if shared_types and not entity_overlap and not document_overlap:
        return "same_source_type_different_chunks"
    return "different_retrieval_paths"


@dataclass(slots=True)
class ShadowOverlapExplanation:
    keyword_source_types: Dict[str, int] = field(default_factory=dict)
    shadow_source_types: Dict[str, int] = field(default_factory=dict)
    chunk_overlap_count: int = 0
    document_overlap_count: int = 0
    shared_source_type_count: int = 0
    entity_overlap_count: int = 0
    keyword_document_count: int = 0
    shadow_document_count: int = 0
    zero_overlap_reason: Optional[str] = None
    shared_source_alignment: Dict[str, Dict[str, int]] = field(default_factory=dict)


@dataclass(slots=True)
class ShadowOverlapDiagnostics:
    count: int = 0
    ratio_vs_keyword: float = 0.0
    ratio_vs_shadow: float = 0.0
    overlap_ids: List[str] = field(default_factory=list)
    keyword_ids: List[str] = field(default_factory=list)
    shadow_ids: List[str] = field(default_factory=list)
    document_overlap_count: int = 0
    document_overlap_ids: List[str] = field(default_factory=list)
    entity_overlap_count: int = 0
    entity_overlap_keys: List[str] = field(default_factory=list)
    explanation: ShadowOverlapExplanation = field(default_factory=ShadowOverlapExplanation)


@dataclass(slots=True)
class ShadowRetrievalDiagnostics:
    enabled: bool
    profile: Optional[str] = None
    query_hints: List[str] = field(default_factory=list)
    timings_ms: ShadowTimingDiagnostics = field(default_factory=ShadowTimingDiagnostics)
    embed: ShadowEmbedDiagnostics = field(default_factory=ShadowEmbedDiagnostics)
    counts: ShadowCountDiagnostics = field(default_factory=ShadowCountDiagnostics)
    by_source_type: ShadowBySourceTypeDiagnostics = field(default_factory=ShadowBySourceTypeDiagnostics)
    privacy: ShadowPrivacyDiagnostics = field(default_factory=ShadowPrivacyDiagnostics)
    overlap: ShadowOverlapDiagnostics = field(default_factory=ShadowOverlapDiagnostics)
    debug: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _privacy_block_reason(
    row: Any,
    *,
    words: List[str],
    pin_source: bool,
    query: str,
) -> Optional[str]:
    content = row["content"] or ""
    if FORBIDDEN_CHUNK_RE.search(content):
        return "proxy"
    if row["source_type"] == "message":
        meta = _coerce_metadata(row["metadata"])
        if meta.get("opt_in") is not True:
            return "message"
    if words and row.get("score", 1) <= 0 and query and not pin_source:
        return "other"
    return None


def _partition_privacy_rows(
    rows: Sequence[Any],
    *,
    words: List[str],
    pin_source: bool,
    query: str,
) -> Tuple[List[Any], ShadowPrivacyDiagnostics]:
    allowed: List[Any] = []
    privacy = ShadowPrivacyDiagnostics()
    for row in rows:
        reason = _privacy_block_reason(row, words=words, pin_source=pin_source, query=query)
        if reason == "proxy":
            privacy.blocked_proxy_count += 1
            continue
        if reason == "message":
            privacy.blocked_message_count += 1
            continue
        if reason == "other":
            privacy.blocked_other_count += 1
            continue
        allowed.append(row)
    return allowed, privacy


def _build_overlap_diagnostics(
    *,
    keyword_chunks: Sequence[Mapping[str, Any]],
    shadow_chunks: Sequence[Mapping[str, Any]],
) -> ShadowOverlapDiagnostics:
    keyword_ids = _collect_chunk_ids(keyword_chunks)
    shadow_ids = _collect_chunk_ids(shadow_chunks)
    keyword_set = set(keyword_ids)
    shadow_set = set(shadow_ids)
    overlap_ids = sorted(keyword_set.intersection(shadow_set))
    overlap_count = len(overlap_ids)
    ratio_vs_keyword = (overlap_count / len(keyword_set)) if keyword_set else 0.0
    ratio_vs_shadow = (overlap_count / len(shadow_set)) if shadow_set else 0.0

    keyword_doc_ids = _collect_document_ids(keyword_chunks)
    shadow_doc_ids = _collect_document_ids(shadow_chunks)
    keyword_doc_set = set(keyword_doc_ids)
    shadow_doc_set = set(shadow_doc_ids)
    document_overlap_ids = sorted(keyword_doc_set.intersection(shadow_doc_set))
    document_overlap_count = len(document_overlap_ids)

    keyword_entities = _collect_entity_keys(keyword_chunks)
    shadow_entities = _collect_entity_keys(shadow_chunks)
    entity_overlap_keys = sorted(keyword_entities.intersection(shadow_entities))
    entity_overlap_count = len(entity_overlap_keys)

    keyword_source_types = _count_by_source_type(keyword_chunks)
    shadow_source_types = _count_by_source_type(shadow_chunks)
    shared_source_type_count = len(set(keyword_source_types).intersection(shadow_source_types))
    shared_source_alignment = _shared_source_type_alignment(keyword_chunks, shadow_chunks)
    zero_overlap_reason = _classify_zero_overlap_reason(
        chunk_overlap=overlap_count,
        document_overlap=document_overlap_count,
        entity_overlap=entity_overlap_count,
        keyword_source_types=keyword_source_types,
        shadow_source_types=shadow_source_types,
        keyword_count=len(keyword_chunks),
        shadow_count=len(shadow_chunks),
    )

    explanation = ShadowOverlapExplanation(
        keyword_source_types=keyword_source_types,
        shadow_source_types=shadow_source_types,
        chunk_overlap_count=overlap_count,
        document_overlap_count=document_overlap_count,
        shared_source_type_count=shared_source_type_count,
        entity_overlap_count=entity_overlap_count,
        keyword_document_count=len(keyword_doc_set),
        shadow_document_count=len(shadow_doc_set),
        zero_overlap_reason=zero_overlap_reason,
        shared_source_alignment=shared_source_alignment,
    )

    return ShadowOverlapDiagnostics(
        count=overlap_count,
        ratio_vs_keyword=round(ratio_vs_keyword, 4),
        ratio_vs_shadow=round(ratio_vs_shadow, 4),
        overlap_ids=overlap_ids,
        keyword_ids=keyword_ids,
        shadow_ids=shadow_ids,
        document_overlap_count=document_overlap_count,
        document_overlap_ids=document_overlap_ids,
        entity_overlap_count=entity_overlap_count,
        entity_overlap_keys=entity_overlap_keys,
        explanation=explanation,
    )


def _finalize_shadow_diagnostics(
    diagnostics: ShadowRetrievalDiagnostics,
    *,
    raw_rows: Sequence[Any],
    source_filtered_rows: Sequence[Any],
    privacy_filtered_rows: Sequence[Any],
    selected_chunks: Sequence[Mapping[str, Any]],
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]] = None,
) -> None:
    diagnostics.counts.candidate_count_raw = len(raw_rows)
    diagnostics.counts.candidate_count_after_source_filters = len(source_filtered_rows)
    diagnostics.counts.candidate_count_after_privacy_filters = len(privacy_filtered_rows)
    diagnostics.counts.selected_count = len(selected_chunks)
    diagnostics.by_source_type.raw = _count_by_source_type(raw_rows)
    diagnostics.by_source_type.post_source_filter = _count_by_source_type(source_filtered_rows)
    diagnostics.by_source_type.post_privacy_filter = _count_by_source_type(privacy_filtered_rows)
    diagnostics.by_source_type.selected = _count_by_source_type(selected_chunks)
    if keyword_chunks is not None:
        diagnostics.overlap = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=selected_chunks,
        )


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


_shadow_embed_cache: OrderedDict[str, List[float]] = OrderedDict()


def _shadow_embed_cache_key(model: str, query: str) -> str:
    digest = hashlib.sha256(f"{model}:{query}".encode("utf-8")).hexdigest()
    return digest[:40]


def _shadow_embed_cache_get(key: str) -> Optional[List[float]]:
    vec = _shadow_embed_cache.get(key)
    if vec is None:
        return None
    _shadow_embed_cache.move_to_end(key)
    return list(vec)


def _shadow_embed_cache_put(key: str, vec: Sequence[float]) -> None:
    _shadow_embed_cache[key] = list(vec)
    _shadow_embed_cache.move_to_end(key)
    while len(_shadow_embed_cache) > max(0, AI_RAG_SHADOW_EMBED_CACHE_MAX):
        _shadow_embed_cache.popitem(last=False)


async def _call_ollama_embed(query: str, *, timeout_ms: int) -> List[float]:
    import httpx

    payload = {
        "model": AI_EMBEDDING_MODEL,
        "input": f"search_query: {(query or '')[:8000]}",
    }
    timeout_sec = max(1.0, timeout_ms / 1000.0)
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
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


async def _embed_query_vector(query: str) -> List[float]:
    vec, _meta = await _shadow_embed_query(
        query,
        original_query_length=len(query or ""),
        profile_hints_enabled=False,
        hint_terms_count=0,
        hint_expansion_truncated=False,
        use_cache=False,
    )
    if vec is None:
        raise RuntimeError(_meta.error or "embed_failed")
    return vec


async def _shadow_embed_query(
    query: str,
    *,
    original_query_length: int,
    profile_hints_enabled: bool,
    hint_terms_count: int,
    hint_expansion_truncated: bool,
    use_cache: bool = True,
) -> Tuple[Optional[List[float]], ShadowEmbedDiagnostics]:
    """Shadow-only embedding with timeout, cache, and diagnostics."""
    meta = ShadowEmbedDiagnostics(
        provider="ollama",
        model=AI_EMBEDDING_MODEL,
        query_length=original_query_length,
        expanded_query_length=len(query or ""),
        profile_hints_enabled=profile_hints_enabled,
        hint_terms_count=hint_terms_count,
        hint_expansion_truncated=hint_expansion_truncated,
        timeout_ms=AI_RAG_SHADOW_EMBED_TIMEOUT_MS,
    )
    cache_key = _shadow_embed_cache_key(AI_EMBEDDING_MODEL, query)
    if use_cache and AI_RAG_SHADOW_EMBED_CACHE_MAX > 0:
        cached = _shadow_embed_cache_get(cache_key)
        if cached is not None:
            meta.cache_hit = True
            meta.latency_ms = 0
            return cached, meta

    embed_start = _now_ms()
    try:
        vec = await _call_ollama_embed(query, timeout_ms=AI_RAG_SHADOW_EMBED_TIMEOUT_MS)
    except Exception as exc:
        meta.latency_ms = _elapsed_ms(embed_start)
        err = str(exc)
        meta.error = err[:120]
        import httpx

        if isinstance(exc, httpx.TimeoutException) or "timed out" in err.lower():
            meta.timed_out = True
            meta.fallback_reason = "embed_timeout"
        else:
            meta.fallback_reason = "embed_error"
        return None, meta

    meta.latency_ms = _elapsed_ms(embed_start)
    if use_cache and AI_RAG_SHADOW_EMBED_CACHE_MAX > 0:
        _shadow_embed_cache_put(cache_key, vec)
    return vec, meta


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
    profile: str,
    preferred: Sequence[str],
    weights: Dict[str, float],
    words: List[str],
    pin_source: bool,
    query: str,
    max_chunks: int,
    max_tokens: int,
    scope_by_type: Dict[str, int],
    custom_hints: Optional[Sequence[str]] = None,
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]] = None,
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
    type_counts: Counter[str] = Counter()
    quotas = preferred_type_quotas(
        profile,
        max_chunks,
        scope_by_type,
        custom_hints=custom_hints,
        query=query,
    )

    for st in preferred:
        cap = quotas.get(st, 0)
        if cap <= 0:
            continue
        for row in by_type.get(st, [])[:cap]:
            if str(row["id"]) in seen_ids:
                continue
            selected_rows.append(row)
            seen_ids.add(str(row["id"]))
            type_counts[st] += 1
            if len(selected_rows) >= max_chunks:
                break
        if len(selected_rows) >= max_chunks:
            break

    slot_caps = non_primary_source_caps(profile, max_chunks, custom_hints=custom_hints)
    remaining_rows = [r for r in privacy_rows if str(r["id"]) not in seen_ids]
    remaining_rows = _apply_keyword_alignment_boost(remaining_rows, keyword_chunks)
    weighted_rest = _apply_route_weights(
        remaining_rows,
        weights,
    )
    for row in weighted_rest:
        if str(row["id"]) in seen_ids:
            continue
        st = str(row["source_type"])
        cap = slot_caps.get(st)
        if cap is not None and type_counts[st] >= cap:
            continue
        selected_rows.append(row)
        seen_ids.add(str(row["id"]))
        type_counts[st] += 1
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


def _keyword_alignment_multiplier(
    row: Mapping[str, Any],
    *,
    keyword_chunk_ids: set[str],
    keyword_document_ids: set[str],
    keyword_entity_keys: set[str],
) -> float:
    row_id = str(row.get("id") or "")
    if row_id and row_id in keyword_chunk_ids:
        return 2.0
    doc_id = row.get("document_id")
    if doc_id and str(doc_id) in keyword_document_ids:
        return 1.35
    if _entity_keys_for_row(row).intersection(keyword_entity_keys):
        return 1.25
    return 1.0


def _apply_keyword_alignment_boost(
    rows: Sequence[Any],
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]],
) -> List[Any]:
    if not keyword_chunks:
        return list(rows)
    chunk_ids, document_ids, entity_keys = _keyword_alignment_targets(keyword_chunks)
    if not chunk_ids and not document_ids and not entity_keys:
        return list(rows)
    boosted: List[Tuple[float, Any]] = []
    for row in rows:
        base = float(row.get("score") or 0)
        multiplier = _keyword_alignment_multiplier(
            row,
            keyword_chunk_ids=chunk_ids,
            keyword_document_ids=document_ids,
            keyword_entity_keys=entity_keys,
        )
        boosted.append((base * multiplier, row))
    boosted.sort(key=lambda x: (-x[0], str(x[1]["id"])))
    return [row for _, row in boosted]


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


def _pool_rows_by_source_type(rows: Sequence[Any]) -> Dict[str, int]:
    counts: Counter[str] = Counter()
    for row in rows:
        counts[str(row["source_type"])] += 1
    return dict(counts)


def _shadow_type_fetch_limit(
    source_type: str,
    *,
    max_chunks: int,
    obo_focused: bool,
) -> int:
    if source_type == "obo_offer_summary" and obo_focused:
        return max(8, max_chunks)
    return max(6, max_chunks)


async def _fetch_listing_entity_hint_rows(
    conn,
    *,
    filters: List[str],
    scope_params: List[Any],
    query_vec: str,
    listing_ids: Sequence[str],
    limit: int,
) -> List[Any]:
    """T20.10AC A3 — one bounded typed fetch filtered by listing_id metadata."""
    if not listing_ids:
        return []
    local_filters = list(filters)
    local_params = list(scope_params)
    idx = len(local_params) + 1
    local_filters.append(f"d.metadata->>'listing_id' = ANY(${idx}::text[])")
    local_params.append(list(listing_ids))
    idx += 1
    local_params.append(query_vec)
    vec_param = idx
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
        LIMIT ${limit_param}::int
    """
    return list(await conn.fetch(sql, *local_params))


async def _fetch_document_neighbor_rows(
    conn,
    *,
    filters: List[str],
    params: List[Any],
    document_id: str,
    anchor_chunk_index: int,
    per_doc_limit: int,
) -> List[Any]:
    """T20.10AC C1 — same-document neighbor chunks ordered by index distance."""
    local_filters = list(filters)
    local_params = list(params)
    idx = len(local_params) + 1
    local_filters.append(f"c.document_id = ${idx}::uuid")
    local_params.append(document_id)
    idx += 1
    local_params.append(anchor_chunk_index)
    anchor_param = idx
    idx += 1
    local_params.append(per_doc_limit)
    limit_param = idx
    sql = f"""
        SELECT c.id, c.document_id, c.chunk_index, c.content, c.checksum, c.source_refs,
               d.source_type, d.source_id, d.owner_user_id, d.visibility,
               d.source_updated_at, d.title, d.metadata,
               0.0::float AS score
        FROM ai.ai_document_chunks c
        JOIN ai.ai_documents d ON d.id = c.document_id
        WHERE {' AND '.join(local_filters)}
        ORDER BY ABS(c.chunk_index - ${anchor_param}::int) ASC, c.chunk_index ASC, c.id ASC
        LIMIT ${limit_param}::int
    """
    return list(await conn.fetch(sql, *local_params))


async def _expand_shadow_neighbor_rows(
    conn,
    *,
    filters: List[str],
    params: List[Any],
    raw_rows: Sequence[Any],
    words: List[str],
    pin_source: bool,
    query: str,
    per_doc_limit: int = SHADOW_NEIGHBOR_PER_DOC,
    global_cap: int = SHADOW_NEIGHBOR_GLOBAL_CAP,
    docs_considered: int = SHADOW_NEIGHBOR_DOCS_CONSIDERED,
) -> Tuple[List[Any], Dict[str, Any]]:
    """T20.10AC C1 — add bounded neighbor chunks for top matched documents."""
    diag: Dict[str, Any] = {
        "neighbor_expansion_enabled": True,
        "neighbor_docs_considered": 0,
        "neighbor_rows_added": 0,
        "candidate_pool_before_neighbors": len(raw_rows),
        "candidate_pool_after_neighbors": len(raw_rows),
    }
    if not raw_rows:
        return list(raw_rows), diag

    existing_ids = {str(row["id"]) for row in raw_rows}
    merged_rows = list(raw_rows)
    neighbors_added = 0
    docs_seen: set[str] = set()

    ranked = sorted(
        raw_rows,
        key=lambda row: (-float(row.get("score") or 0), str(row["id"])),
    )
    for row in ranked:
        if len(docs_seen) >= docs_considered or neighbors_added >= global_cap:
            break
        doc_id = row.get("document_id")
        if not doc_id:
            continue
        doc_key = str(doc_id)
        if doc_key in docs_seen:
            continue
        docs_seen.add(doc_key)
        anchor_index = int(row.get("chunk_index") or 0)
        neighbor_rows = await _fetch_document_neighbor_rows(
            conn,
            filters=filters,
            params=params,
            document_id=doc_key,
            anchor_chunk_index=anchor_index,
            per_doc_limit=per_doc_limit + 1,
        )
        for neighbor in neighbor_rows:
            if neighbors_added >= global_cap:
                break
            neighbor_id = str(neighbor["id"])
            if neighbor_id in existing_ids:
                continue
            if not _chunk_passes_privacy(neighbor, words=words, pin_source=pin_source, query=query):
                continue
            merged_rows.append(neighbor)
            existing_ids.add(neighbor_id)
            neighbors_added += 1

    diag["neighbor_docs_considered"] = len(docs_seen)
    diag["neighbor_rows_added"] = neighbors_added
    diag["candidate_pool_after_neighbors"] = len(merged_rows)
    return merged_rows, diag


async def _apply_shadow_overlap_refinements(
    conn,
    *,
    raw_rows: List[Any],
    keyword_chunks: Optional[Sequence[Mapping[str, Any]]],
    filters: List[str],
    params: List[Any],
    vec_param: int,
    query_vec: Optional[str],
    words: List[str],
    pin_source: bool,
    query: str,
) -> Tuple[List[Any], Dict[str, Any]]:
    """T20.10AC — diagnostic-only overlap refinements (flags default off)."""
    scope_params = params[: max(0, vec_param - 1)]
    refine_diag: Dict[str, Any] = {
        "entity_hints_enabled": False,
        "entity_hint_keys_count": 0,
        "entity_boosted_rows": 0,
        "entity_overlap_before": 0,
        "entity_overlap_after": 0,
        "neighbor_expansion_enabled": False,
        "neighbor_docs_considered": 0,
        "neighbor_rows_added": 0,
        "candidate_pool_before_neighbors": len(raw_rows),
        "candidate_pool_after_neighbors": len(raw_rows),
        "entity_listing_fetch_run": False,
        "entity_listing_fetch_rows": 0,
    }
    if not AI_RAG_SHADOW_ENTITY_HINTS and not AI_RAG_SHADOW_NEIGHBOR_EXPANSION:
        return raw_rows, refine_diag

    merged_rows = list(raw_rows)
    entity_keys: set[str] = set()
    if AI_RAG_SHADOW_ENTITY_HINTS and keyword_chunks:
        entity_keys = extract_keyword_entity_hint_keys(keyword_chunks)
        refine_diag["entity_hints_enabled"] = True
        refine_diag["entity_hint_keys_count"] = len(entity_keys)
        refine_diag["entity_overlap_before"] = _entity_overlap_count_in_rows(entity_keys, merged_rows)

        listing_ids = listing_ids_from_entity_keys(entity_keys)
        if listing_ids and len(listing_ids) <= SHADOW_ENTITY_LISTING_ID_CAP and query_vec:
            hint_rows = await _fetch_listing_entity_hint_rows(
                conn,
                filters=filters,
                scope_params=scope_params,
                query_vec=query_vec,
                listing_ids=listing_ids,
                limit=SHADOW_ENTITY_LISTING_FETCH_LIMIT,
            )
            if hint_rows:
                refine_diag["entity_listing_fetch_run"] = True
                refine_diag["entity_listing_fetch_rows"] = len(hint_rows)
                merged_rows = _merge_vector_rows(merged_rows, hint_rows)

        merged_rows, boosted_count = _apply_entity_hint_score_boost(merged_rows, entity_keys)
        refine_diag["entity_boosted_rows"] = boosted_count

    if AI_RAG_SHADOW_NEIGHBOR_EXPANSION:
        merged_rows, neighbor_diag = await _expand_shadow_neighbor_rows(
            conn,
            filters=filters,
            params=scope_params,
            raw_rows=merged_rows,
            words=words,
            pin_source=pin_source,
            query=query,
        )
        refine_diag.update(neighbor_diag)

    if entity_keys:
        refine_diag["entity_overlap_after"] = _entity_overlap_count_in_rows(entity_keys, merged_rows)

    return merged_rows, refine_diag


async def _collect_route_mode_shadow_rows(
    conn,
    *,
    filters: List[str],
    params: List[Any],
    vec_param: int,
    resolved_profile: str,
    shadow_custom_query_hints: Optional[Sequence[str]],
    query: str,
    max_chunks: int,
    scope_by_type: Dict[str, int],
) -> Tuple[List[Any], Dict[str, Any]]:
    """T20.10W/T20.10Y — shadow-only scoped-first fetch + diversity top-ups."""
    obo_focused = is_obo_focused(resolved_profile, shadow_custom_query_hints)
    global_limit = max_chunks * 2 if obo_focused else max_chunks * 3
    strategy = resolve_shadow_fetch_strategy(
        resolved_profile,
        shadow_custom_query_hints,
        query=query,
        scope_by_type=scope_by_type,
    )
    fetch_diag: Dict[str, Any] = {
        "fetch_strategy": strategy.fetch_strategy,
        "primary_source_type": strategy.primary_source_type,
        "global_fetch_skipped": False,
        "typed_fetches_skipped": [],
        "typed_fetches_run": [],
        "diversity_topups_run": [],
        "diversity_topups_skipped": [],
        "candidate_pool_before_rerank": 0,
        "source_types_before_rerank": [],
    }
    pool_rows: List[Any] = []
    fetched_source_types: set[str] = set()

    async def _typed_fetch(source_type: str, *, limit: Optional[int] = None) -> None:
        if scope_by_type.get(source_type, 0) <= 0:
            return
        type_limit = limit if limit is not None else _shadow_type_fetch_limit(
            source_type,
            max_chunks=max_chunks,
            obo_focused=obo_focused,
        )
        type_rows = await _fetch_vector_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            limit=type_limit,
            extra_source_type=source_type,
        )
        pool_rows.extend(type_rows)
        fetched_source_types.add(source_type)
        fetch_diag["typed_fetches_run"].append(source_type)

    async def _diversity_topup_fetch(source_type: str) -> None:
        await _typed_fetch(source_type, limit=strategy.diversity_topup_limit)
        fetch_diag["diversity_topups_run"].append(source_type)

    def _pool_snapshot() -> Tuple[int, Dict[str, int]]:
        merged = _merge_vector_rows(pool_rows)
        return len(merged), _pool_rows_by_source_type(merged)

    def _pool_is_sufficient(
        pool_size: int,
        pool_by_type: Mapping[str, int],
        *,
        primary_source_type: Optional[str] = None,
    ) -> bool:
        return candidate_pool_is_sufficient(
            pool_size,
            max_chunks,
            pool_by_type=pool_by_type,
            profile=resolved_profile,
            scope_by_type=scope_by_type,
            custom_hints=shadow_custom_query_hints,
            query=query,
            primary_source_type=primary_source_type,
        )

    primary = strategy.primary_source_type
    if strategy.fetch_strategy == "scoped_first" and primary:
        await _typed_fetch(primary)

    for source_type in strategy.diversity_topup_source_types:
        if source_type in fetched_source_types:
            fetch_diag["diversity_topups_skipped"].append(source_type)
            continue
        _, pool_by_type = _pool_snapshot()
        if pool_diversity_satisfied(pool_by_type, strategy.min_source_diversity):
            fetch_diag["diversity_topups_skipped"].append(source_type)
            continue
        await _diversity_topup_fetch(source_type)

    pool_size, pool_by_type = _pool_snapshot()
    if needs_global_fallback(
        pool_size,
        max_chunks,
        pool_by_type=pool_by_type,
        profile=resolved_profile,
        scope_by_type=scope_by_type,
        custom_hints=shadow_custom_query_hints,
        query=query,
        primary_source_type=primary,
    ):
        global_rows = await _fetch_vector_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            limit=global_limit,
        )
        pool_rows = _merge_vector_rows(pool_rows, global_rows)
    else:
        fetch_diag["global_fetch_skipped"] = True

    pool_size, pool_by_type = _pool_snapshot()
    for source_type in strategy.extra_source_types:
        if source_type in fetched_source_types:
            fetch_diag["typed_fetches_skipped"].append(source_type)
            continue
        if _pool_is_sufficient(pool_size, pool_by_type):
            fetch_diag["typed_fetches_skipped"].append(source_type)
            continue
        if source_type_quota_satisfied(
            source_type,
            pool_by_type,
            resolved_profile,
            max_chunks,
            scope_by_type,
            custom_hints=shadow_custom_query_hints,
            query=query,
        ):
            fetch_diag["typed_fetches_skipped"].append(source_type)
            continue
        await _typed_fetch(source_type)
        pool_size, pool_by_type = _pool_snapshot()
        if _pool_is_sufficient(pool_size, pool_by_type):
            for remaining in strategy.extra_source_types:
                if remaining not in fetched_source_types and remaining not in fetch_diag["typed_fetches_skipped"]:
                    fetch_diag["typed_fetches_skipped"].append(remaining)
            break

    merged_rows = _merge_vector_rows(pool_rows)
    fetch_diag["candidate_pool_before_rerank"] = len(merged_rows)
    fetch_diag["source_types_before_rerank"] = sorted(_pool_rows_by_source_type(merged_rows).keys())
    return merged_rows, fetch_diag


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
    shadow_profile_hints: bool = False,
    shadow_custom_query_hints: Optional[Sequence[str]] = None,
    include_diagnostics: bool = False,
    keyword_chunks_for_overlap: Optional[Sequence[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    """Diagnostic-only vector retrieval; same privacy scope as keyword path."""
    total_start = _now_ms()
    diagnostics = ShadowRetrievalDiagnostics(
        enabled=include_diagnostics,
        profile=None,
        query_hints=[],
    )
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
        diagnostics.timings_ms.total = _elapsed_ms(total_start)
        result: Dict[str, Any] = {
            "enabled": True,
            "status": "insufficient_embeddings",
            "embedded_chunks": embedded_count,
            "candidate_count": 0,
            "chunks": [],
            "chunk_ids": [],
            "latency_ms": diagnostics.timings_ms.total,
        }
        if include_diagnostics:
            result["shadow_diagnostics"] = diagnostics.to_dict()
        return result

    explicit_profile = route_shadow_profile
    if explicit_profile:
        resolved_profile = resolve_shadow_profile(explicit_profile)
        profile_source = "explicit"
    else:
        resolved_profile = infer_shadow_profile_from_query(query)
        profile_source = "inferred" if resolved_profile != "generic_rag" else "default"
    route_mode = explicit_profile is not None or resolved_profile != "generic_rag"
    diagnostics.profile = resolved_profile if route_mode else None
    hint_profile = resolved_profile if route_mode else "generic_rag"
    embed_query, expanded_query_terms, query_hint_applied, hint_truncated = expand_query_with_hints(
        query,
        hint_profile,
        apply_profile_hints=shadow_profile_hints,
        custom_hints=list(shadow_custom_query_hints or []),
        max_expanded_chars=AI_RAG_SHADOW_EMBED_HINT_MAX_CHARS,
    )
    if include_diagnostics:
        diagnostics.query_hints = list(expanded_query_terms)
        diagnostics.debug["profile_details"] = resolved_profile_for_diagnostics(
            explicit_profile or resolved_profile,
        )
        diagnostics.debug["profile_source"] = profile_source
        diagnostics.debug["inferred_profile"] = resolved_profile if not explicit_profile else None
        diagnostics.debug["query_hint_applied"] = query_hint_applied
        diagnostics.debug["hint_expansion_truncated"] = hint_truncated

    embed_start = _now_ms()
    query_vec, embed_meta = await _shadow_embed_query(
        embed_query,
        original_query_length=len(query or ""),
        profile_hints_enabled=shadow_profile_hints,
        hint_terms_count=len(expanded_query_terms),
        hint_expansion_truncated=hint_truncated,
        use_cache=True,
    )
    diagnostics.embed = embed_meta
    diagnostics.timings_ms.embed = embed_meta.latency_ms or _elapsed_ms(embed_start)
    if query_vec is None:
        diagnostics.timings_ms.total = _elapsed_ms(total_start)
        status = "embed_timed_out" if embed_meta.timed_out else "embed_failed"
        result = {
            "enabled": True,
            "status": status,
            "embedded_chunks": embedded_count,
            "candidate_count": 0,
            "chunks": [],
            "chunk_ids": [],
            "latency_ms": diagnostics.timings_ms.total,
            "error": (embed_meta.error or embed_meta.fallback_reason or "embed_failed")[:120],
            "query_hint_applied": query_hint_applied,
            "expanded_query_terms": expanded_query_terms,
            "embed_timed_out": embed_meta.timed_out,
        }
        if include_diagnostics:
            result["shadow_diagnostics"] = diagnostics.to_dict()
        return result

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

    preferred_zero_visible: List[str] = []
    scope_by_type: Dict[str, int] = {}
    raw_rows: List[Any] = []
    source_filtered_rows: List[Any] = []
    privacy_filtered_rows: List[Any] = []
    privacy_stats = ShadowPrivacyDiagnostics()

    fetch_start = _now_ms()
    fetch_diag: Dict[str, Any] = {}
    if route_mode:
        preferred = preferred_source_types(resolved_profile)
        weights = source_type_weights(resolved_profile)
        scope_by_type = await count_embedded_by_source_type_for_scope(conn, user_id=user_id)
        preferred_zero_visible = [st for st in preferred if scope_by_type.get(st, 0) == 0]
        raw_rows, fetch_diag = await _collect_route_mode_shadow_rows(
            conn,
            filters=filters,
            params=params,
            vec_param=vec_param,
            resolved_profile=resolved_profile,
            shadow_custom_query_hints=shadow_custom_query_hints,
            query=query,
            max_chunks=max_chunks,
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
        raw_rows = list(global_rows)
        fetch_diag = {}

    overlap_refine_diag: Dict[str, Any] = {}
    if AI_RAG_SHADOW_ENTITY_HINTS or AI_RAG_SHADOW_NEIGHBOR_EXPANSION:
        raw_rows, overlap_refine_diag = await _apply_shadow_overlap_refinements(
            conn,
            raw_rows=raw_rows,
            keyword_chunks=keyword_chunks_for_overlap,
            filters=filters,
            params=params,
            vec_param=vec_param,
            query_vec=str(params[vec_param - 1]) if len(params) >= vec_param else None,
            words=words,
            pin_source=pin_source,
            query=query,
        )
    diagnostics.timings_ms.candidate_fetch = _elapsed_ms(fetch_start)

    source_filter_start = _now_ms()
    if route_mode:
        preferred = preferred_source_types(resolved_profile)
        weights = source_type_weights(resolved_profile)
        source_filtered_rows = _apply_route_weights(raw_rows, weights)
    else:
        source_filtered_rows = list(raw_rows)
    diagnostics.timings_ms.source_filter = _elapsed_ms(source_filter_start)

    privacy_filter_start = _now_ms()
    privacy_filtered_rows, privacy_stats = _partition_privacy_rows(
        source_filtered_rows,
        words=words,
        pin_source=pin_source,
        query=query,
    )
    diagnostics.timings_ms.privacy_filter = _elapsed_ms(privacy_filter_start)
    diagnostics.privacy = privacy_stats

    select_start = _now_ms()
    if route_mode:
        preferred = preferred_source_types(resolved_profile)
        weights = source_type_weights(resolved_profile)
        unweighted_selected = _rows_to_chunks(
            raw_rows,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
        )
        weighted_selected = _select_route_weighted_chunks(
            raw_rows,
            profile=resolved_profile or "generic_rag",
            preferred=preferred,
            weights=weights,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
            scope_by_type=scope_by_type,
            custom_hints=list(shadow_custom_query_hints or []),
            keyword_chunks=keyword_chunks_for_overlap,
        )
    else:
        unweighted_selected = _rows_to_chunks(
            raw_rows,
            words=words,
            pin_source=pin_source,
            query=query,
            max_chunks=max_chunks,
            max_tokens=max_tokens,
        )
        weighted_selected = unweighted_selected
    diagnostics.timings_ms.rerank_select = _elapsed_ms(select_start)
    diagnostics.timings_ms.total = _elapsed_ms(total_start)

    latency_ms = float(diagnostics.timings_ms.total)
    result = {
        "enabled": True,
        "status": "ok",
        "embedded_chunks": embedded_count,
        "candidate_count": len(unweighted_selected),
        "chunks": unweighted_selected,
        "chunk_ids": [c["id"] for c in unweighted_selected],
        "latency_ms": latency_ms,
        "query_hint_applied": query_hint_applied,
        "expanded_query_terms": expanded_query_terms,
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
    if include_diagnostics:
        selected_for_diag = weighted_selected if route_mode else unweighted_selected
        _finalize_shadow_diagnostics(
            diagnostics,
            raw_rows=raw_rows,
            source_filtered_rows=source_filtered_rows,
            privacy_filtered_rows=privacy_filtered_rows,
            selected_chunks=selected_for_diag,
            keyword_chunks=keyword_chunks_for_overlap,
        )
        diagnostics.debug.update({
            "top_k": max_chunks,
            "raw_chunk_ids": _collect_chunk_ids(raw_rows)[:25],
            "selected_chunk_ids": _collect_chunk_ids(selected_for_diag)[:25],
        })
        if fetch_diag:
            diagnostics.debug.update(fetch_diag)
            diagnostics.debug["candidate_fetch_ms"] = diagnostics.timings_ms.candidate_fetch
            if route_mode:
                diagnostics.debug["source_types_after_rerank"] = sorted(
                    _count_by_source_type(selected_for_diag).keys()
                )
        if overlap_refine_diag:
            diagnostics.debug.update(overlap_refine_diag)
        result["shadow_diagnostics"] = diagnostics.to_dict()
    return result


def _top_results_from_chunks(chunks: Sequence[Dict[str, Any]], *, limit: int = 5) -> List[Dict[str, Any]]:
    """Diagnostic labels only — no chunk body text."""
    out: List[Dict[str, Any]] = []
    for ch in chunks[:limit]:
        out.append({
            "source_type": ch.get("source_type"),
            "source_id": ch.get("source_id"),
            "label": ch.get("title") or ch.get("source_id"),
        })
    return out


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
    if shadow_result.get("query_hint_applied") is not None:
        diag["query_hint_applied"] = shadow_result.get("query_hint_applied")
        diag["expanded_query_terms"] = shadow_result.get("expanded_query_terms") or []
    if shadow_result.get("chunks"):
        diag["top_results"] = _top_results_from_chunks(shadow_result["chunks"])
    shadow_diag = shadow_result.get("shadow_diagnostics")
    if shadow_diag:
        diag["timings_ms"] = shadow_diag.get("timings_ms")
        diag["counts"] = shadow_diag.get("counts")
        diag["by_source_type"] = shadow_diag.get("by_source_type")
        diag["privacy"] = shadow_diag.get("privacy")
        overlap = shadow_diag.get("overlap") or {}
        if overlap:
            diag["overlap_count"] = overlap.get("count", diag.get("overlap_with_keyword", 0))
            diag["overlap_ratio_vs_keyword"] = overlap.get("ratio_vs_keyword")
            diag["overlap_ratio_vs_shadow"] = overlap.get("ratio_vs_shadow")
            diag["overlap_ids"] = overlap.get("overlap_ids")
            diag["document_overlap_count"] = overlap.get("document_overlap_count")
            diag["entity_overlap_count"] = overlap.get("entity_overlap_count")
            explanation = overlap.get("explanation")
            if explanation:
                diag["overlap_explanation"] = explanation
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
