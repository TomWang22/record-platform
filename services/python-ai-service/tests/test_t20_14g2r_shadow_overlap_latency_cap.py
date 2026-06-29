"""T20.14G2R — Shadow overlap fallback latency cap tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import retrieve_chunks_vector_shadow  # noqa: E402
from app.ai.shadow_profiles import (  # noqa: E402
    resolve_source_type_floor_plan,
    shadow_fallback_global_retry_limit,
)


def _row(row_id: str, source_type: str) -> Dict[str, Any]:
    return {
        "id": row_id,
        "document_id": row_id,
        "chunk_index": 0,
        "content": f"{source_type} body",
        "checksum": "x",
        "source_refs": [],
        "source_type": source_type,
        "source_id": row_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "source_updated_at": None,
        "title": "t",
        "metadata": {},
        "score": 0.9,
    }


def _keyword_chunk(chunk_id: str, *, source_type: str = "listing") -> Dict[str, Any]:
    return {
        "id": chunk_id,
        "document_id": chunk_id,
        "chunk_index": 0,
        "content": "safe listing excerpt",
        "checksum": "x",
        "source_refs": [],
        "source_type": source_type,
        "source_id": chunk_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "title": "t",
        "metadata": {},
        "score": 1.0,
    }


class TestG2RLatencyCaps(unittest.TestCase):
    def test_fallback_global_retry_limit_capped_at_four(self) -> None:
        self.assertEqual(shadow_fallback_global_retry_limit(8), 4)
        self.assertEqual(shadow_fallback_global_retry_limit(2), 2)

    def test_notification_floor_skips_broad_global(self) -> None:
        plan = resolve_source_type_floor_plan(
            "seller_sales_summary",
            query="What notifications matter most for my selling activity right now?",
            scope_by_type={"notification": 11, "obo_offer_summary": 18},
            pool_by_type={},
            primary_source_type="notification",
        )
        self.assertTrue(plan.skip_broad_global_retry)
        self.assertEqual(plan.global_retry_skip_reason, "obo_floor_satisfied")

    def test_anchor_first_skips_global_retry(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            return_value=[
                {"source_type": "listing", "cnt": 20},
                {"source_type": "obo_offer_summary", "cnt": 18},
            ]
        )
        fetch_mock = AsyncMock(return_value=[])
        keyword_chunks = [_keyword_chunk("kw-1"), _keyword_chunk("kw-2")]

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", fetch_mock):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="Summarize listing activity and buyer interest for my catalog this week.",
                        user_id="u1",
                        include_diagnostics=True,
                        keyword_chunks_for_overlap=keyword_chunks,
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertEqual(debug.get("zero_result_fallback_stage"), "keyword_anchor_first")
        self.assertTrue(debug.get("global_retry_skipped"))
        self.assertEqual(debug.get("global_retry_skip_reason"), "safe_keyword_anchors_available")
        self.assertTrue(debug.get("keyword_anchor_added"))
        self.assertTrue(debug.get("vector_only_zero_result"))
        self.assertTrue(debug.get("zero_result_fallback_applied"))
        self.assertIsNone(debug.get("global_retry_candidate_count"))

    def test_no_anchors_uses_capped_global_retry(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            return_value=[
                {"source_type": "listing", "cnt": 20},
            ]
        )
        limits: List[int] = []
        global_untyped_limits: List[int] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            limit = int(kwargs.get("limit") or 0)
            limits.append(limit)
            if kwargs.get("extra_source_type") is None:
                global_untyped_limits.append(limit)
                return [_row("global-1", "listing")]
            return []

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="catalog activity",
                        user_id="u1",
                        include_diagnostics=True,
                        keyword_chunks_for_overlap=[],
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertEqual(debug.get("zero_result_fallback_stage"), "global_untyped_retry")
        self.assertEqual(debug.get("global_retry_limit"), 4)
        self.assertTrue(debug.get("vector_only_zero_result"))
        self.assertTrue(any(limit <= 4 for limit in global_untyped_limits))

    def test_true_zero_preserved_when_no_anchors_and_global_empty(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(return_value=[{"source_type": "listing", "cnt": 20}])

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(return_value=[])):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="catalog activity",
                        user_id="u1",
                        include_diagnostics=True,
                        keyword_chunks_for_overlap=[],
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("true_zero_result_after_fallback"))
        self.assertTrue(debug.get("vector_only_zero_result"))
        self.assertEqual(debug.get("fallback_reason"), "not_exposed")


if __name__ == "__main__":
    unittest.main()
