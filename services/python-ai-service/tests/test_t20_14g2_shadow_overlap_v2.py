"""T20.14G2 — Shadow overlap v2 fallback and keyword-anchor tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    _keyword_chunk_passes_anchor_privacy,
    _select_keyword_anchor_chunks,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import (  # noqa: E402
    SHADOW_KEYWORD_ANCHOR_MAX,
    resolve_source_type_floor_plan,
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


def _keyword_chunk(
    chunk_id: str,
    *,
    source_type: str = "listing",
    content: str = "listing body",
) -> Dict[str, Any]:
    return {
        "id": chunk_id,
        "document_id": chunk_id,
        "chunk_index": 0,
        "content": content,
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


class TestKeywordAnchorHelpers(unittest.TestCase):
    def test_keyword_anchors_capped_at_two(self) -> None:
        chunks = [_keyword_chunk(f"k{i}") for i in range(5)]
        anchors = _select_keyword_anchor_chunks(chunks, existing_ids=[])
        self.assertEqual(len(anchors), SHADOW_KEYWORD_ANCHOR_MAX)

    def test_keyword_anchors_reject_message_and_forbidden(self) -> None:
        self.assertFalse(
            _keyword_chunk_passes_anchor_privacy(
                _keyword_chunk("m1", source_type="message", content="hello")
            )
        )
        self.assertFalse(
            _keyword_chunk_passes_anchor_privacy(
                _keyword_chunk("m2", content="proxy_bids hidden")
            )
        )
        self.assertTrue(
            _keyword_chunk_passes_anchor_privacy(
                _keyword_chunk("ok", content="safe listing excerpt")
            )
        )


class TestSourceTypeFloor(unittest.TestCase):
    def test_notification_floor_allows_obo_evidence(self) -> None:
        plan = resolve_source_type_floor_plan(
            "seller_sales_summary",
            query="What notifications matter most for my selling activity right now?",
            scope_by_type={"notification": 11, "obo_offer_summary": 18},
            pool_by_type={},
            primary_source_type="notification",
        )
        self.assertTrue(plan.applied)
        self.assertIn("obo_offer_summary", plan.floor_types)
        self.assertTrue(plan.obo_as_notification_evidence)


class TestShadowZeroResultFallback(unittest.TestCase):
    def _conn(self) -> AsyncMock:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            return_value=[
                {"source_type": "listing", "cnt": 20},
                {"source_type": "obo_offer_summary", "cnt": 18},
            ]
        )
        return conn

    def test_global_retry_success(self) -> None:
        conn = self._conn()
        global_untyped_calls = 0

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            nonlocal global_untyped_calls
            source_type = kwargs.get("extra_source_type")
            if source_type is None:
                global_untyped_calls += 1
                return [_row("global-1", "listing")]
            return []

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="Summarize listing activity and buyer interest for my catalog this week.",
                        user_id="u1",
                        include_diagnostics=True,
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("zero_result_fallback_attempted"))
        self.assertTrue(debug.get("zero_result_fallback_succeeded"))
        self.assertEqual(debug.get("zero_result_fallback_stage"), "global_untyped_retry")
        self.assertEqual(debug.get("global_retry_limit"), 4)
        self.assertEqual(debug.get("zero_result_reason"), "zero_result_fallback_applied")
        self.assertGreater(result["candidate_count"], 0)
        self.assertGreaterEqual(global_untyped_calls, 1)

    def test_keyword_anchor_fallback_success(self) -> None:
        conn = self._conn()
        keyword_chunks = [_keyword_chunk("kw-1"), _keyword_chunk("kw-2"), _keyword_chunk("kw-3")]

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            return []

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="What notifications matter most for my selling activity right now?",
                        user_id="u1",
                        include_diagnostics=True,
                        keyword_chunks_for_overlap=keyword_chunks,
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("keyword_anchor_added"))
        self.assertEqual(debug.get("keyword_anchor_count"), 2)
        self.assertEqual(debug.get("zero_result_fallback_stage"), "keyword_anchor_first")
        self.assertTrue(debug.get("global_retry_skipped"))
        self.assertEqual(debug.get("zero_result_reason"), "zero_result_fallback_applied")
        self.assertEqual(result["candidate_count"], 2)
        self.assertTrue(all(chunk.get("keyword_anchor_added") for chunk in result["chunks"]))

    def test_fallback_still_empty_remains_true_zero(self) -> None:
        conn = self._conn()

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
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
        self.assertTrue(debug.get("true_zero_result_after_fallback"))
        self.assertEqual(debug.get("fallback_reason"), "not_exposed")
        self.assertEqual(debug.get("zero_result_reason"), "zero_result_after_fallback")
        self.assertEqual(result["candidate_count"], 0)

    def test_keyword_retrieval_unchanged(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)


if __name__ == "__main__":
    unittest.main()
