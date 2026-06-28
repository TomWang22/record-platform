"""T20.14D — Shadow embed stability and fetch-trim tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    _collect_route_mode_shadow_rows,
    _shadow_embed_query,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import shadow_global_fetch_limit  # noqa: E402


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


class TestShadowEmbedRetry(unittest.TestCase):
    def test_shadow_embed_timeout_retry_success_fetch_proceeds(self) -> None:
        vec = [0.01] * 768
        call = AsyncMock(side_effect=[httpx.TimeoutException("timeout"), vec])

        async def run() -> None:
            with patch("app.ai.rag_retrieval._call_ollama_embed", call):
                result_vec, meta = await _shadow_embed_query(
                    "owner OBO summary",
                    original_query_length=17,
                    profile_hints_enabled=False,
                    hint_terms_count=0,
                    hint_expansion_truncated=False,
                    use_cache=False,
                )
            self.assertEqual(result_vec, vec)
            self.assertTrue(meta.embed_retry_attempted)
            self.assertTrue(meta.embed_retry_succeeded)
            self.assertFalse(meta.embed_timeout_before_fetch)
            self.assertFalse(meta.timed_out)
            self.assertEqual(call.await_count, 2)

        asyncio.run(run())

    def test_shadow_embed_timeout_retry_failure_classified(self) -> None:
        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._call_ollama_embed",
                AsyncMock(side_effect=httpx.TimeoutException("timeout")),
            ):
                result = await retrieve_chunks_vector_shadow(
                    AsyncMock(fetchval=AsyncMock(return_value=10)),
                    query="owner OBO summary",
                    user_id="u1",
                    include_diagnostics=True,
                )
            self.assertEqual(result["status"], "embed_timed_out")
            self.assertTrue(result.get("embed_timeout_before_fetch"))
            sd = result["shadow_diagnostics"]
            self.assertTrue(sd["embed"]["embed_retry_attempted"])
            self.assertFalse(sd["embed"]["embed_retry_succeeded"])
            self.assertTrue(sd["embed"]["embed_timeout_before_fetch"])
            self.assertFalse(sd["debug"]["shadow_fetch_attempted"])
            self.assertEqual(sd["debug"]["zero_result_reason"], "embed_timeout_before_fetch")
            self.assertEqual(result["chunks"], [])

        asyncio.run(run())

    def test_keyword_retrieval_unchanged(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)


class TestShadowFetchTrim(unittest.TestCase):
    def test_shadow_global_fetch_limit_is_two_x_max_chunks(self) -> None:
        self.assertEqual(shadow_global_fetch_limit(8), 16)

    def test_global_fetch_uses_trimmed_limit(self) -> None:
        fetch_limits: List[int] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            limit = kwargs.get("limit")
            source_type = kwargs.get("extra_source_type")
            if limit is not None and source_type is None:
                fetch_limits.append(limit)
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-1", source_type)]

        conn = AsyncMock()
        scope = {
            "obo_offer_summary": 18,
            "listing": 20,
            "listing_revision": 5,
            "notification": 6,
        }

        async def run() -> None:
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                await _collect_route_mode_shadow_rows(
                    conn,
                    filters=["c.embedding_vec IS NOT NULL"],
                    params=[],
                    vec_param=1,
                    resolved_profile="obo_helper",
                    shadow_custom_query_hints=["obo"],
                    query="offer underfill",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            self.assertTrue(fetch_limits)
            self.assertEqual(fetch_limits[0], shadow_global_fetch_limit(8))

        asyncio.run(run())

    def test_shadow_fetch_attempted_on_success(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            return_value=[
                {"source_type": "obo_offer_summary", "cnt": 18},
                {"source_type": "listing", "cnt": 20},
            ]
        )

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-1", source_type)]

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="owner OBO summary",
                        user_id="u1",
                        route_shadow_profile="obo_helper",
                        shadow_custom_query_hints=["obo", "owner_visible"],
                        include_diagnostics=True,
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("shadow_fetch_attempted"))
        self.assertGreater(result["candidate_count"], 0)


if __name__ == "__main__":
    unittest.main()
