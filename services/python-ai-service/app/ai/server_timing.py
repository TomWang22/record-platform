"""Phase 32D — redacted server timing metadata for controlled RAG attribution."""
from __future__ import annotations

from typing import Any, Dict, Mapping, MutableMapping, Optional

FORBIDDEN_TIMING_KEYS = frozenset(
    {
        "question",
        "prompt",
        "answer",
        "summary",
        "response_body",
        "message_body",
        "jwt",
        "token",
        "password",
        "private_message",
        "proxy_max_bid",
        "user_email",
        "user_id",
    }
)

ALLOWED_TIMING_KEYS = frozenset(
    {
        "rag_total_ms",
        "server_total_ms",
        "retrieval_total_ms",
        "kpi_query_write_ms",
        "kpi_usefulness_write_ms",
    }
)


def _retrieval_total_ms(details: Mapping[str, Any]) -> Optional[float]:
    hybrid = details.get("hybrid_canary") or {}
    keyword_ms = hybrid.get("keyword_latency_ms")
    hybrid_ms = hybrid.get("hybrid_latency_ms")
    if keyword_ms is not None and hybrid_ms is not None:
        return round(float(keyword_ms) + float(hybrid_ms), 2)
    if keyword_ms is not None:
        return round(float(keyword_ms), 2)
    if hybrid_ms is not None:
        return round(float(hybrid_ms), 2)
    return None


def build_redacted_rag_timing_details(
    envelope: Mapping[str, Any],
    *,
    rag_total_ms: int,
    kpi_query_write_ms: Optional[int] = None,
    kpi_usefulness_write_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Return redacted timing fields safe to expose in RAG response details."""
    if rag_total_ms < 0:
        raise ValueError("rag_total_ms must be non-negative")
    base_details = dict(envelope.get("details") or {})
    timing: Dict[str, Any] = {
        "rag_total_ms": int(rag_total_ms),
        "server_total_ms": int(rag_total_ms),
    }
    retrieval_total = _retrieval_total_ms(base_details)
    if retrieval_total is not None:
        timing["retrieval_total_ms"] = retrieval_total
    if kpi_query_write_ms is not None:
        timing["kpi_query_write_ms"] = max(0, int(kpi_query_write_ms))
    if kpi_usefulness_write_ms is not None:
        timing["kpi_usefulness_write_ms"] = max(0, int(kpi_usefulness_write_ms))
    for key in timing:
        if key not in ALLOWED_TIMING_KEYS:
            raise ValueError(f"unexpected timing key: {key}")
    return timing


def inject_redacted_rag_timing_details(
    envelope: MutableMapping[str, Any],
    *,
    rag_total_ms: int,
    kpi_query_write_ms: Optional[int] = None,
    kpi_usefulness_write_ms: Optional[int] = None,
) -> MutableMapping[str, Any]:
    details = dict(envelope.get("details") or {})
    timing = build_redacted_rag_timing_details(
        envelope,
        rag_total_ms=rag_total_ms,
        kpi_query_write_ms=kpi_query_write_ms,
        kpi_usefulness_write_ms=kpi_usefulness_write_ms,
    )
    for forbidden in FORBIDDEN_TIMING_KEYS:
        if forbidden in timing:
            raise ValueError(f"forbidden timing field: {forbidden}")
    details.update(timing)
    envelope["details"] = details
    return envelope
