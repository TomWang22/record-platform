"""Phase 26A — KPI observability feature flags and no-op write guards (default off)."""
from __future__ import annotations

from typing import Any, Dict, Literal, Mapping, Optional

from app.ai.config import (
    AI_KPI_INGESTION_EVENTS_ENABLED,
    AI_KPI_OBSERVABILITY_ENABLED,
    AI_KPI_OBSERVABILITY_MASTER_DISABLE,
    AI_KPI_QUERY_OBSERVATIONS_ENABLED,
    AI_KPI_SEARCHABILITY_CHECKS_ENABLED,
    AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED,
)

KpiWriteChannel = Literal["ingestion", "searchability", "query", "usefulness"]

_CHANNEL_FLAGS: Dict[KpiWriteChannel, bool] = {
    "ingestion": AI_KPI_INGESTION_EVENTS_ENABLED,
    "searchability": AI_KPI_SEARCHABILITY_CHECKS_ENABLED,
    "query": AI_KPI_QUERY_OBSERVATIONS_ENABLED,
    "usefulness": AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED,
}


def kpi_writes_allowed(channel: KpiWriteChannel) -> bool:
    """Return True only when master disable is off and both global and channel flags are on."""
    if AI_KPI_OBSERVABILITY_MASTER_DISABLE:
        return False
    if not AI_KPI_OBSERVABILITY_ENABLED:
        return False
    return _CHANNEL_FLAGS[channel]


def kpi_observability_posture() -> Dict[str, Any]:
    """Read-only posture snapshot for tests and closeout docs."""
    return {
        "master_disable": AI_KPI_OBSERVABILITY_MASTER_DISABLE,
        "observability_enabled": AI_KPI_OBSERVABILITY_ENABLED,
        "ingestion_events_enabled": AI_KPI_INGESTION_EVENTS_ENABLED,
        "searchability_checks_enabled": AI_KPI_SEARCHABILITY_CHECKS_ENABLED,
        "query_observations_enabled": AI_KPI_QUERY_OBSERVATIONS_ENABLED,
        "usefulness_observations_enabled": AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED,
        "runtime_writes_enabled": any(kpi_writes_allowed(ch) for ch in _CHANNEL_FLAGS),
    }


def noop_write_kpi_ingestion_event(_payload: Mapping[str, Any]) -> Optional[str]:
    """No-op stub for Phase 26B; returns None when writes are disabled."""
    if not kpi_writes_allowed("ingestion"):
        return None
    raise NotImplementedError("KPI ingestion event writes are not implemented until Phase 26B")


def noop_write_kpi_searchability_check(_payload: Mapping[str, Any]) -> Optional[str]:
    if not kpi_writes_allowed("searchability"):
        return None
    raise NotImplementedError("KPI searchability writes are not implemented until Phase 26C")


def noop_write_kpi_query_observation(_payload: Mapping[str, Any]) -> Optional[str]:
    if not kpi_writes_allowed("query"):
        return None
    raise NotImplementedError("KPI query observation writes are not implemented until Phase 26D")


def noop_write_kpi_usefulness_observation(_payload: Mapping[str, Any]) -> Optional[str]:
    if not kpi_writes_allowed("usefulness"):
        return None
    raise NotImplementedError("KPI usefulness observation writes are not implemented until Phase 26E")
