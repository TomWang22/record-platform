"""Phase 26D — KPI query observation instrumentation tests."""
from __future__ import annotations

import asyncio
import importlib
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

from app.ai.kpi_query_observations import (
    KpiQueryObservationError,
    KpiQueryObservationWriteError,
    RedactedQueryObservationRow,
    build_redacted_query_observation,
    emit_rag_query_observation_safe,
    extract_query_observation_context,
    normalize_http_protocol,
    normalize_http_protocol_from_scope,
    write_kpi_query_observation,
    write_kpi_query_observation_sync,
)


class Phase26dKpiQueryObservationTests(unittest.TestCase):
    OBSERVED_AT = "2026-07-08T02:00:00+00:00"

    def _base_payload(self, *, protocol: str = "HTTP/1.1") -> dict:
        return {
            "observed_at": self.OBSERVED_AT,
            "protocol": protocol,
            "retrieval_mode": "keyword",
            "gate_reason": "keyword_default",
            "workflow": "rag_query",
            "rag_total_ms": 142,
            "keyword_retrieval_ms": 45,
            "hybrid_retrieval_ms": None,
            "fallback_count": 0,
            "canary_error_count": 0,
            "http_status": 200,
            "environment": "local",
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

    def test_normalize_http_protocol_offline_cases(self) -> None:
        self.assertEqual(normalize_http_protocol("1.1"), "HTTP/1.1")
        self.assertEqual(normalize_http_protocol("2"), "HTTP/2")
        self.assertEqual(normalize_http_protocol("3"), "HTTP/3")
        self.assertEqual(normalize_http_protocol(None), "unknown")
        self.assertEqual(normalize_http_protocol(""), "unknown")
        self.assertEqual(normalize_http_protocol("9"), "unknown")

    def test_normalize_http_protocol_from_scope_offline(self) -> None:
        self.assertEqual(
            normalize_http_protocol_from_scope({"http_version": "1.1"}),
            "HTTP/1.1",
        )
        self.assertEqual(
            normalize_http_protocol_from_scope({"http_version": "2"}),
            "HTTP/2",
        )
        self.assertEqual(
            normalize_http_protocol_from_scope({"http_version": "3"}),
            "HTTP/3",
        )
        self.assertEqual(normalize_http_protocol_from_scope({}), "unknown")
        self.assertEqual(normalize_http_protocol_from_scope(None), "unknown")

    def test_default_flags_block_query_writes(self) -> None:
        self._reload_kpi_modules({})
        import app.ai.kpi_observability as kpi_observability

        self.assertFalse(kpi_observability.kpi_writes_allowed("query"))
        insert_mock = Mock()
        result = kpi_observability.noop_write_kpi_query_observation(
            self._base_payload(),
            insert_fn=insert_mock,
        )
        self.assertIsNone(result)
        insert_mock.assert_not_called()
        self.assertFalse(kpi_observability.kpi_observability_posture()["runtime_writes_enabled"])

    def test_enabled_path_stores_protocol_and_metrics_for_all_http_versions(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        for protocol in ("HTTP/1.1", "HTTP/2", "HTTP/3"):
            with self.subTest(protocol=protocol):
                captured: list[RedactedQueryObservationRow] = []

                def insert_fn(row: RedactedQueryObservationRow) -> str:
                    captured.append(row)
                    return f"id-{protocol}"

                payload = {
                    **self._base_payload(protocol=protocol),
                    "fallback_count": 1,
                    "canary_error_count": 0,
                }
                event_id = kpi_observability.noop_write_kpi_query_observation(
                    payload,
                    insert_fn=insert_fn,
                )
                self.assertEqual(event_id, f"id-{protocol}")
                self.assertEqual(len(captured), 1)
                row = captured[0]
                self.assertEqual(row.protocol, protocol)
                self.assertEqual(row.retrieval_mode, "keyword")
                self.assertEqual(row.gate_reason, "keyword_default")
                self.assertEqual(row.rag_total_ms, 142)
                self.assertEqual(row.fallback_count, 1)
                self.assertEqual(row.http_status, 200)
                forbidden_attrs = (
                    "question",
                    "prompt",
                    "answer",
                    "summary",
                    "response_body",
                    "jwt",
                    "password",
                    "authorization_header",
                )
                for field in forbidden_attrs:
                    self.assertFalse(hasattr(row, field))

    def test_build_redacted_query_observation_rejects_forbidden_fields(self) -> None:
        for forbidden in ("question", "prompt", "answer", "summary", "response_body", "jwt", "password"):
            with self.subTest(field=forbidden):
                with self.assertRaises(KpiQueryObservationError):
                    build_redacted_query_observation({**self._base_payload(), forbidden: "x"})

    def test_extract_query_observation_context_uses_envelope_metrics_only(self) -> None:
        envelope = {
            "contract_id": "rag_query",
            "summary": "should not be stored",
            "details": {
                "retrieval_mode": "hybrid_canary",
                "hybrid_canary": {
                    "gate_reason": "allowlist",
                    "keyword_latency_ms": 40.2,
                    "hybrid_latency_ms": 88.7,
                    "hybrid_fallback": True,
                    "hybrid_error": "timeout",
                },
            },
        }
        payload = extract_query_observation_context(
            rag_envelope=envelope,
            rag_total_ms=200,
            protocol="HTTP/2",
        )
        self.assertEqual(payload["protocol"], "HTTP/2")
        self.assertEqual(payload["retrieval_mode"], "hybrid_canary")
        self.assertEqual(payload["gate_reason"], "allowlist")
        self.assertEqual(payload["rag_total_ms"], 200)
        self.assertEqual(payload["fallback_count"], 1)
        self.assertEqual(payload["canary_error_count"], 1)
        self.assertNotIn("summary", payload)
        self.assertNotIn("question", payload)

    def test_enabled_sync_write_without_insert_fn_raises_clear_error(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
            }
        )
        with self.assertRaises(KpiQueryObservationWriteError):
            write_kpi_query_observation_sync(self._base_payload())

    def test_async_write_returns_none_when_disabled(self) -> None:
        self._reload_kpi_modules({})

        async def run() -> str | None:
            return await write_kpi_query_observation(self._base_payload())

        result = asyncio.run(run())
        self.assertIsNone(result)

    def test_emit_rag_query_observation_safe_continues_on_write_failure(self) -> None:
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
                new=AsyncMock(side_effect=KpiQueryObservationWriteError("db down")),
            ):
                return await emit_rag_query_observation_safe(
                    http_scope={"http_version": "1.1"},
                    rag_envelope={"contract_id": "rag_query", "details": {}},
                    rag_total_ms=50,
                )

        result = asyncio.run(run())
        self.assertIsNone(result)

    def test_emit_rag_query_observation_safe_skips_when_disabled(self) -> None:
        self._reload_kpi_modules({})

        async def run() -> str | None:
            with patch(
                "app.ai.kpi_query_observations.write_kpi_query_observation",
                new=AsyncMock(return_value="should-not-run"),
            ) as write_mock:
                result = await emit_rag_query_observation_safe(
                    http_scope={"http_version": "2"},
                    rag_envelope={"contract_id": "rag_query", "details": {}},
                    rag_total_ms=50,
                )
                write_mock.assert_not_called()
                return result

        self.assertIsNone(asyncio.run(run()))

    def test_observed_at_parsed_as_datetime(self) -> None:
        row = build_redacted_query_observation(self._base_payload())
        self.assertEqual(row.observed_at, datetime(2026, 7, 8, 2, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
