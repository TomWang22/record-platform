"""Phase 32E — test/dev-only injectable KPI write delay/failure controls."""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_kpi_write_injection_failures = 0


class KpiWriteInjectionError(RuntimeError):
    """Injected KPI write failure for durability testing."""


@dataclass(frozen=True)
class KpiWriteInjectionConfig:
    delay_ms: int
    failure_rate: float
    timeout_ms: int
    db_unavailable: bool


def load_kpi_write_injection_config() -> KpiWriteInjectionConfig:
    return KpiWriteInjectionConfig(
        delay_ms=max(0, int(os.getenv("AI_KPI_TEST_INJECT_WRITE_DELAY_MS", "0"))),
        failure_rate=max(0.0, min(1.0, float(os.getenv("AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE", "0")))),
        timeout_ms=max(0, int(os.getenv("AI_KPI_TEST_INJECT_TIMEOUT_MS", "0"))),
        db_unavailable=os.getenv("AI_KPI_TEST_INJECT_DB_UNAVAILABLE", "0") == "1",
    )


def kpi_write_injection_active() -> bool:
    cfg = load_kpi_write_injection_config()
    return (
        cfg.delay_ms > 0
        or cfg.failure_rate > 0
        or cfg.timeout_ms > 0
        or cfg.db_unavailable
    )


def kpi_write_injection_failure_count() -> int:
    return _kpi_write_injection_failures


def _record_injection_failure(channel: str, reason: str) -> None:
    global _kpi_write_injection_failures
    _kpi_write_injection_failures += 1
    logger.warning("KPI write injection failure (%s): %s", channel, reason[:200])


def _should_fail(cfg: KpiWriteInjectionConfig) -> bool:
    if cfg.db_unavailable:
        return True
    if cfg.failure_rate <= 0:
        return False
    if cfg.failure_rate >= 1:
        return True
    return random.random() < cfg.failure_rate


def apply_kpi_write_injection_sync(channel: str) -> None:
    cfg = load_kpi_write_injection_config()
    if not (
        cfg.delay_ms > 0
        or cfg.failure_rate > 0
        or cfg.timeout_ms > 0
        or cfg.db_unavailable
    ):
        return
    if cfg.delay_ms > 0:
        time.sleep(cfg.delay_ms / 1000.0)
    if cfg.timeout_ms > 0:
        time.sleep(cfg.timeout_ms / 1000.0)
    if _should_fail(cfg):
        reason = "injected_db_unavailable" if cfg.db_unavailable else "injected_write_failure"
        _record_injection_failure(channel, reason)
        raise KpiWriteInjectionError(f"{reason} ({channel})")


async def apply_kpi_write_injection_async(channel: str) -> None:
    cfg = load_kpi_write_injection_config()
    if not (
        cfg.delay_ms > 0
        or cfg.failure_rate > 0
        or cfg.timeout_ms > 0
        or cfg.db_unavailable
    ):
        return
    if cfg.delay_ms > 0:
        await asyncio.sleep(cfg.delay_ms / 1000.0)
    if cfg.timeout_ms > 0:
        await asyncio.sleep(cfg.timeout_ms / 1000.0)
    if _should_fail(cfg):
        reason = "injected_db_unavailable" if cfg.db_unavailable else "injected_write_failure"
        _record_injection_failure(channel, reason)
        raise KpiWriteInjectionError(f"{reason} ({channel})")


def reset_kpi_write_injection_failure_count() -> None:
    global _kpi_write_injection_failures
    _kpi_write_injection_failures = 0
