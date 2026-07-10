"""Phase 26B — KPI ingestion event payload builder and DB insert (default-off gated)."""
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

REQUIRED_PAYLOAD_KEYS = frozenset({"ingestion_run_id", "source_type", "data_arrived_at"})

COUNTER_FIELDS = (
    "records_received",
    "records_indexed",
    "embedding_jobs_started",
    "embedding_jobs_completed",
    "embedding_jobs_failed",
    "index_upsert_success",
    "index_upsert_failed",
    "dead_letter_count",
    "retry_count",
)

NULLABLE_TIMESTAMP_FIELDS = (
    "normalized_at",
    "embedding_started_at",
    "embedding_completed_at",
    "index_upserted_at",
    "searchable_verified_at",
)

NULLABLE_DURATION_FIELDS = (
    "arrival_to_searchable_ms",
    "embedding_duration_ms",
    "index_upsert_duration_ms",
)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class KpiIngestionEventError(ValueError):
    """Invalid or forbidden ingestion KPI payload."""


class KpiIngestionWriteError(RuntimeError):
    """Ingestion KPI write failed (e.g. DB unavailable)."""


@dataclass(frozen=True)
class RedactedIngestionEventRow:
    ingestion_run_id: str
    source_type: str
    source_id_hash: Optional[str]
    data_arrived_at: datetime
    normalized_at: Optional[datetime]
    embedding_started_at: Optional[datetime]
    embedding_completed_at: Optional[datetime]
    index_upserted_at: Optional[datetime]
    searchable_verified_at: Optional[datetime]
    arrival_to_searchable_ms: Optional[int]
    embedding_duration_ms: Optional[int]
    index_upsert_duration_ms: Optional[int]
    records_received: int
    records_indexed: int
    embedding_jobs_started: int
    embedding_jobs_completed: int
    embedding_jobs_failed: int
    index_upsert_success: int
    index_upsert_failed: int
    dead_letter_count: int
    retry_count: int

    def as_db_params(self) -> Dict[str, Any]:
        return {
            "ingestion_run_id": self.ingestion_run_id,
            "source_type": self.source_type,
            "source_id_hash": self.source_id_hash,
            "data_arrived_at": self.data_arrived_at,
            "normalized_at": self.normalized_at,
            "embedding_started_at": self.embedding_started_at,
            "embedding_completed_at": self.embedding_completed_at,
            "index_upserted_at": self.index_upserted_at,
            "searchable_verified_at": self.searchable_verified_at,
            "arrival_to_searchable_ms": self.arrival_to_searchable_ms,
            "embedding_duration_ms": self.embedding_duration_ms,
            "index_upsert_duration_ms": self.index_upsert_duration_ms,
            "records_received": self.records_received,
            "records_indexed": self.records_indexed,
            "embedding_jobs_started": self.embedding_jobs_started,
            "embedding_jobs_completed": self.embedding_jobs_completed,
            "embedding_jobs_failed": self.embedding_jobs_failed,
            "index_upsert_success": self.index_upsert_success,
            "index_upsert_failed": self.index_upsert_failed,
            "dead_letter_count": self.dead_letter_count,
            "retry_count": self.retry_count,
        }


def hash_source_id(source_id: str) -> str:
    digest = hashlib.sha256(source_id.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _parse_timestamp(value: Union[str, datetime, None]) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    raise KpiIngestionEventError(f"unsupported timestamp type: {type(value).__name__}")


def _parse_required_timestamp(value: Union[str, datetime]) -> datetime:
    parsed = _parse_timestamp(value)
    if parsed is None:
        raise KpiIngestionEventError("data_arrived_at is required")
    return parsed


def _parse_optional_int(value: Any, field: str) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise KpiIngestionEventError(f"{field} must be an integer") from exc


def _parse_counter(value: Any, field: str) -> int:
    if value is None:
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise KpiIngestionEventError(f"{field} must be an integer") from exc
    if parsed < 0:
        raise KpiIngestionEventError(f"{field} must be non-negative")
    return parsed


def _resolve_source_id_hash(payload: Mapping[str, Any]) -> Optional[str]:
    if "source_id_hash" in payload:
        source_id_hash = payload.get("source_id_hash")
        if source_id_hash is None:
            return None
        if not isinstance(source_id_hash, str) or not source_id_hash.startswith("sha256:"):
            raise KpiIngestionEventError("source_id_hash must be a sha256: prefixed hash")
        return source_id_hash
    return None


def build_redacted_ingestion_event(payload: Mapping[str, Any]) -> RedactedIngestionEventRow:
    forbidden = FORBIDDEN_PAYLOAD_KEYS.intersection(payload.keys())
    if forbidden:
        raise KpiIngestionEventError(f"forbidden payload fields: {sorted(forbidden)}")

    missing = REQUIRED_PAYLOAD_KEYS.difference(payload.keys())
    if missing:
        raise KpiIngestionEventError(f"missing required payload fields: {sorted(missing)}")

    ingestion_run_id = str(payload["ingestion_run_id"])
    if not _UUID_RE.match(ingestion_run_id):
        raise KpiIngestionEventError("ingestion_run_id must be a UUID")

    source_type = str(payload["source_type"]).strip()
    if not source_type:
        raise KpiIngestionEventError("source_type is required")

    source_id_hash = _resolve_source_id_hash(payload)

    timestamps = {field: _parse_timestamp(payload.get(field)) for field in NULLABLE_TIMESTAMP_FIELDS}
    durations = {field: _parse_optional_int(payload.get(field), field) for field in NULLABLE_DURATION_FIELDS}
    counters = {field: _parse_counter(payload.get(field), field) for field in COUNTER_FIELDS}

    return RedactedIngestionEventRow(
        ingestion_run_id=ingestion_run_id,
        source_type=source_type,
        source_id_hash=source_id_hash,
        data_arrived_at=_parse_required_timestamp(payload["data_arrived_at"]),
        normalized_at=timestamps["normalized_at"],
        embedding_started_at=timestamps["embedding_started_at"],
        embedding_completed_at=timestamps["embedding_completed_at"],
        index_upserted_at=timestamps["index_upserted_at"],
        searchable_verified_at=timestamps["searchable_verified_at"],
        arrival_to_searchable_ms=durations["arrival_to_searchable_ms"],
        embedding_duration_ms=durations["embedding_duration_ms"],
        index_upsert_duration_ms=durations["index_upsert_duration_ms"],
        records_received=counters["records_received"],
        records_indexed=counters["records_indexed"],
        embedding_jobs_started=counters["embedding_jobs_started"],
        embedding_jobs_completed=counters["embedding_jobs_completed"],
        embedding_jobs_failed=counters["embedding_jobs_failed"],
        index_upsert_success=counters["index_upsert_success"],
        index_upsert_failed=counters["index_upsert_failed"],
        dead_letter_count=counters["dead_letter_count"],
        retry_count=counters["retry_count"],
    )


_INSERT_SQL = """
INSERT INTO ai.ai_kpi_ingestion_events (
  ingestion_run_id,
  source_type,
  source_id_hash,
  data_arrived_at,
  normalized_at,
  embedding_started_at,
  embedding_completed_at,
  index_upserted_at,
  searchable_verified_at,
  arrival_to_searchable_ms,
  embedding_duration_ms,
  index_upsert_duration_ms,
  records_received,
  records_indexed,
  embedding_jobs_started,
  embedding_jobs_completed,
  embedding_jobs_failed,
  index_upsert_success,
  index_upsert_failed,
  dead_letter_count,
  retry_count
) VALUES (
  $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, $11, $12,
  $13, $14, $15, $16, $17, $18, $19, $20, $21
)
RETURNING id::text
"""


async def insert_kpi_ingestion_event_row(row: RedactedIngestionEventRow) -> str:
    from app.db import get_pool

    pool = await get_pool()
    if not pool:
        raise KpiIngestionWriteError("python_ai DB unavailable for KPI ingestion event insert")

    params = row.as_db_params()
    try:
        event_id = await pool.fetchval(
            _INSERT_SQL,
            params["ingestion_run_id"],
            params["source_type"],
            params["source_id_hash"],
            params["data_arrived_at"],
            params["normalized_at"],
            params["embedding_started_at"],
            params["embedding_completed_at"],
            params["index_upserted_at"],
            params["searchable_verified_at"],
            params["arrival_to_searchable_ms"],
            params["embedding_duration_ms"],
            params["index_upsert_duration_ms"],
            params["records_received"],
            params["records_indexed"],
            params["embedding_jobs_started"],
            params["embedding_jobs_completed"],
            params["embedding_jobs_failed"],
            params["index_upsert_success"],
            params["index_upsert_failed"],
            params["dead_letter_count"],
            params["retry_count"],
        )
    except Exception as exc:
        raise KpiIngestionWriteError(str(exc)) from exc

    if not event_id:
        raise KpiIngestionWriteError("KPI ingestion event insert returned no id")
    return str(event_id)


async def write_kpi_ingestion_event(payload: Mapping[str, Any]) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed
    from app.ai.kpi_write_injection import apply_kpi_write_injection_async

    if not kpi_writes_allowed("ingestion"):
        return None
    await apply_kpi_write_injection_async("ingestion")
    row = build_redacted_ingestion_event(payload)
    return await insert_kpi_ingestion_event_row(row)


InsertFn = Callable[[RedactedIngestionEventRow], str]


def write_kpi_ingestion_event_sync(
    payload: Mapping[str, Any],
    *,
    insert_fn: Optional[InsertFn] = None,
) -> Optional[str]:
    from app.ai.kpi_observability import kpi_writes_allowed

    if not kpi_writes_allowed("ingestion"):
        return None
    from app.ai.kpi_write_injection import apply_kpi_write_injection_sync

    apply_kpi_write_injection_sync("ingestion")
    row = build_redacted_ingestion_event(payload)
    if insert_fn is not None:
        return insert_fn(row)
    raise KpiIngestionWriteError(
        "sync KPI ingestion write requires insert_fn; use write_kpi_ingestion_event async API"
    )
