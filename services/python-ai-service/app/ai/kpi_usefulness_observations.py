"""Phase 26E — KPI usefulness observation payload builder and DB insert (default-off gated)."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, Mapping, Optional, Union

from app.ai.kpi_query_observations import normalize_http_protocol

logger = logging.getLogger(__name__)

FORBIDDEN_PAYLOAD_KEYS = frozenset(
    {
        "question",
        "prompt",
        "answer",
        "summary",
        "response",
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
        "rubric_input",
        "raw_rubric_input",
    }
)

REQUIRED_PAYLOAD_KEYS = frozenset(
    {
        "observed_at",
        "protocol",
        "response_pass",
        "leakage_failures",
        "environment",
    }
)

VALID_PROTOCOLS = frozenset({"HTTP/1.1", "HTTP/2", "HTTP/3", "unknown"})

KNOWN_EVIDENCE_LABELS = frozenset(
    {
        "H1 baseline 57105/57105",
        "H2 replay 57105/57105",
        "H3 replay 57105/57105",
        "Phase 22C 7200/7200 sample only",
        "Phase 22B 15/15 smoke only",
        "manual/dev usefulness observation",
        "Phase 28 controlled observability production-readiness matrix: 25920/25920 target",
        "Phase 29 controlled observability production-enablement matrix: 25920/25920 target",
    }
)


class KpiUsefulnessObservationError(ValueError):
    """Invalid or forbidden usefulness KPI payload."""


class KpiUsefulnessWriteError(RuntimeError):
    """Usefulness KPI write failed (e.g. DB unavailable)."""


@dataclass(frozen=True)
class RedactedUsefulnessObservationRow:
    observed_at: datetime
    protocol: str
    case_id: Optional[str]
    workflow: Optional[str]
    response_pass: bool
    sentiment_pass: Optional[bool]
    red_team_safety_pass: Optional[bool]
    leakage_failures: int
    quality_score: Optional[Decimal]
    evidence_label: Optional[str]
    environment: str

    def as_db_params(self) -> Dict[str, Any]:
        return {
            "observed_at": self.observed_at,
            "protocol": self.protocol,
            "case_id": self.case_id,
            "workflow": self.workflow,
            "response_pass": self.response_pass,
            "sentiment_pass": self.sentiment_pass,
            "red_team_safety_pass": self.red_team_safety_pass,
            "leakage_failures": self.leakage_failures,
            "quality_score": self.quality_score,
            "evidence_label": self.evidence_label,
            "environment": self.environment,
        }


def _parse_timestamp(value: Union[str, datetime]) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    raise KpiUsefulnessObservationError(f"unsupported observed_at type: {type(value).__name__}")


def _parse_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    raise KpiUsefulnessObservationError(f"{field} must be a boolean")


def _parse_optional_bool(value: Any, field: str) -> Optional[bool]:
    if value is None:
        return None
    return _parse_bool(value, field)


def _parse_required_int(value: Any, field: str, *, min_value: int = 0) -> int:
    if value is None:
        raise KpiUsefulnessObservationError(f"{field} is required")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise KpiUsefulnessObservationError(f"{field} must be an integer") from exc
    if parsed < min_value:
        raise KpiUsefulnessObservationError(f"{field} must be >= {min_value}")
    return parsed


def _parse_quality_score(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise KpiUsefulnessObservationError("quality_score must be numeric") from exc
    if parsed < Decimal("0") or parsed > Decimal("5"):
        raise KpiUsefulnessObservationError("quality_score must be between 0.00 and 5.00")
    return parsed.quantize(Decimal("0.01"))


def _normalize_protocol(value: Any) -> str:
    protocol = str(value).strip()
    if protocol in VALID_PROTOCOLS:
        return protocol
    return normalize_http_protocol(protocol)


def _validate_evidence_label(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    label = str(value).strip()
    if not label:
        return None
    if label not in KNOWN_EVIDENCE_LABELS:
        raise KpiUsefulnessObservationError(f"unsupported evidence_label: {label}")
    return label


def build_usefulness_observation_payload(
    *,
    protocol: str,
    response_pass: bool,
    leakage_failures: int = 0,
    observed_at: Optional[Union[str, datetime]] = None,
    case_id: Optional[str] = None,
    workflow: Optional[str] = None,
    sentiment_pass: Optional[bool] = None,
    red_team_safety_pass: Optional[bool] = None,
    quality_score: Optional[Union[float, Decimal, str]] = None,
    evidence_label: Optional[str] = None,
    environment: Optional[str] = None,
) -> Dict[str, Any]:
    """Build redacted usefulness payload from caller-supplied rubric metadata only."""
    normalized_protocol = _normalize_protocol(protocol)
    validated_label = _validate_evidence_label(evidence_label)
    parsed_quality = _parse_quality_score(quality_score)

    return {
        "observed_at": observed_at or datetime.now(timezone.utc).isoformat(),
        "protocol": normalized_protocol,
        "case_id": case_id,
        "workflow": workflow,
        "response_pass": response_pass,
        "sentiment_pass": sentiment_pass,
        "red_team_safety_pass": red_team_safety_pass,
        "leakage_failures": leakage_failures,
        "quality_score": float(parsed_quality) if parsed_quality is not None else None,
        "evidence_label": validated_label,
        "environment": environment or os.getenv("AI_KPI_ENVIRONMENT", "local"),
    }


def build_redacted_usefulness_observation(payload: Mapping[str, Any]) -> RedactedUsefulnessObservationRow:
    forbidden = FORBIDDEN_PAYLOAD_KEYS.intersection(payload.keys())
    if forbidden:
        raise KpiUsefulnessObservationError(f"forbidden payload fields: {sorted(forbidden)}")

    missing = REQUIRED_PAYLOAD_KEYS.difference(payload.keys())
    if missing:
        raise KpiUsefulnessObservationError(f"missing required payload fields: {sorted(missing)}")

    protocol = _normalize_protocol(payload["protocol"])
    environment = str(payload["environment"]).strip()
    if not environment:
        raise KpiUsefulnessObservationError("environment is required")

    case_id = payload.get("case_id")
    if case_id is not None:
        case_id = str(case_id).strip() or None

    workflow = payload.get("workflow")
    if workflow is not None:
        workflow = str(workflow).strip() or None

    evidence_label = _validate_evidence_label(payload.get("evidence_label"))
    quality_score = _parse_quality_score(payload.get("quality_score"))

    return RedactedUsefulnessObservationRow(
        observed_at=_parse_timestamp(payload["observed_at"]),
        protocol=protocol,
        case_id=case_id,
        workflow=workflow,
        response_pass=_parse_bool(payload["response_pass"], "response_pass"),
        sentiment_pass=_parse_optional_bool(payload.get("sentiment_pass"), "sentiment_pass"),
        red_team_safety_pass=_parse_optional_bool(payload.get("red_team_safety_pass"), "red_team_safety_pass"),
        leakage_failures=_parse_required_int(payload["leakage_failures"], "leakage_failures"),
        quality_score=quality_score,
        evidence_label=evidence_label,
        environment=environment,
    )


_INSERT_SQL = """
INSERT INTO ai.ai_kpi_usefulness_observations (
  observed_at,
  protocol,
  case_id,
  workflow,
  response_pass,
  sentiment_pass,
  red_team_safety_pass,
  leakage_failures,
  quality_score,
  evidence_label,
  environment
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING id::text
"""


async def insert_kpi_usefulness_observation_row(row: RedactedUsefulnessObservationRow) -> str:
    from app.db import get_pool

    pool = await get_pool()
    if not pool:
        raise KpiUsefulnessWriteError("python_ai DB unavailable for KPI usefulness observation insert")

    params = row.as_db_params()
    try:
        observation_id = await pool.fetchval(
            _INSERT_SQL,
            params["observed_at"],
            params["protocol"],
            params["case_id"],
            params["workflow"],
            params["response_pass"],
            params["sentiment_pass"],
            params["red_team_safety_pass"],
            params["leakage_failures"],
            params["quality_score"],
            params["evidence_label"],
            params["environment"],
        )
    except Exception as exc:
        raise KpiUsefulnessWriteError(str(exc)) from exc

    if not observation_id:
        raise KpiUsefulnessWriteError("KPI usefulness observation insert returned no id")
    return str(observation_id)


async def write_kpi_usefulness_observation(payload: Mapping[str, Any]) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("usefulness"):
        return None
    row = build_redacted_usefulness_observation(payload)
    return await insert_kpi_usefulness_observation_row(row)


InsertFn = Callable[[RedactedUsefulnessObservationRow], str]


def write_kpi_usefulness_observation_sync(
    payload: Mapping[str, Any],
    *,
    insert_fn: Optional[InsertFn] = None,
) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("usefulness"):
        return None
    row = build_redacted_usefulness_observation(payload)
    if insert_fn is not None:
        return insert_fn(row)
    raise KpiUsefulnessWriteError(
        "sync KPI usefulness write requires insert_fn; use write_kpi_usefulness_observation async API"
    )


async def emit_usefulness_observation_safe(payload: Mapping[str, Any]) -> Optional[str]:
    """Emit usefulness observation without raising to callers on failure."""
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("usefulness"):
        return None
    try:
        return await write_kpi_usefulness_observation(payload)
    except Exception as exc:
        logger.warning("KPI usefulness observation emit skipped: %s", str(exc)[:200])
        return None
