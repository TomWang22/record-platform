"""Shared Phase 15 AI response envelope."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.ai.config import FORBIDDEN_RESPONSE_RE


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def source_ref(
    source_type: str,
    source_id: str,
    *,
    field: Optional[str] = None,
    freshness: Optional[str] = None,
    checksum: Optional[str] = None,
) -> Dict[str, Any]:
    ref: Dict[str, Any] = {
        "source_type": source_type,
        "source_id": str(source_id),
    }
    if field:
        ref["field"] = field
    if freshness:
        ref["freshness"] = freshness
    if checksum:
        ref["checksum"] = checksum
    return ref


def assert_no_forbidden_prose(text: str) -> None:
    lower = text.lower()
    for term in FORBIDDEN_RESPONSE_RE:
        if term in lower:
            raise ValueError(f"forbidden prose term: {term}")


def build_envelope(
    contract_id: str,
    *,
    source_status: str,
    model_used: str,
    summary: str,
    details: Optional[Dict[str, Any]] = None,
    source_refs: Optional[List[Dict[str, Any]]] = None,
    confidence: float = 0.0,
    degraded_reason: Optional[str] = None,
    citations: Optional[List[Dict[str, Any]]] = None,
    insight_id: Optional[str] = None,
) -> Dict[str, Any]:
    assert source_status in ("live", "degraded")
    if summary:
        assert_no_forbidden_prose(summary)
    refs = source_refs or []
    if source_status == "live" and not refs:
        source_status = "degraded"
        degraded_reason = degraded_reason or "no_source_refs"
    body: Dict[str, Any] = {
        "insight_id": insight_id or str(uuid.uuid4()),
        "contract_id": contract_id,
        "source_status": source_status,
        "model_used": model_used,
        "generated_at": _utc_now(),
        "confidence": round(max(0.0, min(1.0, confidence)), 3),
        "summary": summary,
        "details": details or {},
        "source_refs": refs,
        "citations": citations or [],
    }
    if degraded_reason:
        body["degraded_reason"] = degraded_reason
    return body


def chunk_to_citation(chunk: Dict[str, Any], excerpt_len: int = 240) -> Dict[str, Any]:
    content = str(chunk.get("content") or "")[:excerpt_len]
    return {
        "source_type": chunk.get("source_type"),
        "source_id": chunk.get("source_id"),
        "chunk_index": chunk.get("chunk_index"),
        "excerpt": content,
        "checksum": chunk.get("checksum"),
    }
