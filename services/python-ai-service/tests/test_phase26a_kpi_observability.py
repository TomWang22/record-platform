"""Phase 26A — KPI observability schema flags and no-op write guards."""
from __future__ import annotations

import importlib
import os
import unittest


class Phase26aKpiObservabilityTests(unittest.TestCase):
    def _reload_modules(self, env: dict[str, str]) -> None:
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

    def test_default_flags_block_all_writes(self) -> None:
        self._reload_modules({})
        import app.ai.kpi_observability as kpi_observability

        posture = kpi_observability.kpi_observability_posture()
        self.assertTrue(posture["master_disable"])
        self.assertFalse(posture["observability_enabled"])
        self.assertFalse(posture["runtime_writes_enabled"])
        self.assertIsNone(kpi_observability.noop_write_kpi_ingestion_event({}))
        self.assertIsNone(kpi_observability.noop_write_kpi_query_observation({}))

    def test_master_disable_blocks_even_when_flags_on(self) -> None:
        self._reload_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "1",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_INGESTION_EVENTS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        self.assertFalse(kpi_observability.kpi_writes_allowed("ingestion"))

    def test_channel_flag_required_when_master_off(self) -> None:
        self._reload_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_INGESTION_EVENTS_ENABLED": "0",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        self.assertFalse(kpi_observability.kpi_writes_allowed("ingestion"))

    def test_enabled_channel_raises_not_implemented_in_phase26a(self) -> None:
        self._reload_modules(
            {
                "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
                "AI_KPI_OBSERVABILITY_ENABLED": "1",
                "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
            }
        )
        import app.ai.kpi_observability as kpi_observability

        self.assertTrue(kpi_observability.kpi_writes_allowed("query"))
        with self.assertRaises(NotImplementedError):
            kpi_observability.noop_write_kpi_query_observation({"rag_total_ms": 1})


if __name__ == "__main__":
    unittest.main()
