"""T20.10AC — Shadow overlap refinement unit tests (flags default off)."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai import config as ai_config  # noqa: E402
from app.ai.rag_retrieval import (  # noqa: E402
    _apply_entity_hint_score_boost,
    _apply_shadow_overlap_refinements,
    _chunk_passes_privacy,
    _entity_overlap_count_in_rows,
    _expand_shadow_neighbor_rows,
    _fetch_listing_entity_hint_rows,
    _merge_vector_rows,
    extract_keyword_entity_hint_keys,
    listing_ids_from_entity_keys,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)


def _row(
    chunk_id: str,
    *,
    document_id: str = "doc-1",
    chunk_index: int = 0,
    source_type: str = "listing",
    source_id: str = "L1",
    score: float = 0.9,
    metadata: dict | None = None,
) -> dict:
    return {
        "id": chunk_id,
        "document_id": document_id,
        "chunk_index": chunk_index,
        "content": "seller listing activity",
        "checksum": "x",
        "source_refs": [],
        "source_type": source_type,
        "source_id": source_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "source_updated_at": None,
        "title": "t",
        "metadata": metadata or {"listing_id": "L1"},
        "score": score,
    }


class TestShadowOverlapRefinementFlags(unittest.TestCase):
    def test_flags_default_off(self) -> None:
        self.assertFalse(ai_config.AI_RAG_SHADOW_ENTITY_HINTS)
        self.assertFalse(ai_config.AI_RAG_SHADOW_NEIGHBOR_EXPANSION)


class TestEntityHintExtraction(unittest.TestCase):
    def test_entity_overlap_count_empty_keys(self) -> None:
        self.assertEqual(_entity_overlap_count_in_rows(set(), [_row("a")]), 0)

    def test_fetch_listing_entity_hint_rows_empty(self) -> None:
        async def run() -> None:
            rows = await _fetch_listing_entity_hint_rows(
                AsyncMock(),
                filters=[],
                scope_params=[],
                query_vec="[0.1]",
                listing_ids=[],
                limit=4,
            )
            self.assertEqual(rows, [])

        asyncio.run(run())

    def test_fetch_listing_entity_hint_rows_builds_query(self) -> None:
        async def run() -> None:
            conn = AsyncMock()
            conn.fetch = AsyncMock(return_value=[])
            rows = await _fetch_listing_entity_hint_rows(
                conn,
                filters=["d.owner_user_id = $1"],
                scope_params=["user-1"],
                query_vec="[0.1,0.2]",
                listing_ids=["L1"],
                limit=4,
            )
            self.assertEqual(rows, [])
            conn.fetch.assert_awaited_once()

        asyncio.run(run())

    def test_extracts_safe_metadata_only(self) -> None:
        keyword_chunks = [
            {
                "id": "k1",
                "source_type": "listing",
                "source_id": "L9",
                "metadata": {"listing_id": "L9", "offer_id": "O1"},
            },
            {
                "id": "k2",
                "source_type": "obo_offer_summary",
                "source_id": "O1",
                "metadata": {"obo_offer_id": "O1", "listing_id": "L9"},
            },
        ]
        keys = extract_keyword_entity_hint_keys(keyword_chunks)
        self.assertIn("listing_id:L9", keys)
        self.assertIn("offer_id:O1", keys)
        self.assertIn("obo_offer_id:O1", keys)
        self.assertIn("listing:L9", keys)

    def test_listing_ids_from_entity_keys_bounded(self) -> None:
        keys = {f"listing_id:L{i}" for i in range(10)}
        listing_ids = listing_ids_from_entity_keys(keys)
        self.assertEqual(len(listing_ids), 5)


class TestEntityHintScoreBoost(unittest.TestCase):
    def test_boost_only_matching_rows(self) -> None:
        rows = [
            _row("a", source_id="L1", metadata={"listing_id": "L1"}, score=1.0),
            _row("b", source_id="L2", metadata={"listing_id": "L2"}, score=1.0),
        ]
        boosted, count = _apply_entity_hint_score_boost(rows, {"listing_id:L1"})
        self.assertEqual(count, 1)
        self.assertAlmostEqual(boosted[0]["score"], 1.5, places=4)
        self.assertAlmostEqual(boosted[1]["score"], 1.0, places=4)

    def test_boost_is_deterministic(self) -> None:
        rows = [_row("a", score=0.8), _row("b", score=0.7)]
        first, _ = _apply_entity_hint_score_boost(rows, {"listing_id:L1"})
        second, _ = _apply_entity_hint_score_boost(rows, {"listing_id:L1"})
        self.assertEqual([r["score"] for r in first], [r["score"] for r in second])


class TestNeighborExpansion(unittest.TestCase):
    def test_neighbor_expansion_respects_caps_and_dedupes(self) -> None:
        raw_rows = [
            _row("top-1", document_id="doc-a", chunk_index=2, score=0.95),
            _row("top-2", document_id="doc-b", chunk_index=0, score=0.90),
        ]
        neighbor_a1 = _row("n-a1", document_id="doc-a", chunk_index=1, score=0.0)
        neighbor_a2 = _row("n-a2", document_id="doc-a", chunk_index=3, score=0.0)
        neighbor_dup = _row("top-1", document_id="doc-a", chunk_index=2, score=0.0)

        async def fake_fetch(conn, *, filters, params, document_id, anchor_chunk_index, per_doc_limit):
            if document_id == "doc-a":
                return [neighbor_dup, neighbor_a1, neighbor_a2]
            return [_row("n-b1", document_id="doc-b", chunk_index=1, score=0.0)]

        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._fetch_document_neighbor_rows",
                side_effect=fake_fetch,
            ):
                merged, diag = await _expand_shadow_neighbor_rows(
                    conn=None,
                    filters=[],
                    params=[],
                    raw_rows=raw_rows,
                    words=[],
                    pin_source=False,
                    query="listing",
                    per_doc_limit=2,
                    global_cap=6,
                    docs_considered=4,
                )
            merged_ids = [str(r["id"]) for r in merged]
            self.assertIn("n-a1", merged_ids)
            self.assertIn("n-a2", merged_ids)
            self.assertEqual(merged_ids.count("top-1"), 1)
            self.assertLessEqual(diag["neighbor_rows_added"], 6)

        asyncio.run(run())

    def test_privacy_filter_applies_to_neighbors(self) -> None:
        blocked = _row("blocked", document_id="doc-a", chunk_index=1, score=0.0)
        blocked["content"] = "proxy max pressure"

        async def fake_fetch(conn, *, filters, params, document_id, anchor_chunk_index, per_doc_limit):
            return [blocked]

        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._fetch_document_neighbor_rows",
                side_effect=fake_fetch,
            ):
                merged, diag = await _expand_shadow_neighbor_rows(
                    conn=None,
                    filters=[],
                    params=[],
                    raw_rows=[_row("top-1", document_id="doc-a", chunk_index=0)],
                    words=[],
                    pin_source=False,
                    query="listing",
                )
            self.assertEqual(diag["neighbor_rows_added"], 0)
            self.assertEqual(len(merged), 1)

        asyncio.run(run())


class TestShadowOverlapRefinementIntegration(unittest.TestCase):
    def test_default_flags_leave_refinement_inert(self) -> None:
        keyword_chunks = [{"id": "k1", "metadata": {"listing_id": "L1"}, "source_type": "listing", "source_id": "L1"}]
        raw_rows = [_row("s1")]

        async def run() -> None:
            merged, diag = await _apply_shadow_overlap_refinements(
                conn=None,
                raw_rows=raw_rows,
                keyword_chunks=keyword_chunks,
                filters=[],
                params=[],
                vec_param=1,
                query_vec=None,
                words=[],
                pin_source=False,
                query="listing",
            )
            self.assertEqual(merged, raw_rows)
            self.assertFalse(diag["entity_hints_enabled"])
            self.assertFalse(diag["neighbor_expansion_enabled"])

        asyncio.run(run())

    def test_entity_hints_flag_changes_only_flagged_diagnostics(self) -> None:
        keyword_chunks = [{"id": "k1", "metadata": {"listing_id": "L1"}, "source_type": "listing", "source_id": "L1"}]
        raw_rows = [_row("s1", metadata={"listing_id": "L2"}, score=0.5), _row("s2", metadata={"listing_id": "L1"}, score=0.4)]

        async def run() -> None:
            with patch("app.ai.rag_retrieval.AI_RAG_SHADOW_ENTITY_HINTS", True), patch(
                "app.ai.rag_retrieval.AI_RAG_SHADOW_NEIGHBOR_EXPANSION", False
            ), patch(
                "app.ai.rag_retrieval._fetch_listing_entity_hint_rows",
                new=AsyncMock(return_value=[]),
            ):
                merged, diag = await _apply_shadow_overlap_refinements(
                    conn=AsyncMock(),
                    raw_rows=list(raw_rows),
                    keyword_chunks=keyword_chunks,
                    filters=["1=1"],
                    params=["[0.1]"],
                    vec_param=1,
                    query_vec="[0.1]",
                    words=[],
                    pin_source=False,
                    query="listing",
                )
            self.assertTrue(diag["entity_hints_enabled"])
            self.assertGreaterEqual(diag["entity_boosted_rows"], 1)
            self.assertGreaterEqual(diag["entity_overlap_after"], diag["entity_overlap_before"])

        asyncio.run(run())

    def test_entity_listing_fetch_merges_hint_rows(self) -> None:
        keyword_chunks = [
            {"id": "k1", "metadata": {"listing_id": "L1"}, "source_type": "listing", "source_id": "L1"},
        ]
        raw_rows = [_row("s1", metadata={"listing_id": "L9"})]
        hint_row = _row("hint-1", metadata={"listing_id": "L1"})

        async def run() -> None:
            with patch("app.ai.rag_retrieval.AI_RAG_SHADOW_ENTITY_HINTS", True), patch(
                "app.ai.rag_retrieval.AI_RAG_SHADOW_NEIGHBOR_EXPANSION", False
            ), patch(
                "app.ai.rag_retrieval._fetch_listing_entity_hint_rows",
                new=AsyncMock(return_value=[hint_row]),
            ):
                merged, diag = await _apply_shadow_overlap_refinements(
                    conn=AsyncMock(),
                    raw_rows=list(raw_rows),
                    keyword_chunks=keyword_chunks,
                    filters=["1=1"],
                    params=["[0.1]"],
                    vec_param=1,
                    query_vec="[0.1]",
                    words=[],
                    pin_source=False,
                    query="listing",
                )
            merged_ids = {str(r["id"]) for r in merged}
            self.assertIn("hint-1", merged_ids)
            self.assertTrue(diag["entity_listing_fetch_run"])
            self.assertEqual(diag["entity_listing_fetch_rows"], 1)

        asyncio.run(run())

    def test_neighbor_expansion_adds_rows_when_flag_on(self) -> None:
        keyword_chunks = [{"id": "k1", "metadata": {"listing_id": "L1"}, "source_type": "listing", "source_id": "L1"}]
        raw_rows = [_row("top-1", document_id="doc-a", chunk_index=1)]
        neighbor = _row("neighbor-1", document_id="doc-a", chunk_index=2, score=0.0)

        async def run() -> None:
            with patch("app.ai.rag_retrieval.AI_RAG_SHADOW_ENTITY_HINTS", False), patch(
                "app.ai.rag_retrieval.AI_RAG_SHADOW_NEIGHBOR_EXPANSION", True
            ), patch(
                "app.ai.rag_retrieval._fetch_document_neighbor_rows",
                new=AsyncMock(return_value=[neighbor]),
            ):
                merged, diag = await _apply_shadow_overlap_refinements(
                    conn=AsyncMock(),
                    raw_rows=list(raw_rows),
                    keyword_chunks=keyword_chunks,
                    filters=["1=1"],
                    params=["[0.1]"],
                    vec_param=1,
                    query_vec="[0.1]",
                    words=[],
                    pin_source=False,
                    query="listing",
                )
            self.assertEqual(diag["neighbor_rows_added"], 1)
            self.assertEqual(len(merged), 2)

        asyncio.run(run())

    def test_retrieve_chunks_keyword_path_untouched(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)

    def test_no_shadow_vector_when_disabled(self) -> None:
        self.assertFalse(ai_config.AI_RAG_SHADOW_VECTOR)


class TestShadowOverlapRefinementVectorShadow(unittest.TestCase):
    def test_retrieve_vector_shadow_includes_overlap_diagnostics_when_flags_on(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            return_value=[
                {"source_type": "listing", "cnt": 20},
                {"source_type": "obo_offer_summary", "cnt": 8},
            ]
        )
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "source_id": "L1",
                "metadata": {"listing_id": "L1"},
                "content": "listing excerpt",
            }
        ]

        async def fake_fetch(*args: object, **kwargs: object) -> list[dict]:
            source_type = kwargs.get("extra_source_type")
            if source_type == "obo_offer_summary":
                return [_row("obo-1", source_type="obo_offer_summary", metadata={"listing_id": "L2"})]
            if source_type is None:
                return [_row("list-1", metadata={"listing_id": "L1"})]
            return [_row(f"{source_type}-1", source_type=str(source_type), metadata={"listing_id": "L1"})]

        async def run() -> dict:
            with patch("app.ai.rag_retrieval.AI_RAG_SHADOW_ENTITY_HINTS", True), patch(
                "app.ai.rag_retrieval.AI_RAG_SHADOW_NEIGHBOR_EXPANSION", True
            ), patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)), patch(
                "app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)
            ), patch(
                "app.ai.rag_retrieval._fetch_listing_entity_hint_rows",
                AsyncMock(return_value=[_row("hint-1", metadata={"listing_id": "L1"})]),
            ), patch(
                "app.ai.rag_retrieval._fetch_document_neighbor_rows",
                AsyncMock(return_value=[]),
            ):
                return await retrieve_chunks_vector_shadow(
                    conn,
                    query="owner OBO summary",
                    user_id="u1",
                    route_shadow_profile="obo_helper",
                    shadow_custom_query_hints=["obo", "owner_visible"],
                    include_diagnostics=True,
                    keyword_chunks_for_overlap=keyword_chunks,
                )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("entity_hints_enabled"))
        self.assertTrue(debug.get("neighbor_expansion_enabled"))
        self.assertTrue(debug.get("entity_listing_fetch_run"))

    def test_generic_shadow_path_applies_neighbor_flag(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(return_value=[])

        async def run() -> dict:
            with patch("app.ai.rag_retrieval.AI_RAG_SHADOW_NEIGHBOR_EXPANSION", True), patch(
                "app.ai.rag_retrieval.AI_RAG_SHADOW_ENTITY_HINTS", False
            ), patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)), patch(
                "app.ai.rag_retrieval._fetch_vector_rows",
                AsyncMock(return_value=[_row("g1")]),
            ), patch(
                "app.ai.rag_retrieval._fetch_document_neighbor_rows",
                AsyncMock(return_value=[]),
            ):
                return await retrieve_chunks_vector_shadow(
                    conn,
                    query="",
                    user_id="u1",
                    include_diagnostics=True,
                )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertTrue(debug.get("neighbor_expansion_enabled"))


if __name__ == "__main__":
    unittest.main()
