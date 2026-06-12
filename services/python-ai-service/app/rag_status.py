"""
T15.3A — RAG corpus readiness + AI runtime provider status.
Structured status only — no fabricated LLM prose.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from app.ai.config import (
    AI_EMBEDDING_MODEL,
    AI_MAX_RESPONSE_TOKENS,
    AI_MODEL_PROVIDER,
    AI_OLLAMA_MODEL,
    AI_RAG_MAX_CHUNKS,
    AI_RAG_MAX_CONTEXT_TOKENS,
)
from app.ai.providers.registry import get_provider, provider_status_map
from app.db import get_pool

logger = logging.getLogger(__name__)


async def get_rag_status() -> Dict[str, Any]:
    providers = await provider_status_map()
    active = get_provider()
    active_status = await active.status()

    model_used = "none"
    if active.name == "ollama" and active_status.get("available"):
        model_used = AI_OLLAMA_MODEL
    elif active.name == "rule":
        model_used = "rule-engine"
    elif active_status.get("available"):
        model_used = active.name

    pool = await get_pool()
    if not pool:
        return {
            "ok": False,
            "source_status": "degraded",
            "reason": "python_ai_db_unavailable",
            "model_used": model_used,
            "model_provider": AI_MODEL_PROVIDER,
            "providers": providers,
            "retrieval_mode": "keyword",
            "embedding_status": "degraded",
            "limits": {
                "max_chunks": AI_RAG_MAX_CHUNKS,
                "max_context_tokens": AI_RAG_MAX_CONTEXT_TOKENS,
                "max_response_tokens": AI_MAX_RESPONSE_TOKENS,
            },
        }

    async with pool.acquire() as conn:
        doc_count = await conn.fetchval("SELECT COUNT(*)::int FROM ai.ai_documents")
        chunk_count = await conn.fetchval("SELECT COUNT(*)::int FROM ai.ai_document_chunks")
        source_rows = await conn.fetch(
            "SELECT source_type, COUNT(*)::int AS cnt FROM ai.ai_documents GROUP BY source_type ORDER BY source_type"
        )
        source_counts = {r["source_type"]: r["cnt"] for r in source_rows}
        last_run = await conn.fetchrow(
            """
            SELECT id, status, started_at, finished_at, source_counts
            FROM ai.ai_ingestion_runs
            ORDER BY started_at DESC
            LIMIT 1
            """
        )
        embedded = await conn.fetchval(
            "SELECT COUNT(*)::int FROM ai.ai_document_chunks WHERE embedding IS NOT NULL"
        )

    ollama_st = providers.get("ollama", {})
    embed_ok = bool(embedded) and ollama_st.get("embedding_model_present", False)
    embedding_status = "live" if embed_ok else "degraded"
    corpus_ok = doc_count > 0 and chunk_count > 0
    provider_ok = bool(active_status.get("available"))
    source_status = "live" if corpus_ok and provider_ok else "degraded"

    last_ingestion: Optional[Dict[str, Any]] = None
    if last_run:
        sc = last_run["source_counts"]
        if isinstance(sc, str):
            sc = json.loads(sc)
        last_ingestion = {
            "id": str(last_run["id"]),
            "status": last_run["status"],
            "started_at": last_run["started_at"].isoformat() if last_run["started_at"] else None,
            "finished_at": last_run["finished_at"].isoformat() if last_run["finished_at"] else None,
            "source_counts": sc,
        }

    body: Dict[str, Any] = {
        "ok": True,
        "source_status": source_status,
        "model_used": model_used,
        "model_provider": AI_MODEL_PROVIDER,
        "providers": providers,
        "retrieval_mode": "keyword",
        "corpus": {
            "document_count": doc_count,
            "chunk_count": chunk_count,
            "source_counts": source_counts,
            "chunks_with_embedding": embedded,
        },
        "embedding_status": embedding_status,
        "embedding_model": AI_EMBEDDING_MODEL,
        "last_ingestion_run": last_ingestion,
        "limits": {
            "max_chunks": AI_RAG_MAX_CHUNKS,
            "max_context_tokens": AI_RAG_MAX_CONTEXT_TOKENS,
            "max_response_tokens": AI_MAX_RESPONSE_TOKENS,
        },
    }
    if not provider_ok:
        body["degraded_reason"] = active_status.get("reason", "provider_unavailable")
    elif not corpus_ok:
        body["degraded_reason"] = "corpus_empty"
    return body
