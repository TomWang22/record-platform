"""Phase 26E — KPI usefulness observation instrumentation tests."""
from __future__ import annotations

import asyncio
import importlib
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

from app.ai.kpi_usefulness_observations import (
    KpiUsefulnessObservationError,
    KpiUsefulnessWriteError,
    RedactedUsefulnessObservationRow,
    build_redacted_usefulness_observation,
    build_usefulness_observation_payload,
    emit_usefulness_observation_safe,
    write_kpi_usefulness_observation,
    write_kpi_usefulness_observation_sync,
)

H1_LABEL = "H1 baseline 57105/57105"
H2_LABEL = "H2 replay 57105/57105"
H3_LABEL = "H3 replay 57105/57105"
SAMPLE_LABEL = "Phase 22C 7200/7200 sample only"


class Phase26eKpiUsefulnessTests(unittest.TestCase):
    OBSERVED_AT = "2026-07-08T03:00:00+00:00"

    def _base_payload(self, *, protocol: str = "HTTP/1.1", evidence_label: str = H1_LABEL) -> dict:
        return {
            "observed_at": self.OBSERVED_AT,
            "protocol": protocol,
            "case_id": "seller-intel-042",
            "workflow": "seller_intelligence",
            "response_pass": True,
            "sentiment_pass": True,
            "red_team_safety_pass": True,
            "leakage_failures": 0,
            "quality_score": 4.0,
            "evidence_label": evidence_label,
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

    def test_default_off_safe_emitter_does_not_insert(self) -> None:
        self._reload_kpi_modules({})
        import app.ai.kpi_observability as kpi_observability

        self.assertFalse(kpi_observability.kpi_writes_allowed("usefulness"))
        insert_mock = Mock()
        result = kpi_observability.noop_write_kpi_usefulness_observation(
            self._base_payload(),
            insert_fn=insert_mock,
        )
        self.assertIsNone(result)
        insert_mock.assert_not_called()

    def test_enabled_writer_inserts_redacted_payload(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        captured: list[RedactedUsefulnessObservationRow] = []

        def insert_fn(row: RedactedUsefulnessObservationRow) -> str:
            captured.append(row)
            return "usefulness-uuid"

        event_id = kpi_observability.noop_write_kpi_usefulness_observation(
            self._base_payload(),
            insert_fn=insert_fn,
        )
        self.assertEqual(event_id, "usefulness-uuid")
        self.assertEqual(len(captured), 1)
        row = captured[0]
        self.assertTrue(row.response_pass)
        self.assertEqual(row.evidence_label, H1_LABEL)

    def test_forbidden_fields_are_rejected(self) -> None:
        for forbidden in ("question", "prompt", "answer", "summary", "response_body", "jwt", "password"):
            with self.subTest(field=forbidden):
                with self.assertRaises(KpiUsefulnessObservationError):
                    build_redacted_usefulness_observation({**self._base_payload(), forbidden: "x"})

    def test_quality_score_validation(self) -> None:
        row = build_redacted_usefulness_observation({**self._base_payload(), "quality_score": 4.25})
        self.assertEqual(float(row.quality_score), 4.25)
        with self.assertRaises(KpiUsefulnessObservationError):
            build_redacted_usefulness_observation({**self._base_payload(), "quality_score": 6})
        row_null = build_redacted_usefulness_observation({**self._base_payload(), "quality_score": None})
        self.assertIsNone(row_null.quality_score)

    def test_leakage_failures_validation(self) -> None:
        row = build_redacted_usefulness_observation({**self._base_payload(), "leakage_failures": 2})
        self.assertEqual(row.leakage_failures, 2)
        with self.assertRaises(KpiUsefulnessObservationError):
            build_redacted_usefulness_observation({**self._base_payload(), "leakage_failures": -1})

    def test_http1_h1_label_payload(self) -> None:
        payload = build_usefulness_observation_payload(
            protocol="HTTP/1.1",
            response_pass=True,
            evidence_label=H1_LABEL,
        )
        row = build_redacted_usefulness_observation(payload)
        self.assertEqual(row.protocol, "HTTP/1.1")
        self.assertEqual(row.evidence_label, H1_LABEL)

    def test_http2_h2_label_payload(self) -> None:
        payload = build_usefulness_observation_payload(
            protocol="HTTP/2",
            response_pass=True,
            evidence_label=H2_LABEL,
        )
        row = build_redacted_usefulness_observation(payload)
        self.assertEqual(row.protocol, "HTTP/2")
        self.assertEqual(row.evidence_label, H2_LABEL)

    def test_http3_h3_label_payload(self) -> None:
        payload = build_usefulness_observation_payload(
            protocol="HTTP/3",
            response_pass=True,
            evidence_label=H3_LABEL,
        )
        row = build_redacted_usefulness_observation(payload)
        self.assertEqual(row.protocol, "HTTP/3")
        self.assertEqual(row.evidence_label, H3_LABEL)

    def test_sample_label_does_not_overwrite_full_replay_labels(self) -> None:
        h1 = build_redacted_usefulness_observation(self._base_payload(evidence_label=H1_LABEL))
        sample = build_redacted_usefulness_observation(
            self._base_payload(protocol="HTTP/1.1", evidence_label=SAMPLE_LABEL)
        )
        self.assertEqual(h1.evidence_label, H1_LABEL)
        self.assertEqual(sample.evidence_label, SAMPLE_LABEL)
        self.assertNotEqual(h1.evidence_label, sample.evidence_label)

    def test_unknown_protocol_payload(self) -> None:
        row = build_redacted_usefulness_observation({**self._base_payload(), "protocol": "unknown"})
        self.assertEqual(row.protocol, "unknown")

    def test_safe_emitter_catches_db_failure(self) -> None:
        self._reload_kpi_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
            }
        )

        async def run() -> str | None:
            with patch(
                "app.ai.kpi_usefulness_observations.write_kpi_usefulness_observation",
                new=AsyncMock(side_effect=KpiUsefulnessWriteError("db down")),
            ):
                return await emit_usefulness_observation_safe(self._base_payload())

        self.assertIsNone(asyncio.run(run()))

    def test_insert_payload_has_no_raw_response_fields(self) -> None:
        row = build_redacted_usefulness_observation(self._base_payload())
        params = row.as_db_params()
        forbidden = {
            "question",
            "prompt",
            "answer",
            "summary",
            "response",
            "response_body",
            "message_body",
            "jwt",
            "password",
        }
        self.assertTrue(forbidden.isdisjoint(set(params.keys())))

    def test_async_write_returns_none_when_disabled(self) -> None:
        self._reload_kpi_modules({})

        async def run() -> str | None:
            return await write_kpi_usefulness_observation(self._base_payload())

        self.assertIsNone(asyncio.run(run()))

    def test_observed_at_parsed_as_datetime(self) -> None:
        row = build_redacted_usefulness_observation(self._base_payload())
        self.assertEqual(row.observed_at, datetime(2026, 7, 8, 3, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
