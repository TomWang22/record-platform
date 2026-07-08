"""Phase 26C — KPI searchability check instrumentation tests."""
from __future__ import annotations

import importlib
import asyncio
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

from app.ai.kpi_searchability_checks import (
    KpiSearchabilityCheckError,
    KpiSearchabilityWriteError,
    RedactedSearchabilityCheckRow,
    build_redacted_searchability_check,
    hash_probe_query,
    hash_source_id,
    write_kpi_searchability_check,
    write_kpi_searchability_check_sync,
)


class Phase26cKpiSearchabilityTests(unittest.TestCase):
    RUN_ID = "b7e31209-1c53-49ef-931f-086b222cd60c"
    VERIFIED_AT = "2026-07-08T01:00:00+00:00"
    ARRIVED_AT = "2026-07-08T00:59:00+00:00"

    def _base_payload(self) -> dict:
        return {
            "source_type": "listing",
            "source_id_hash": hash_source_id("listing-42"),
            "searchable_verified_at": self.VERIFIED_AT,
            "arrival_to_searchable_ms": 60000,
            "probe_status": "PASS",
            "probe_query_hash": hash_probe_query("title: test listing"),
        }

    def _reload_kpi_modules(self, env: dict[str, str]) -> None:
        for key, value in env.items():
            os.environ[key] = value
        import app.ai.config as config
        import app.ai.kpi_observability as kpi_observability

        importlib.reload(config)
        importlib.reload(kpi_observability)

    def tearDown(self) -> None:
        for key in (
            "AI_KPI_OBSERVABILITY_ENABLED",
            "AI_KPI_INGESTION_EVENTS_ENABLED",
            "AI_KPI_SEARCHABILITY_CHECKS_ENABLED",
            "AI_KPI_QUERY_OBSERVATIONS_ENABLED",
            "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED",
            "AI_KPI_OBSERVABILITY_MASTER_DISABLE",
        ):
            os.environ.pop(key, None)
        import app.ai.config as config
        import app.ai.kpi_observability as kpi_observability

        importlib.reload(config)
        importlib.reload(kpi_observability)

    def test_hash_helpers_use_sha256_prefix(self) -> None:
        self.assertTrue(hash_source_id("x").startswith("sha256:"))
        self.assertTrue(hash_probe_query("q").startswith("sha256:"))

    def test_build_redacted_check_requires_hashed_fields(self) -> None:
        row = build_redacted_searchability_check(
            {**self._base_payload(), "ingestion_run_id": self.RUN_ID, "data_arrived_at": self.ARRIVED_AT}
        )
        self.assertEqual(row.probe_status, "PASS")
        self.assertEqual(row.arrival_to_searchable_ms, 60000)
        self.assertEqual(row.data_arrived_at, datetime(2026, 7, 8, 0, 59, tzinfo=timezone.utc))

    def test_build_redacted_check_rejects_forbidden_fields(self) -> None:
        for forbidden in ("probe_query", "source_id", "response_body", "jwt"):
            with self.subTest(field=forbidden):
                with self.assertRaises(KpiSearchabilityCheckError):
                    build_redacted_searchability_check({**self._base_payload(), forbidden: "x"})

    def test_default_flags_return_none_without_db_call(self) -> None:
        self._reload_kpi_modules({})
        import app.ai.kpi_observability as kpi_observability

        insert_mock = Mock()
        result = kpi_observability.noop_write_kpi_searchability_check(
            self._base_payload(),
            insert_fn=insert_mock,
        )
        self.assertIsNone(result)
        insert_mock.assert_not_called()

    def test_enabled_searchability_write_uses_insert_fn_only(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_SEARCHABILITY_CHECKS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        captured: list[RedactedSearchabilityCheckRow] = []

        def insert_fn(row: RedactedSearchabilityCheckRow) -> str:
            captured.append(row)
            return "check-uuid"

        event_id = kpi_observability.noop_write_kpi_searchability_check(
            self._base_payload(),
            insert_fn=insert_fn,
        )
        self.assertEqual(event_id, "check-uuid")
        self.assertEqual(len(captured), 1)
        self.assertTrue(captured[0].probe_query_hash.startswith("sha256:"))

    def test_enabled_sync_write_without_insert_fn_raises_clear_error(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_SEARCHABILITY_CHECKS_ENABLED": "1",
            }
        )
        with self.assertRaises(KpiSearchabilityWriteError):
            write_kpi_searchability_check_sync(self._base_payload())

    def test_usefulness_channel_remains_stubbed(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        with self.assertRaises(NotImplementedError):
            kpi_observability.noop_write_kpi_usefulness_observation({"response_pass": True})

    def test_async_write_returns_none_when_disabled(self) -> None:
        self._reload_kpi_modules({})

        async def run() -> str | None:
            return await write_kpi_searchability_check(self._base_payload())

        result = asyncio.run(run())
        self.assertIsNone(result)

    def test_nullable_data_arrived_at_preserved(self) -> None:
        row = build_redacted_searchability_check(self._base_payload())
        self.assertIsNone(row.data_arrived_at)


if __name__ == "__main__":
    unittest.main()
