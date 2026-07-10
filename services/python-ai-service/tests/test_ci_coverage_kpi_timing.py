"""CI coverage — KPI write injection, server timing, and async DB insert paths."""
from __future__ import annotations

import asyncio
import importlib
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.ai.kpi_ingestion_events import (
    KpiIngestionWriteError,
    insert_kpi_ingestion_event_row,
    write_kpi_ingestion_event,
)
from app.ai.kpi_searchability_checks import (
    KpiSearchabilityWriteError,
    RedactedSearchabilityCheckRow,
    insert_kpi_searchability_check_row,
    write_kpi_searchability_check,
    write_kpi_searchability_check_sync,
)
from app.ai.kpi_query_observations import (
    KpiQueryObservationWriteError,
    RedactedQueryObservationRow,
    emit_rag_query_observation_safe,
    insert_kpi_query_observation_row,
    write_kpi_query_observation,
    write_kpi_query_observation_sync,
)
from app.ai.kpi_usefulness_observations import (
    KpiUsefulnessWriteError,
    RedactedUsefulnessObservationRow,
    insert_kpi_usefulness_observation_row,
    write_kpi_usefulness_observation,
    write_kpi_usefulness_observation_sync,
)
from app.ai.kpi_write_injection import (
    KpiWriteInjectionError,
    apply_kpi_write_injection_async,
    apply_kpi_write_injection_sync,
    kpi_write_injection_active,
    load_kpi_write_injection_config,
    reset_kpi_write_injection_failure_count,
)
from app.ai.server_timing import (
    build_redacted_rag_timing_details,
    inject_redacted_rag_timing_details,
)
from app.ai import routes


class KpiWriteInjectionCoverageTests(unittest.TestCase):
    def tearDown(self) -> None:
        reset_kpi_write_injection_failure_count()
        for key in (
            "AI_KPI_TEST_INJECT_WRITE_DELAY_MS",
            "AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE",
            "AI_KPI_TEST_INJECT_TIMEOUT_MS",
            "AI_KPI_TEST_INJECT_DB_UNAVAILABLE",
        ):
            os.environ.pop(key, None)

    def test_load_config_clamps_failure_rate(self) -> None:
        os.environ["AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE"] = "9"
        cfg = load_kpi_write_injection_config()
        self.assertEqual(cfg.failure_rate, 1.0)

    def test_injection_active_detects_timeout(self) -> None:
        os.environ["AI_KPI_TEST_INJECT_TIMEOUT_MS"] = "100"
        self.assertTrue(kpi_write_injection_active())

    @patch("app.ai.kpi_write_injection.random.random", return_value=0.5)
    def test_partial_failure_rate_can_fail(self, _rand) -> None:
        os.environ["AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE"] = "0.6"
        with self.assertRaises(KpiWriteInjectionError):
            apply_kpi_write_injection_sync("query")

    @patch("app.ai.kpi_write_injection.asyncio.sleep", new_callable=AsyncMock)
    def test_async_timeout_and_failure(self, sleep_mock) -> None:
        os.environ["AI_KPI_TEST_INJECT_TIMEOUT_MS"] = "50"
        os.environ["AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE"] = "1"
        with self.assertRaises(KpiWriteInjectionError):
            asyncio.run(apply_kpi_write_injection_async("usefulness"))
        self.assertEqual(sleep_mock.await_count, 1)

    @patch("app.ai.kpi_write_injection.time.sleep")
    def test_sync_timeout_path(self, sleep_mock) -> None:
        os.environ["AI_KPI_TEST_INJECT_TIMEOUT_MS"] = "25"
        apply_kpi_write_injection_sync("ingestion")
        sleep_mock.assert_called_once_with(0.025)


class ServerTimingCoverageTests(unittest.TestCase):
    def test_keyword_only_retrieval_total(self) -> None:
        timing = build_redacted_rag_timing_details(
            {"details": {"hybrid_canary": {"keyword_latency_ms": 12.0}}},
            rag_total_ms=40,
        )
        self.assertEqual(timing["retrieval_total_ms"], 12.0)

    def test_hybrid_only_retrieval_total(self) -> None:
        timing = build_redacted_rag_timing_details(
            {"details": {"hybrid_canary": {"hybrid_latency_ms": 18.5}}},
            rag_total_ms=55,
        )
        self.assertEqual(timing["retrieval_total_ms"], 18.5)

    def test_negative_rag_total_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_redacted_rag_timing_details({"details": {}}, rag_total_ms=-1)

    def test_usefulness_write_ms_injected(self) -> None:
        envelope: dict = {"details": {}}
        inject_redacted_rag_timing_details(
            envelope,
            rag_total_ms=90,
            kpi_query_write_ms=3,
            kpi_usefulness_write_ms=5,
        )
        self.assertEqual(envelope["details"]["kpi_usefulness_write_ms"], 5)

    def test_server_timing_rejects_negative_kpi_write_ms(self) -> None:
        timing = build_redacted_rag_timing_details(
            {"details": {}},
            rag_total_ms=10,
            kpi_query_write_ms=-5,
        )
        self.assertEqual(timing["kpi_query_write_ms"], 0)


class KpiAsyncInsertCoverageTests(unittest.TestCase):
    OBSERVED_AT = "2026-07-08T02:00:00+00:00"

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

    def _query_row(self) -> RedactedQueryObservationRow:
        from datetime import datetime, timezone

        return RedactedQueryObservationRow(
            observed_at=datetime.fromisoformat(self.OBSERVED_AT),
            protocol="HTTP/3",
            retrieval_mode="keyword",
            gate_reason="keyword_default",
            case_id=None,
            workflow="rag_query",
            rag_total_ms=100,
            hybrid_retrieval_ms=None,
            keyword_retrieval_ms=40,
            fallback_count=0,
            canary_error_count=0,
            http_status=200,
            environment="ci",
        )

    def _usefulness_row(self) -> RedactedUsefulnessObservationRow:
        from datetime import datetime, timezone

        return RedactedUsefulnessObservationRow(
            observed_at=datetime.fromisoformat(self.OBSERVED_AT),
            protocol="HTTP/2",
            case_id="case-1",
            workflow="seller_intelligence",
            response_pass=True,
            sentiment_pass=True,
            red_team_safety_pass=True,
            leakage_failures=0,
            quality_score=4.0,
            evidence_label="H2 replay 57105/57105",
            environment="ci",
        )

    async def _run_query_insert_no_pool(self) -> None:
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            with self.assertRaises(KpiQueryObservationWriteError):
                await insert_kpi_query_observation_row(self._query_row())

    async def _run_query_insert_db_error(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(side_effect=RuntimeError("connection reset"))
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiQueryObservationWriteError):
                await insert_kpi_query_observation_row(self._query_row())

    async def _run_query_insert_empty_id(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=None)
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiQueryObservationWriteError):
                await insert_kpi_query_observation_row(self._query_row())

    async def _run_query_insert_success(self) -> str:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value="obs-123")
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            return await insert_kpi_query_observation_row(self._query_row())

    def test_query_insert_paths(self) -> None:
        asyncio.run(self._run_query_insert_no_pool())
        asyncio.run(self._run_query_insert_db_error())
        asyncio.run(self._run_query_insert_empty_id())
        self.assertEqual(asyncio.run(self._run_query_insert_success()), "obs-123")

    async def _run_usefulness_insert_no_pool(self) -> None:
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            with self.assertRaises(KpiUsefulnessWriteError):
                await insert_kpi_usefulness_observation_row(self._usefulness_row())

    async def _run_usefulness_insert_success(self) -> str:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value="use-456")
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            return await insert_kpi_usefulness_observation_row(self._usefulness_row())

    async def _run_usefulness_insert_db_error(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(side_effect=RuntimeError("db reset"))
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiUsefulnessWriteError):
                await insert_kpi_usefulness_observation_row(self._usefulness_row())

    async def _run_usefulness_insert_empty_id(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=None)
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiUsefulnessWriteError):
                await insert_kpi_usefulness_observation_row(self._usefulness_row())

    def test_usefulness_insert_paths(self) -> None:
        asyncio.run(self._run_usefulness_insert_no_pool())
        asyncio.run(self._run_usefulness_insert_db_error())
        asyncio.run(self._run_usefulness_insert_empty_id())
        self.assertEqual(asyncio.run(self._run_usefulness_insert_success()), "use-456")

    async def _run_ingestion_insert_no_pool(self) -> None:
        from app.ai.kpi_ingestion_events import RedactedIngestionEventRow
        from datetime import datetime, timezone

        row = RedactedIngestionEventRow(
            ingestion_run_id="00000000-0000-4000-8000-000000000001",
            source_type="listing",
            source_id_hash="sha256:abc",
            data_arrived_at=datetime.now(timezone.utc),
            normalized_at=None,
            embedding_started_at=None,
            embedding_completed_at=None,
            index_upserted_at=None,
            searchable_verified_at=None,
            arrival_to_searchable_ms=None,
            embedding_duration_ms=None,
            index_upsert_duration_ms=None,
            records_received=1,
            records_indexed=1,
            embedding_jobs_started=0,
            embedding_jobs_completed=0,
            embedding_jobs_failed=0,
            index_upsert_success=0,
            index_upsert_failed=0,
            dead_letter_count=0,
            retry_count=0,
        )
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            with self.assertRaises(KpiIngestionWriteError):
                await insert_kpi_ingestion_event_row(row)

    def test_ingestion_insert_no_pool(self) -> None:
        asyncio.run(self._run_ingestion_insert_no_pool())

    def test_enabled_async_writes_with_mocked_insert(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
                "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
                "AI_KPI_INGESTION_EVENTS_ENABLED": "1",
            }
        )

        query_payload = {
            "observed_at": self.OBSERVED_AT,
            "protocol": "HTTP/3",
            "retrieval_mode": "keyword",
            "rag_total_ms": 80,
            "environment": "ci",
        }
        usefulness_payload = {
            "observed_at": self.OBSERVED_AT,
            "protocol": "HTTP/1.1",
            "case_id": "c1",
            "workflow": "rag_query",
            "response_pass": True,
            "sentiment_pass": True,
            "red_team_safety_pass": True,
            "leakage_failures": 0,
            "quality_score": 3.5,
            "evidence_label": "H1 baseline 57105/57105",
            "environment": "ci",
        }
        ingestion_payload = {
            "ingestion_run_id": "00000000-0000-4000-8000-000000000099",
            "source_type": "listing",
            "data_arrived_at": self.OBSERVED_AT,
            "records_received": 2,
            "records_indexed": 2,
        }

        async def run() -> None:
            with patch(
                "app.ai.kpi_query_observations.insert_kpi_query_observation_row",
                new=AsyncMock(return_value="q-id"),
            ):
                qid = await write_kpi_query_observation(query_payload)
                self.assertEqual(qid, "q-id")
            with patch(
                "app.ai.kpi_usefulness_observations.insert_kpi_usefulness_observation_row",
                new=AsyncMock(return_value="u-id"),
            ):
                uid = await write_kpi_usefulness_observation(usefulness_payload)
                self.assertEqual(uid, "u-id")
            with patch(
                "app.ai.kpi_ingestion_events.insert_kpi_ingestion_event_row",
                new=AsyncMock(return_value="i-id"),
            ):
                iid = await write_kpi_ingestion_event(ingestion_payload)
                self.assertEqual(iid, "i-id")

        asyncio.run(run())

    def test_sync_writes_with_insert_fn(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
                "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
            }
        )
        query_payload = {
            "observed_at": self.OBSERVED_AT,
            "protocol": "HTTP/2",
            "retrieval_mode": "keyword",
            "rag_total_ms": 70,
            "environment": "ci",
        }
        usefulness_payload = {
            "observed_at": self.OBSERVED_AT,
            "protocol": "HTTP/3",
            "case_id": "c2",
            "workflow": "rag_query",
            "response_pass": True,
            "sentiment_pass": True,
            "red_team_safety_pass": True,
            "leakage_failures": 0,
            "quality_score": 4.0,
            "evidence_label": "H3 replay 57105/57105",
            "environment": "ci",
        }
        qid = write_kpi_query_observation_sync(
            query_payload,
            insert_fn=lambda row: "sync-q",
        )
        uid = write_kpi_usefulness_observation_sync(
            usefulness_payload,
            insert_fn=lambda row: "sync-u",
        )
        self.assertEqual(qid, "sync-q")
        self.assertEqual(uid, "sync-u")

    def test_emit_rag_query_observation_safe_skips_on_injection_error(self) -> None:
        from app.ai.kpi_write_injection import KpiWriteInjectionError

        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
            }
        )

        async def run() -> str | None:
            with patch(
                "app.ai.kpi_query_observations.write_kpi_query_observation",
                new=AsyncMock(side_effect=KpiWriteInjectionError("injected")),
            ):
                return await emit_rag_query_observation_safe(
                    http_scope={"http_version": "3"},
                    rag_envelope={"contract_id": "rag_query", "details": {}},
                    rag_total_ms=42,
                )

        self.assertIsNone(asyncio.run(run()))


class RoutesHelperCoverageTests(unittest.TestCase):
    def test_parse_custom_query_hints(self) -> None:
        self.assertIsNone(routes._parse_custom_query_hints(None))
        self.assertIsNone(routes._parse_custom_query_hints("   "))
        self.assertEqual(routes._parse_custom_query_hints("obo, owner_visible"), ["obo", "owner_visible"])

    def test_user_id_header_and_body(self) -> None:
        self.assertIsNone(routes._user_id(None, None))
        self.assertIsNone(routes._user_id("null", "None"))
        self.assertEqual(routes._user_id(" hdr ", "body"), "hdr")


class SearchabilityInsertCoverageTests(unittest.TestCase):
    RUN_ID = "00000000-0000-4000-8000-000000000010"
    VERIFIED_AT = "2026-07-08T01:00:00+00:00"
    ARRIVED_AT = "2026-07-08T00:59:00+00:00"

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

    def _row(self) -> RedactedSearchabilityCheckRow:
        from datetime import datetime, timezone
        from app.ai.kpi_searchability_checks import hash_probe_query, hash_source_id

        return RedactedSearchabilityCheckRow(
            ingestion_run_id=self.RUN_ID,
            source_type="listing",
            source_id_hash=hash_source_id("listing-1"),
            data_arrived_at=datetime.fromisoformat(self.ARRIVED_AT),
            searchable_verified_at=datetime.fromisoformat(self.VERIFIED_AT),
            arrival_to_searchable_ms=1000,
            probe_query_hash=hash_probe_query("probe"),
            probe_status="PASS",
            protocol="HTTP/3",
        )

    async def _run_insert_no_pool(self) -> None:
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            with self.assertRaises(KpiSearchabilityWriteError):
                await insert_kpi_searchability_check_row(self._row())

    async def _run_insert_success(self) -> str:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value="search-1")
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            return await insert_kpi_searchability_check_row(self._row())

    def test_searchability_insert_paths(self) -> None:
        asyncio.run(self._run_insert_no_pool())
        self.assertEqual(asyncio.run(self._run_insert_success()), "search-1")

    async def _run_insert_db_error(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(side_effect=RuntimeError("db"))
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiSearchabilityWriteError):
                await insert_kpi_searchability_check_row(self._row())

    def test_searchability_insert_db_error(self) -> None:
        asyncio.run(self._run_insert_db_error())

    async def _run_insert_empty_id(self) -> None:
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=None)
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiSearchabilityWriteError):
                await insert_kpi_searchability_check_row(self._row())

    def test_searchability_insert_empty_id(self) -> None:
        asyncio.run(self._run_insert_empty_id())

    def test_searchability_enabled_async_and_sync(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_SEARCHABILITY_CHECKS_ENABLED": "1",
            }
        )
        from app.ai.kpi_searchability_checks import hash_probe_query, hash_source_id

        payload = {
            "ingestion_run_id": self.RUN_ID,
            "source_type": "listing",
            "source_id_hash": hash_source_id("listing-2"),
            "data_arrived_at": self.ARRIVED_AT,
            "searchable_verified_at": self.VERIFIED_AT,
            "arrival_to_searchable_ms": 500,
            "probe_status": "PASS",
            "probe_query_hash": hash_probe_query("title: x"),
            "protocol": "HTTP/2",
        }

        async def run() -> None:
            with patch(
                "app.ai.kpi_searchability_checks.insert_kpi_searchability_check_row",
                new=AsyncMock(return_value="async-search"),
            ):
                check_id = await write_kpi_searchability_check(payload)
                self.assertEqual(check_id, "async-search")

        asyncio.run(run())
        sync_id = write_kpi_searchability_check_sync(payload, insert_fn=lambda row: "sync-search")
        self.assertEqual(sync_id, "sync-search")


class KpiIngestionParseCoverageTests(unittest.TestCase):
    def test_timestamp_and_counter_validation(self) -> None:
        from app.ai.kpi_ingestion_events import (
            KpiIngestionEventError,
            _parse_counter,
            _parse_optional_int,
            _parse_required_timestamp,
            _parse_timestamp,
            build_redacted_ingestion_event,
        )

        self.assertIsNone(_parse_timestamp(None))
        with self.assertRaises(KpiIngestionEventError):
            _parse_timestamp(123)
        with self.assertRaises(KpiIngestionEventError):
            _parse_required_timestamp(None)
        with self.assertRaises(KpiIngestionEventError):
            _parse_optional_int("x", "retry_count")
        with self.assertRaises(KpiIngestionEventError):
            _parse_counter(-1, "records_received")
        row = build_redacted_ingestion_event(
            {
                "ingestion_run_id": "00000000-0000-4000-8000-000000000020",
                "source_type": "listing",
                "data_arrived_at": "2026-07-08T00:00:00+00:00",
                "records_received": 1,
                "records_indexed": 1,
                "retry_count": 2,
            }
        )
        self.assertEqual(row.retry_count, 2)

    async def _run_ingestion_insert_success(self) -> str:
        from datetime import datetime, timezone
        from app.ai.kpi_ingestion_events import RedactedIngestionEventRow

        row = RedactedIngestionEventRow(
            ingestion_run_id="00000000-0000-4000-8000-000000000021",
            source_type="listing",
            source_id_hash="sha256:def",
            data_arrived_at=datetime.now(timezone.utc),
            normalized_at=None,
            embedding_started_at=None,
            embedding_completed_at=None,
            index_upserted_at=None,
            searchable_verified_at=None,
            arrival_to_searchable_ms=None,
            embedding_duration_ms=None,
            index_upsert_duration_ms=None,
            records_received=1,
            records_indexed=1,
            embedding_jobs_started=0,
            embedding_jobs_completed=0,
            embedding_jobs_failed=0,
            index_upsert_success=0,
            index_upsert_failed=0,
            dead_letter_count=0,
            retry_count=0,
        )
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value="ingest-1")
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            return await insert_kpi_ingestion_event_row(row)

    def test_ingestion_insert_success(self) -> None:
        self.assertEqual(asyncio.run(self._run_ingestion_insert_success()), "ingest-1")

    async def _run_ingestion_insert_db_error(self) -> None:
        from datetime import datetime, timezone
        from app.ai.kpi_ingestion_events import RedactedIngestionEventRow

        row = RedactedIngestionEventRow(
            ingestion_run_id="00000000-0000-4000-8000-000000000022",
            source_type="listing",
            source_id_hash="sha256:ghi",
            data_arrived_at=datetime.now(timezone.utc),
            normalized_at=None,
            embedding_started_at=None,
            embedding_completed_at=None,
            index_upserted_at=None,
            searchable_verified_at=None,
            arrival_to_searchable_ms=None,
            embedding_duration_ms=None,
            index_upsert_duration_ms=None,
            records_received=1,
            records_indexed=1,
            embedding_jobs_started=0,
            embedding_jobs_completed=0,
            embedding_jobs_failed=0,
            index_upsert_success=0,
            index_upsert_failed=0,
            dead_letter_count=0,
            retry_count=0,
        )
        pool = MagicMock()
        pool.fetchval = AsyncMock(side_effect=RuntimeError("insert failed"))
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiIngestionWriteError):
                await insert_kpi_ingestion_event_row(row)

    def test_ingestion_insert_db_error(self) -> None:
        asyncio.run(self._run_ingestion_insert_db_error())

    async def _run_ingestion_insert_empty_id(self) -> None:
        from datetime import datetime, timezone
        from app.ai.kpi_ingestion_events import RedactedIngestionEventRow

        row = RedactedIngestionEventRow(
            ingestion_run_id="00000000-0000-4000-8000-000000000023",
            source_type="listing",
            source_id_hash="sha256:jkl",
            data_arrived_at=datetime.now(timezone.utc),
            normalized_at=None,
            embedding_started_at=None,
            embedding_completed_at=None,
            index_upserted_at=None,
            searchable_verified_at=None,
            arrival_to_searchable_ms=None,
            embedding_duration_ms=None,
            index_upsert_duration_ms=None,
            records_received=1,
            records_indexed=1,
            embedding_jobs_started=0,
            embedding_jobs_completed=0,
            embedding_jobs_failed=0,
            index_upsert_success=0,
            index_upsert_failed=0,
            dead_letter_count=0,
            retry_count=0,
        )
        pool = MagicMock()
        pool.fetchval = AsyncMock(return_value=None)
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            with self.assertRaises(KpiIngestionWriteError):
                await insert_kpi_ingestion_event_row(row)

    def test_ingestion_insert_empty_id(self) -> None:
        asyncio.run(self._run_ingestion_insert_empty_id())


class RagEntityKeyCoverageTests(unittest.TestCase):
    def test_entity_keys_from_source_refs_and_content(self) -> None:
        from app.ai.rag_retrieval import (
            _entity_keys_for_chunk,
            _entity_keys_from_safe_content,
            _entity_keys_from_source_refs,
        )

        refs = _entity_keys_from_source_refs(
            {
                "source_refs": [
                    {"source_type": "listing", "source_id": "L1"},
                    "bad",
                    {"source_type": "message", "source_id": "M1"},
                ]
            }
        )
        self.assertIn("listing:L1", refs)
        self.assertIn("listing_id:L1", refs)
        content_keys = _entity_keys_from_safe_content(
            {
                "source_type": "listing",
                "content": "see listing 550e8400-e29b-41d4-a716-446655440000",
            }
        )
        self.assertTrue(any(k.startswith("listing_uuid:") for k in content_keys))
        self.assertEqual(_entity_keys_from_safe_content({"source_type": "message", "content": "hi"}), set())
        merged = _entity_keys_for_chunk(
            {
                "source_refs": [{"source_type": "listing", "source_id": "L2"}],
                "source_type": "listing",
                "content": "",
            }
        )
        self.assertIn("listing:L2", merged)


class OutboxCoverageTests(unittest.TestCase):
    def test_kafka_producer_disabled_when_ssl_off(self) -> None:
        from app.ai.outbox import _kafka_producer

        async def run() -> None:
            with patch.dict(os.environ, {"KAFKA_USE_SSL": "false"}, clear=False):
                self.assertIsNone(await _kafka_producer())

        asyncio.run(run())

    def test_kafka_producer_disabled_when_publisher_off(self) -> None:
        from app.ai.outbox import _kafka_producer

        async def run() -> None:
            with patch.dict(os.environ, {"PYTHON_AI_OUTBOX_PUBLISHER": "0"}, clear=False):
                self.assertIsNone(await _kafka_producer())

        asyncio.run(run())

    def test_publish_outbox_tick_with_mock_producer(self) -> None:
        from app.ai.outbox import publish_python_ai_outbox_tick

        conn = MagicMock()
        conn.fetch = AsyncMock(
            return_value=[
                {"id": "evt-1", "aggregate_id": "listing-1", "payload": b'{"x":1}'},
            ]
        )
        conn.execute = AsyncMock()
        producer = MagicMock()
        producer.start = AsyncMock()
        producer.stop = AsyncMock()
        producer.send_and_wait = AsyncMock()

        async def run() -> int:
            with patch("app.ai.outbox._kafka_producer", new=AsyncMock(return_value=producer)):
                return await publish_python_ai_outbox_tick(conn, limit=5)

        self.assertEqual(asyncio.run(run()), 1)


class KpiObservabilityCoverageTests(unittest.TestCase):
    def test_observability_disabled_blocks_writes(self) -> None:
        for key in (
            "AI_KPI_OBSERVABILITY_ENABLED",
            "AI_KPI_INGESTION_EVENTS_ENABLED",
            "AI_KPI_SEARCHABILITY_CHECKS_ENABLED",
            "AI_KPI_QUERY_OBSERVATIONS_ENABLED",
            "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED",
            "AI_KPI_OBSERVABILITY_MASTER_DISABLE",
        ):
            os.environ.pop(key, None)
        os.environ["AI_KPI_OBSERVABILITY_MASTER_DISABLE"] = "0"
        os.environ["AI_KPI_OBSERVABILITY_ENABLED"] = "0"
        import app.ai.config as config
        import app.ai.kpi_observability as kpi_observability

        importlib.reload(config)
        importlib.reload(kpi_observability)
        self.assertFalse(kpi_observability.kpi_writes_allowed("query"))

    def test_observability_enabled_without_channel_flag(self) -> None:
        for key in (
            "AI_KPI_OBSERVABILITY_ENABLED",
            "AI_KPI_INGESTION_EVENTS_ENABLED",
            "AI_KPI_SEARCHABILITY_CHECKS_ENABLED",
            "AI_KPI_QUERY_OBSERVATIONS_ENABLED",
            "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED",
            "AI_KPI_OBSERVABILITY_MASTER_DISABLE",
        ):
            os.environ.pop(key, None)
        os.environ["AI_KPI_OBSERVABILITY_MASTER_DISABLE"] = "0"
        os.environ["AI_KPI_OBSERVABILITY_ENABLED"] = "1"
        import app.ai.config as config
        import app.ai.kpi_observability as kpi_observability

        importlib.reload(config)
        importlib.reload(kpi_observability)
        self.assertFalse(kpi_observability.kpi_writes_allowed("ingestion"))


class PreviewEnrollmentCoverageTests(unittest.TestCase):
    USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    def tearDown(self) -> None:
        import app.ai.preview_enrollment as preview_enrollment

        preview_enrollment._ddl_applied = False

    def test_preview_enrollment_paths_with_mock_pool(self) -> None:
        from datetime import datetime, timezone
        import app.ai.preview_enrollment as preview_enrollment

        enrolled_at = datetime.now(timezone.utc)
        row = {
            "user_id": self.USER_ID,
            "owner_user_id": self.USER_ID,
            "enrolled_at": enrolled_at,
            "enrolled_by": self.USER_ID,
            "revoked_at": None,
            "source": "owner_opt_in",
        }
        pool = MagicMock()
        pool.execute = AsyncMock(return_value="UPDATE 1")
        pool.fetchrow = AsyncMock(return_value=row)

        async def run() -> None:
            with patch("app.ai.preview_enrollment.get_pool", new=AsyncMock(return_value=pool)):
                self.assertTrue(await preview_enrollment.ensure_enrollment_table())
                enrollment = await preview_enrollment.get_enrollment(self.USER_ID)
                assert enrollment is not None
                self.assertTrue(enrollment.active)
                self.assertTrue(await preview_enrollment.is_preview_enrolled(self.USER_ID))
                enrolled = await preview_enrollment.enroll_user(self.USER_ID)
                self.assertTrue(enrolled["ok"])
                revoked = await preview_enrollment.revoke_user(self.USER_ID)
                self.assertTrue(revoked["ok"])
                count = await preview_enrollment.revoke_all_active()
                self.assertGreaterEqual(count, 0)
                status = await preview_enrollment.preview_status_payload(self.USER_ID)
                self.assertIn("gate_reason", status)

        asyncio.run(run())

    def test_preview_enrollment_invalid_and_unauthenticated(self) -> None:
        import app.ai.preview_enrollment as preview_enrollment

        async def run() -> None:
            self.assertEqual((await preview_enrollment.enroll_user(None))["error"], "invalid_user_id")
            status = await preview_enrollment.preview_status_payload(None)
            self.assertEqual(status["error"], "authentication_required")

        asyncio.run(run())

    def test_preview_enrollment_db_unavailable(self) -> None:
        import app.ai.preview_enrollment as preview_enrollment

        async def run() -> None:
            with patch("app.ai.preview_enrollment.get_pool", new=AsyncMock(return_value=None)):
                preview_enrollment._ddl_applied = False
                self.assertFalse(await preview_enrollment.ensure_enrollment_table())
                self.assertEqual(
                    (await preview_enrollment.enroll_user(self.USER_ID))["error"],
                    "python_ai_db_unavailable",
                )

        asyncio.run(run())


class KpiUsefulnessParseCoverageTests(unittest.TestCase):
    def test_usefulness_parse_helpers(self) -> None:
        from datetime import datetime, timezone
        from decimal import Decimal
        from app.ai.kpi_usefulness_observations import (
            KpiUsefulnessObservationError,
            _normalize_protocol,
            _parse_bool,
            _parse_optional_bool,
            _parse_quality_score,
            _parse_required_int,
            _parse_timestamp,
            _validate_evidence_label,
            build_usefulness_observation_payload,
        )

        self.assertTrue(_parse_bool(True, "response_pass"))
        with self.assertRaises(KpiUsefulnessObservationError):
            _parse_bool("yes", "response_pass")
        self.assertIsNone(_parse_optional_bool(None, "sentiment_pass"))
        with self.assertRaises(KpiUsefulnessObservationError):
            _parse_required_int(None, "leakage_failures")
        with self.assertRaises(KpiUsefulnessObservationError):
            _parse_quality_score("not-a-number")
        self.assertEqual(_parse_quality_score("4.2"), Decimal("4.20"))
        self.assertEqual(_normalize_protocol("HTTP/3"), "HTTP/3")
        self.assertEqual(_normalize_protocol("3"), "HTTP/3")
        self.assertIsNone(_validate_evidence_label(""))
        self.assertIsInstance(_parse_timestamp(datetime.now(timezone.utc)), datetime)
        payload = build_usefulness_observation_payload(
            protocol="HTTP/2",
            response_pass=True,
            evidence_label="H2 replay 57105/57105",
            quality_score=3.5,
        )
        self.assertEqual(payload["protocol"], "HTTP/2")


class RagSynthesisIntentCoverageTests(unittest.TestCase):
    def test_classify_rag_intent_variants(self) -> None:
        from app.ai.rag_synthesis import classify_rag_intent, _coerce_chunk_metadata

        self.assertEqual(
            classify_rag_intent("Give me a 10-bullet seller plan tagged [grounded]"),
            "tagged_executive_summary",
        )
        self.assertEqual(
            classify_rag_intent("health check on weak listings and buyer interest"),
            "listing_advice",
        )
        self.assertEqual(
            classify_rag_intent("auction pressure and thin demand bid risk"),
            "auction_pressure",
        )
        self.assertEqual(
            classify_rag_intent("accept, counter, or review this offer negotiation logic"),
            "negotiation_strategy",
        )
        self.assertEqual(
            classify_rag_intent("raise / hold / review pricing for this listing"),
            "pricing_plan",
        )
        self.assertEqual(
            classify_rag_intent("re-rank stale inventory rare jazz underselling"),
            "seller_tradeoff",
        )
        self.assertEqual(
            classify_rag_intent("what notification selling activity right now matter most"),
            "seller_notifications",
        )
        self.assertEqual(
            classify_rag_intent("draft a better collector-facing listing title and description pick one listing"),
            "listing_rewrite",
        )
        self.assertEqual(
            classify_rag_intent("30 minutes prioritized action list for seller"),
            "prioritized_action_plan",
        )
        self.assertEqual(
            classify_rag_intent("what can i infer about buyer negotiation posture"),
            "buyer_psychology_cautious",
        )
        self.assertEqual(
            classify_rag_intent("pressing provenance collector condition scarcity seller notes"),
            "collector_metadata_gaps",
        )
        self.assertEqual(classify_rag_intent("random question"), "generic_grounded")
        self.assertEqual(_coerce_chunk_metadata('{"a": 1}'), {"a": 1})
        self.assertEqual(_coerce_chunk_metadata(None), {})
        self.assertEqual(_coerce_chunk_metadata("{not-json"), {})
        self.assertEqual(_coerce_chunk_metadata(["bad"]), {})


class HybridCanaryCoverageTests(unittest.TestCase):
    def test_hybrid_canary_helpers(self) -> None:
        from app.ai.hybrid_canary import (
            HybridCanaryGate,
            in_percentage_cohort,
            normalize_user_id,
            percentage_bucket,
            refine_hybrid_fallback_reason,
            resolve_hybrid_retrieval_plan,
        )

        self.assertIsNone(normalize_user_id("null"))
        self.assertIsNone(normalize_user_id("not-a-uuid"))
        plan = resolve_hybrid_retrieval_plan("10-bullet tagged [grounded] seller plan")
        self.assertTrue(plan.query_expanded)
        plain = resolve_hybrid_retrieval_plan("simple question")
        self.assertFalse(plain.query_expanded)
        self.assertEqual(
            refine_hybrid_fallback_reason(
                prompt_class="final_tagged_plan",
                generic_reason="true_zero_result",
            ),
            "final_tagged_plan_insufficient_hybrid_evidence",
        )
        uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        bucket = percentage_bucket(uid)
        self.assertGreaterEqual(bucket, 0)
        self.assertLess(bucket, 100)
        self.assertIsInstance(in_percentage_cohort(uid, 50), bool)
        gate = HybridCanaryGate(
            canary_enabled=True,
            canary_allowed=True,
            gate_reason="preview_opt_in",
            user_allowlisted=False,
            percentage=0,
            percentage_bucket=1,
            percentage_cohort=False,
            require_keyword_fallback=True,
            log_pure_vector=False,
            anchor_max=3,
        )
        self.assertTrue(gate.active)

    def test_hybrid_chunk_helpers_and_failure_reasons(self) -> None:
        from app.ai.hybrid_canary import (
            HybridCanaryGate,
            chunks_to_source_refs,
            hybrid_chunks_from_shadow,
            hybrid_failure_reason,
            _source_types,
        )

        chunks = [
            {"source_type": "listing", "source_id": "L1", "checksum": "a"},
            {"source_type": "listing", "source_id": "L1", "checksum": "b"},
            {"source_type": "record", "source_id": "R1"},
        ]
        self.assertEqual(_source_types(chunks), ["listing", "record"])
        refs = chunks_to_source_refs(chunks)
        self.assertEqual(len(refs), 2)
        shadow_chunks = hybrid_chunks_from_shadow({"chunks": chunks})
        self.assertEqual(len(shadow_chunks), 3)
        gate = HybridCanaryGate(
            canary_enabled=True,
            canary_allowed=False,
            gate_reason="prod_percent_blocked",
            user_allowlisted=False,
            percentage=50,
            percentage_bucket=10,
            percentage_cohort=False,
            require_keyword_fallback=True,
            log_pure_vector=False,
            anchor_max=3,
        )
        self.assertEqual(
            hybrid_failure_reason(gate=gate, shadow=None),
            "prod_percent_blocked",
        )

    def test_percentage_cohort_gate_when_enabled(self) -> None:
        import os
        from importlib import reload
        import app.ai.config as cfg
        import app.ai.hybrid_canary as hc

        uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_PERCENT": "100",
                "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT": "1",
                "KUBERNETES_NAMESPACE": "dev",
            },
            clear=False,
        ):
            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate(uid, preview_enrolled=False)
        self.assertTrue(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "percentage")

    def test_hybrid_failure_reason_branches(self) -> None:
        from app.ai.hybrid_canary import HybridCanaryGate, hybrid_failure_reason, hybrid_succeeded

        disabled = HybridCanaryGate(
            canary_enabled=False,
            canary_allowed=False,
            gate_reason="keyword_default",
            user_allowlisted=False,
            percentage=0,
            percentage_bucket=None,
            percentage_cohort=False,
            require_keyword_fallback=True,
            log_pure_vector=False,
            anchor_max=3,
        )
        self.assertEqual(hybrid_failure_reason(gate=disabled, shadow={}), "canary_disabled")
        allowed = HybridCanaryGate(
            canary_enabled=True,
            canary_allowed=True,
            gate_reason="percentage",
            user_allowlisted=False,
            percentage=100,
            percentage_bucket=1,
            percentage_cohort=True,
            require_keyword_fallback=True,
            log_pure_vector=False,
            anchor_max=3,
        )
        self.assertEqual(
            hybrid_failure_reason(gate=allowed, shadow=None, hybrid_error="boom"),
            "hybrid_exception",
        )
        self.assertEqual(
            hybrid_failure_reason(gate=allowed, shadow={"status": "embed_timed_out"}),
            "embed_timeout",
        )
        self.assertFalse(hybrid_succeeded(gate=allowed, shadow={"status": "embed_timed_out"}))
        self.assertEqual(
            hybrid_failure_reason(gate=allowed, shadow={"status": "failed"}),
            "hybrid_status_failed",
        )
        self.assertEqual(
            hybrid_failure_reason(
                gate=allowed,
                shadow={"status": "ok", "shadow_diagnostics": {"debug": {"true_zero_result_after_fallback": True}}},
            ),
            "true_zero_result",
        )
        self.assertEqual(
            hybrid_failure_reason(gate=allowed, shadow={"status": "ok", "chunks": []}),
            "empty_hybrid_chunks",
        )


class KpiSearchabilityParseCoverageTests(unittest.TestCase):
    def test_searchability_parse_errors(self) -> None:
        from app.ai.kpi_searchability_checks import (
            KpiSearchabilityCheckError,
            _parse_required_int,
            _parse_required_timestamp,
            _parse_timestamp,
        )

        with self.assertRaises(KpiSearchabilityCheckError):
            _parse_timestamp(42)
        with self.assertRaises(KpiSearchabilityCheckError):
            _parse_required_timestamp(None)
        with self.assertRaises(KpiSearchabilityCheckError):
            _parse_required_int(-1, "arrival_to_searchable_ms")

    def test_hybrid_canary_prod_percent_blocked(self) -> None:
        import os
        from importlib import reload
        import app.ai.config as cfg
        import app.ai.hybrid_canary as hc

        uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_PERCENT": "50",
                "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT": "0",
                "KUBERNETES_NAMESPACE": "record-platform",
            },
            clear=False,
        ):
            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate(uid, preview_enrolled=False)
        self.assertEqual(gate.gate_reason, "prod_percent_blocked")


class ProviderRegistryCoverageTests(unittest.TestCase):
    def test_get_provider_variants(self) -> None:
        from app.ai.providers.registry import get_provider
        from app.ai.providers.transformer import HuggingFaceProvider, PyTorchProvider, TensorFlowProvider

        self.assertEqual(get_provider("hf"), HuggingFaceProvider)
        self.assertEqual(get_provider("pytorch"), PyTorchProvider)
        self.assertEqual(get_provider("tf"), TensorFlowProvider)

    def test_resolve_model_used_for_transformer_provider(self) -> None:
        from app.ai.providers.registry import resolve_model_used
        from app.ai.providers.transformer import HuggingFaceProvider

        with patch.object(HuggingFaceProvider, "status", AsyncMock(return_value={"available": True})):
            with patch("app.ai.providers.registry.get_provider", return_value=HuggingFaceProvider):
                model, reason = asyncio.run(resolve_model_used())
        self.assertEqual(model, HuggingFaceProvider.name)
        self.assertIsNone(reason)

    def test_resolve_model_used_when_transformer_unavailable(self) -> None:
        from app.ai.providers.registry import resolve_model_used
        from app.ai.providers.transformer import PyTorchProvider

        with patch.object(PyTorchProvider, "status", AsyncMock(return_value={"available": False, "reason": "no_gpu"})):
            with patch("app.ai.providers.registry.get_provider", return_value=PyTorchProvider):
                model, reason = asyncio.run(resolve_model_used())
        self.assertEqual(model, "none")
        self.assertEqual(reason, "no_gpu")


if __name__ == "__main__":
    unittest.main()
