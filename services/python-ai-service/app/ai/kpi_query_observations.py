"""Phase 26D — KPI query observation payload builder and DB insert (default-off gated)."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Mapping, Optional, Union

logger = logging.getLogger(__name__)

FORBIDDEN_PAYLOAD_KEYS = frozenset(
    {
        "question",
        "prompt",
        "answer",
        "summary",
        "response_body",
        "raw_response_body",
        "message_body",
        "raw_message_body",
        "jwt",
        "token",
        "password",
        "authorization_header",
        "authorization",
        "cookie",
        "cookies",
        "raw_user_email",
        "user_email",
        "email",
        "private_message",
        "proxy_max_bid",
        "user_id",
        "db_dump",
        "explanation",
        "excerpts",
        "citations",
    }
)

REQUIRED_PAYLOAD_KEYS = frozenset(
    {
        "observed_at",
        "protocol",
        "retrieval_mode",
        "rag_total_ms",
        "environment",
    }
)

VALID_PROTOCOLS = frozenset({"HTTP/1.1", "HTTP/2", "HTTP/3", "unknown"})


class KpiQueryObservationError(ValueError):
    """Invalid or forbidden query KPI payload."""


class KpiQueryObservationWriteError(RuntimeError):
    """Query KPI write failed (e.g. DB unavailable)."""


@dataclass(frozen=True)
class RedactedQueryObservationRow:
    observed_at: datetime
    protocol: str
    retrieval_mode: str
    gate_reason: Optional[str]
    case_id: Optional[str]
    workflow: Optional[str]
    rag_total_ms: int
    hybrid_retrieval_ms: Optional[int]
    keyword_retrieval_ms: Optional[int]
    fallback_count: int
    canary_error_count: int
    http_status: Optional[int]
    environment: str

    def as_db_params(self) -> Dict[str, Any]:
        return {
            "observed_at": self.observed_at,
            "protocol": self.protocol,
            "retrieval_mode": self.retrieval_mode,
            "gate_reason": self.gate_reason,
            "case_id": self.case_id,
            "workflow": self.workflow,
            "rag_total_ms": self.rag_total_ms,
            "hybrid_retrieval_ms": self.hybrid_retrieval_ms,
            "keyword_retrieval_ms": self.keyword_retrieval_ms,
            "fallback_count": self.fallback_count,
            "canary_error_count": self.canary_error_count,
            "http_status": self.http_status,
            "environment": self.environment,
        }


def normalize_http_protocol(http_version: Optional[str]) -> str:
    """Map ASGI http_version to labeled protocol (not forwarded scheme headers)."""
    if http_version is None:
        return "unknown"
    version = str(http_version).strip()
    if not version:
        return "unknown"
    if version == "1.1":
        return "HTTP/1.1"
    if version == "2":
        return "HTTP/2"
    if version == "3":
        return "HTTP/3"
    return "unknown"


def normalize_http_protocol_from_scope(scope: Optional[Mapping[str, Any]]) -> str:
    if not scope:
        return "unknown"
    return normalize_http_protocol(scope.get("http_version"))


def _parse_timestamp(value: Union[str, datetime]) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    raise KpiQueryObservationError(f"unsupported observed_at type: {type(value).__name__}")


def _parse_required_int(value: Any, field: str, *, min_value: int = 0) -> int:
    if value is None:
        raise KpiQueryObservationError(f"{field} is required")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise KpiQueryObservationError(f"{field} must be an integer") from exc
    if parsed < min_value:
        raise KpiQueryObservationError(f"{field} must be >= {min_value}")
    return parsed


def _parse_optional_int(value: Any, field: str) -> Optional[int]:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise KpiQueryObservationError(f"{field} must be an integer") from exc
    if parsed < 0:
        raise KpiQueryObservationError(f"{field} must be non-negative")
    return parsed


def build_redacted_query_observation(payload: Mapping[str, Any]) -> RedactedQueryObservationRow:
    forbidden = FORBIDDEN_PAYLOAD_KEYS.intersection(payload.keys())
    if forbidden:
        raise KpiQueryObservationError(f"forbidden payload fields: {sorted(forbidden)}")

    missing = REQUIRED_PAYLOAD_KEYS.difference(payload.keys())
    if missing:
        raise KpiQueryObservationError(f"missing required payload fields: {sorted(missing)}")

    protocol = str(payload["protocol"]).strip()
    if protocol not in VALID_PROTOCOLS:
        raise KpiQueryObservationError(f"unsupported protocol label: {protocol}")

    retrieval_mode = str(payload["retrieval_mode"]).strip()
    if not retrieval_mode:
        raise KpiQueryObservationError("retrieval_mode is required")

    environment = str(payload["environment"]).strip()
    if not environment:
        raise KpiQueryObservationError("environment is required")

    gate_reason = payload.get("gate_reason")
    if gate_reason is not None:
        gate_reason = str(gate_reason).strip() or None

    case_id = payload.get("case_id")
    if case_id is not None:
        case_id = str(case_id).strip() or None

    workflow = payload.get("workflow")
    if workflow is not None:
        workflow = str(workflow).strip() or None

    http_status = payload.get("http_status")
    if http_status is not None:
        http_status = _parse_required_int(http_status, "http_status", min_value=100)

    return RedactedQueryObservationRow(
        observed_at=_parse_timestamp(payload["observed_at"]),
        protocol=protocol,
        retrieval_mode=retrieval_mode,
        gate_reason=gate_reason,
        case_id=case_id,
        workflow=workflow,
        rag_total_ms=_parse_required_int(payload["rag_total_ms"], "rag_total_ms"),
        hybrid_retrieval_ms=_parse_optional_int(payload.get("hybrid_retrieval_ms"), "hybrid_retrieval_ms"),
        keyword_retrieval_ms=_parse_optional_int(payload.get("keyword_retrieval_ms"), "keyword_retrieval_ms"),
        fallback_count=_parse_required_int(payload.get("fallback_count", 0), "fallback_count"),
        canary_error_count=_parse_required_int(payload.get("canary_error_count", 0), "canary_error_count"),
        http_status=http_status,
        environment=environment,
    )


def extract_query_observation_context(
    *,
    rag_envelope: Mapping[str, Any],
    rag_total_ms: int,
    protocol: str,
    http_status: int = 200,
    environment: Optional[str] = None,
    case_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build redacted observation payload from RAG envelope metrics only (no question/answer)."""
    details = rag_envelope.get("details") or {}
    hybrid = details.get("hybrid_canary") or {}

    gate_reason = hybrid.get("gate_reason") or "keyword_default"
    retrieval_mode = details.get("retrieval_mode") or hybrid.get("retrieval_mode") or "keyword"

    fallback_count = 1 if hybrid.get("hybrid_fallback") else 0
    canary_error_count = 1 if hybrid.get("hybrid_error") else 0

    keyword_ms = hybrid.get("keyword_latency_ms")
    hybrid_ms = hybrid.get("hybrid_latency_ms")

    return {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "protocol": protocol,
        "retrieval_mode": str(retrieval_mode),
        "gate_reason": str(gate_reason) if gate_reason is not None else None,
        "case_id": case_id,
        "workflow": str(rag_envelope.get("contract_id") or "rag_query"),
        "rag_total_ms": int(rag_total_ms),
        "keyword_retrieval_ms": int(keyword_ms) if keyword_ms is not None else None,
        "hybrid_retrieval_ms": int(hybrid_ms) if hybrid_ms is not None else None,
        "fallback_count": fallback_count,
        "canary_error_count": canary_error_count,
        "http_status": int(http_status),
        "environment": environment or os.getenv("AI_KPI_ENVIRONMENT", "local"),
    }


_INSERT_SQL = """
INSERT INTO ai.ai_kpi_query_observations (
  observed_at,
  protocol,
  retrieval_mode,
  gate_reason,
  case_id,
  workflow,
  rag_total_ms,
  hybrid_retrieval_ms,
  keyword_retrieval_ms,
  fallback_count,
  canary_error_count,
  http_status,
  environment
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING id::text
"""


async def insert_kpi_query_observation_row(row: RedactedQueryObservationRow) -> str:
    from app.db import get_pool

    pool = await get_pool()
    if not pool:
        raise KpiQueryObservationWriteError("python_ai DB unavailable for KPI query observation insert")

    params = row.as_db_params()
    try:
        observation_id = await pool.fetchval(
            _INSERT_SQL,
            params["observed_at"],
            params["protocol"],
            params["retrieval_mode"],
            params["gate_reason"],
            params["case_id"],
            params["workflow"],
            params["rag_total_ms"],
            params["hybrid_retrieval_ms"],
            params["keyword_retrieval_ms"],
            params["fallback_count"],
            params["canary_error_count"],
            params["http_status"],
            params["environment"],
        )
    except Exception as exc:
        raise KpiQueryObservationWriteError(str(exc)) from exc

    if not observation_id:
        raise KpiQueryObservationWriteError("KPI query observation insert returned no id")
    return str(observation_id)


async def write_kpi_query_observation(payload: Mapping[str, Any]) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("query"):
        return None
    row = build_redacted_query_observation(payload)
    return await insert_kpi_query_observation_row(row)


InsertFn = Callable[[RedactedQueryObservationRow], str]


def write_kpi_query_observation_sync(
    payload: Mapping[str, Any],
    *,
    insert_fn: Optional[InsertFn] = None,
) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("query"):
        return None
    row = build_redacted_query_observation(payload)
    if insert_fn is not None:
        return insert_fn(row)
    raise KpiQueryObservationWriteError(
        "sync KPI query observation write requires insert_fn; use write_kpi_query_observation async API"
    )


async def emit_rag_query_observation_safe(
    *,
    http_scope: Optional[Mapping[str, Any]],
    rag_envelope: Mapping[str, Any],
    rag_total_ms: int,
    http_status: int = 200,
    case_id: Optional[str] = None,
) -> Optional[str]:
    """Emit query observation without affecting RAG response on failure."""
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("query"):
        return None
    try:
        protocol = normalize_http_protocol_from_scope(http_scope)
        payload = extract_query_observation_context(
            rag_envelope=rag_envelope,
            rag_total_ms=rag_total_ms,
            protocol=protocol,
            http_status=http_status,
            case_id=case_id,
        )
        return await write_kpi_query_observation(payload)
    except Exception as exc:
        logger.warning("KPI query observation emit skipped: %s", str(exc)[:200])
        return None
