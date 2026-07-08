"""Phase 26B — KPI ingestion event instrumentation tests."""
from __future__ import annotations

import importlib
import asyncio
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

from app.ai.kpi_ingestion_events import (
    KpiIngestionEventError,
    KpiIngestionWriteError,
    RedactedIngestionEventRow,
    build_redacted_ingestion_event,
    hash_source_id,
    write_kpi_ingestion_event,
    write_kpi_ingestion_event_sync,
)


class Phase26bKpiIngestionTests(unittest.TestCase):
    RUN_ID = "b7e31209-1c53-49ef-931f-086b222cd60c"
    ARRIVED_AT = "2026-07-08T00:00:00+00:00"

    def _base_payload(self) -> dict:
        return {
            "ingestion_run_id": self.RUN_ID,
            "source_type": "listing",
            "data_arrived_at": self.ARRIVED_AT,
            "records_received": 10,
            "records_indexed": 9,
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

    def test_hash_source_id_prefix(self) -> None:
        hashed = hash_source_id("listing-123")
        self.assertTrue(hashed.startswith("sha256:"))
        self.assertNotIn("listing-123", hashed)

    def test_build_redacted_event_maps_counters_and_nullable_timestamps(self) -> None:
        row = build_redacted_ingestion_event(self._base_payload())
        self.assertEqual(row.source_type, "listing")
        self.assertEqual(row.records_received, 10)
        self.assertEqual(row.records_indexed, 9)
        self.assertIsNone(row.normalized_at)
        self.assertIsNone(row.arrival_to_searchable_ms)

    def test_build_redacted_event_accepts_prehashed_source_id(self) -> None:
        hashed = hash_source_id("secret-listing-id")
        row = build_redacted_ingestion_event(
            {**self._base_payload(), "source_id_hash": hashed}
        )
        self.assertEqual(row.source_id_hash, hashed)

    def test_build_redacted_event_rejects_forbidden_fields(self) -> None:
        for forbidden in ("source_id", "response_body", "jwt", "proxy_max_bid"):
            with self.subTest(field=forbidden):
                with self.assertRaises(KpiIngestionEventError):
                    build_redacted_ingestion_event({**self._base_payload(), forbidden: "x"})

    def test_default_flags_return_none_without_db_call(self) -> None:
        self._reload_kpi_modules({})
        import app.ai.kpi_observability as kpi_observability

        insert_mock = Mock()
        result = kpi_observability.noop_write_kpi_ingestion_event(
            self._base_payload(),
            insert_fn=insert_mock,
        )
        self.assertIsNone(result)
        insert_mock.assert_not_called()

    def test_enabled_ingestion_write_uses_insert_fn_only(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_INGESTION_EVENTS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        captured: list[RedactedIngestionEventRow] = []

        def insert_fn(row: RedactedIngestionEventRow) -> str:
            captured.append(row)
            return "event-uuid"

        payload = {
            **self._base_payload(),
            "source_id_hash": hash_source_id("listing-42"),
            "embedding_jobs_failed": 1,
        }
        event_id = kpi_observability.noop_write_kpi_ingestion_event(payload, insert_fn=insert_fn)
        self.assertEqual(event_id, "event-uuid")
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].embedding_jobs_failed, 1)
        self.assertNotIn("listing-42", captured[0].source_id_hash or "")

    def test_enabled_sync_write_without_insert_fn_raises_clear_error(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_INGESTION_EVENTS_ENABLED": "1",
            }
        )
        with self.assertRaises(KpiIngestionWriteError):
            write_kpi_ingestion_event_sync(self._base_payload())

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
            return await write_kpi_ingestion_event(self._base_payload())

        result = asyncio.run(run())
        self.assertIsNone(result)

    def test_row_db_params_use_redacted_fields_only(self) -> None:
        row = build_redacted_ingestion_event(
            {
                **self._base_payload(),
                "normalized_at": datetime(2026, 7, 8, 0, 0, 1, tzinfo=timezone.utc),
            }
        )
        params = row.as_db_params()
        self.assertIn("ingestion_run_id", params)
        self.assertNotIn("source_id", params)
        self.assertNotIn("response_body", params)


if __name__ == "__main__":
    unittest.main()
