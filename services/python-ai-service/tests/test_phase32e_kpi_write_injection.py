"""Phase 32E — KPI write injection tests."""
from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from app.ai.kpi_write_injection import (
    KpiWriteInjectionError,
    apply_kpi_write_injection_async,
    apply_kpi_write_injection_sync,
    kpi_write_injection_failure_count,
    reset_kpi_write_injection_failure_count,
)


class KpiWriteInjectionTests(unittest.TestCase):
    def tearDown(self) -> None:
        reset_kpi_write_injection_failure_count()
        for key in (
            "AI_KPI_TEST_INJECT_WRITE_DELAY_MS",
            "AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE",
            "AI_KPI_TEST_INJECT_TIMEOUT_MS",
            "AI_KPI_TEST_INJECT_DB_UNAVAILABLE",
        ):
            os.environ.pop(key, None)

    def test_defaults_are_inactive(self) -> None:
        asyncio.run(apply_kpi_write_injection_async("query"))

    def test_db_unavailable_raises(self) -> None:
        os.environ["AI_KPI_TEST_INJECT_DB_UNAVAILABLE"] = "1"
        with self.assertRaises(KpiWriteInjectionError):
            apply_kpi_write_injection_sync("query")
        self.assertEqual(kpi_write_injection_failure_count(), 1)

    def test_failure_rate_always_fails(self) -> None:
        os.environ["AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE"] = "1"
        with self.assertRaises(KpiWriteInjectionError):
            apply_kpi_write_injection_sync("usefulness")

    @patch("app.ai.kpi_write_injection.time.sleep")
    def test_delay_applied_sync(self, sleep_mock) -> None:
        os.environ["AI_KPI_TEST_INJECT_WRITE_DELAY_MS"] = "500"
        apply_kpi_write_injection_sync("query")
        sleep_mock.assert_called_once_with(0.5)


if __name__ == "__main__":
    unittest.main()
