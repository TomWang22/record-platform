"""Phase 26C — KPI searchability check payload builder and DB insert (default-off gated)."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Mapping, Optional, Union

FORBIDDEN_PAYLOAD_KEYS = frozenset(
    {
        "source_id",
        "raw_source_id",
        "probe_query",
        "raw_probe_query",
        "response_body",
        "raw_response_body",
        "message_body",
        "raw_message_body",
        "jwt",
        "token",
        "password",
        "proxy_max_bid",
        "private_message",
        "authorization_header",
        "db_dump",
    }
)

REQUIRED_PAYLOAD_KEYS = frozenset(
    {
        "source_type",
        "source_id_hash",
        "searchable_verified_at",
        "arrival_to_searchable_ms",
        "probe_status",
    }
)

VALID_PROBE_STATUSES = frozenset({"PASS", "FAIL"})

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class KpiSearchabilityCheckError(ValueError):
    """Invalid or forbidden searchability KPI payload."""


class KpiSearchabilityWriteError(RuntimeError):
    """Searchability KPI write failed (e.g. DB unavailable)."""


@dataclass(frozen=True)
class RedactedSearchabilityCheckRow:
    ingestion_run_id: Optional[str]
    source_type: str
    source_id_hash: str
    data_arrived_at: Optional[datetime]
    searchable_verified_at: datetime
    arrival_to_searchable_ms: int
    probe_query_hash: Optional[str]
    probe_status: str
    protocol: Optional[str]

    def as_db_params(self) -> Dict[str, Any]:
        return {
            "ingestion_run_id": self.ingestion_run_id,
            "source_type": self.source_type,
            "source_id_hash": self.source_id_hash,
            "data_arrived_at": self.data_arrived_at,
            "searchable_verified_at": self.searchable_verified_at,
            "arrival_to_searchable_ms": self.arrival_to_searchable_ms,
            "probe_query_hash": self.probe_query_hash,
            "probe_status": self.probe_status,
            "protocol": self.protocol,
        }


def hash_source_id(source_id: str) -> str:
    digest = hashlib.sha256(source_id.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def hash_probe_query(probe_query: str) -> str:
    digest = hashlib.sha256(probe_query.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _parse_timestamp(value: Union[str, datetime, None]) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    raise KpiSearchabilityCheckError(f"unsupported timestamp type: {type(value).__name__}")


def _parse_required_timestamp(value: Union[str, datetime]) -> datetime:
    parsed = _parse_timestamp(value)
    if parsed is None:
        raise KpiSearchabilityCheckError("required timestamp missing")
    return parsed


def _parse_required_int(value: Any, field: str) -> int:
    if value is None:
        raise KpiSearchabilityCheckError(f"{field} is required")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise KpiSearchabilityCheckError(f"{field} must be an integer") from exc
    if parsed < 0:
        raise KpiSearchabilityCheckError(f"{field} must be non-negative")
    return parsed


def build_redacted_searchability_check(payload: Mapping[str, Any]) -> RedactedSearchabilityCheckRow:
    forbidden = FORBIDDEN_PAYLOAD_KEYS.intersection(payload.keys())
    if forbidden:
        raise KpiSearchabilityCheckError(f"forbidden payload fields: {sorted(forbidden)}")

    missing = REQUIRED_PAYLOAD_KEYS.difference(payload.keys())
    if missing:
        raise KpiSearchabilityCheckError(f"missing required payload fields: {sorted(missing)}")

    source_type = str(payload["source_type"]).strip()
    if not source_type:
        raise KpiSearchabilityCheckError("source_type is required")

    source_id_hash = payload.get("source_id_hash")
    if not isinstance(source_id_hash, str) or not source_id_hash.startswith("sha256:"):
        raise KpiSearchabilityCheckError("source_id_hash must be a sha256: prefixed hash")

    probe_query_hash = payload.get("probe_query_hash")
    if probe_query_hash is not None and (
        not isinstance(probe_query_hash, str) or not probe_query_hash.startswith("sha256:")
    ):
        raise KpiSearchabilityCheckError("probe_query_hash must be a sha256: prefixed hash")

    probe_status = str(payload["probe_status"]).upper()
    if probe_status not in VALID_PROBE_STATUSES:
        raise KpiSearchabilityCheckError("probe_status must be PASS or FAIL")

    ingestion_run_id = payload.get("ingestion_run_id")
    if ingestion_run_id is not None:
        ingestion_run_id = str(ingestion_run_id)
        if not _UUID_RE.match(ingestion_run_id):
            raise KpiSearchabilityCheckError("ingestion_run_id must be a UUID")

    protocol = payload.get("protocol")
    if protocol is not None:
        protocol = str(protocol).strip() or None

    return RedactedSearchabilityCheckRow(
        ingestion_run_id=ingestion_run_id,
        source_type=source_type,
        source_id_hash=source_id_hash,
        data_arrived_at=_parse_timestamp(payload.get("data_arrived_at")),
        searchable_verified_at=_parse_required_timestamp(payload["searchable_verified_at"]),
        arrival_to_searchable_ms=_parse_required_int(payload["arrival_to_searchable_ms"], "arrival_to_searchable_ms"),
        probe_query_hash=probe_query_hash,
        probe_status=probe_status,
        protocol=protocol,
    )


_INSERT_SQL = """
INSERT INTO ai.ai_kpi_searchability_checks (
  ingestion_run_id,
  source_type,
  source_id_hash,
  data_arrived_at,
  searchable_verified_at,
  arrival_to_searchable_ms,
  probe_query_hash,
  probe_status,
  protocol
) VALUES (
  $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING id::text
"""


async def insert_kpi_searchability_check_row(row: RedactedSearchabilityCheckRow) -> str:
    from app.db import get_pool

    pool = await get_pool()
    if not pool:
        raise KpiSearchabilityWriteError("python_ai DB unavailable for KPI searchability check insert")

    params = row.as_db_params()
    try:
        check_id = await pool.fetchval(
            _INSERT_SQL,
            params["ingestion_run_id"],
            params["source_type"],
            params["source_id_hash"],
            params["data_arrived_at"],
            params["searchable_verified_at"],
            params["arrival_to_searchable_ms"],
            params["probe_query_hash"],
            params["probe_status"],
            params["protocol"],
        )
    except Exception as exc:
        raise KpiSearchabilityWriteError(str(exc)) from exc

    if not check_id:
        raise KpiSearchabilityWriteError("KPI searchability check insert returned no id")
    return str(check_id)


async def write_kpi_searchability_check(payload: Mapping[str, Any]) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed
    from app.ai.kpi_write_injection import apply_kpi_write_injection_async

    if not kpi_writes_allowed("searchability"):
        return None
    await apply_kpi_write_injection_async("searchability")
    row = build_redacted_searchability_check(payload)
    return await insert_kpi_searchability_check_row(row)


InsertFn = Callable[[RedactedSearchabilityCheckRow], str]


def write_kpi_searchability_check_sync(
    payload: Mapping[str, Any],
    *,
    insert_fn: Optional[InsertFn] = None,
) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("searchability"):
        return None
    from app.ai.kpi_write_injection import apply_kpi_write_injection_sync

    apply_kpi_write_injection_sync("searchability")
    row = build_redacted_searchability_check(payload)
    if insert_fn is not None:
        return insert_fn(row)
    raise KpiSearchabilityWriteError(
        "sync KPI searchability write requires insert_fn; use write_kpi_searchability_check async API"
    )
