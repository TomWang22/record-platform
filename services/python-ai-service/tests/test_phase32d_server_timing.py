"""Phase 32D — server timing metadata tests."""
from __future__ import annotations

import unittest

from app.ai.server_timing import (
    build_redacted_rag_timing_details,
    inject_redacted_rag_timing_details,
)


class ServerTimingTests(unittest.TestCase):
    def test_build_redacted_rag_timing_details(self) -> None:
        envelope = {
            "details": {
                "hybrid_canary": {
                    "keyword_latency_ms": 12.5,
                    "hybrid_latency_ms": 33.2,
                }
            }
        }
        timing = build_redacted_rag_timing_details(
            envelope,
            rag_total_ms=120,
            kpi_query_write_ms=4,
        )
        self.assertEqual(timing["rag_total_ms"], 120)
        self.assertEqual(timing["server_total_ms"], 120)
        self.assertEqual(timing["retrieval_total_ms"], 45.7)
        self.assertEqual(timing["kpi_query_write_ms"], 4)
        self.assertNotIn("question", timing)
        self.assertNotIn("summary", timing)

    def test_inject_redacted_rag_timing_details(self) -> None:
        envelope = {"details": {"retrieval_mode": "hybrid_canary"}}
        inject_redacted_rag_timing_details(envelope, rag_total_ms=88, kpi_query_write_ms=2)
        self.assertEqual(envelope["details"]["rag_total_ms"], 88)
        self.assertEqual(envelope["details"]["server_total_ms"], 88)
        self.assertEqual(envelope["details"]["kpi_query_write_ms"], 2)


if __name__ == "__main__":
    unittest.main()
