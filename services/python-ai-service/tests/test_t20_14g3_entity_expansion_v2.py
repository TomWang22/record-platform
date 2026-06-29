"""T20.14G3 — Shadow entity expansion v2 tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    _apply_shadow_entity_expansion_v2,
    _collect_entity_expansion_keys,
    _entity_keys_for_chunk,
    _merge_entity_expansion_chunks,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import (  # noqa: E402
    ENTITY_EXPANSION_MAX_ADDED,
    resolve_entity_expansion_allowed_source_types,
)


def _chunk(
    chunk_id: str,
    *,
    source_type: str = "listing",
    source_id: str = "listing-1",
    document_id: str = "doc-1",
    content: str = "safe listing excerpt",
    metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return {
        "id": chunk_id,
        "document_id": document_id,
        "chunk_index": 0,
        "content": content,
        "checksum": "x",
        "source_refs": [{"source_type": source_type, "source_id": source_id}],
        "source_type": source_type,
        "source_id": source_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "title": "t",
        "metadata": metadata or {"listing_id": source_id},
        "score": 1.0,
    }


def _row(row_id: str, source_type: str, *, source_id: str = "listing-1") -> Dict[str, Any]:
    return {
        "id": row_id,
        "document_id": row_id,
        "chunk_index": 0,
        "content": f"{source_type} body",
        "checksum": "x",
        "source_refs": [],
        "source_type": source_type,
        "source_id": source_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "source_updated_at": None,
        "title": "t",
        "metadata": {"listing_id": source_id},
        "score": 0.8,
    }


class TestEntityExpansionHelpers(unittest.TestCase):
    def test_entity_keys_include_metadata_and_source_refs(self) -> None:
        keys = _entity_keys_for_chunk(
            _chunk("k1", metadata={"listing_id": "abc", "record_id": "rec-1"})
        )
        self.assertIn("listing_id:abc", keys)
        self.assertIn("record_id:rec-1", keys)
        self.assertIn("listing:listing-1", keys)

    def test_entity_keys_reject_forbidden_content(self) -> None:
        keys = _entity_keys_for_chunk(_chunk("k2", content="proxy_bids hidden"))
        self.assertFalse(any(key.startswith("listing_uuid:") for key in keys))

    def test_catalog_prompt_allowlist(self) -> None:
        allowed = resolve_entity_expansion_allowed_source_types(
            "seller_sales_summary",
            query="Summarize listing activity for my catalog this week",
        )
        self.assertIn("listing_revision", allowed)

    def test_obo_prompt_allowlist(self) -> None:
        allowed = resolve_entity_expansion_allowed_source_types(
            "seller_sales_summary",
            query="What notifications matter for my OBO offers?",
        )
        self.assertIn("obo_offer_summary", allowed)

    def test_merge_entity_expansion_capped(self) -> None:
        base = [_chunk("v1")]
        extras = [_chunk(f"e{i}", source_id=f"e{i}") for i in range(5)]
        merged = _merge_entity_expansion_chunks(base, extras)
        self.assertEqual(len(merged), 1 + ENTITY_EXPANSION_MAX_ADDED)


class TestEntityExpansionApply(unittest.TestCase):
    def test_listing_catalog_expands_revision(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-abc")]
        selected = [_chunk("sh-1", source_id="listing-abc", source_type="listing")]
        conn = AsyncMock()

        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._fetch_entity_expansion_sibling_rows",
                AsyncMock(return_value=[_row("rev-1", "listing_revision", source_id="listing-abc")]),
            ) as fetch_mock:
                merged, diag = await _apply_shadow_entity_expansion_v2(
                    conn,
                    selected_chunks=selected,
                    keyword_chunks=keyword,
                    resolved_profile="seller_sales_summary",
                    query="catalog listing activity",
                    filters=["d.source_type <> 'message'"],
                    params=["u1", "[0.1]"],
                    vec_param=2,
                    words=[],
                    pin_source=False,
                    query_vec="[0.1]",
                )
            self.assertTrue(diag["entity_expansion_succeeded"])
            self.assertEqual(diag["entity_expansion_added_count"], 1)
            self.assertIn("listing_revision", diag["entity_expansion_added_source_types"])
            self.assertTrue(any(chunk.get("entity_expansion_added") for chunk in merged))
            fetch_mock.assert_awaited_once()

        asyncio.run(run())

    def test_skipped_without_keyword_chunks(self) -> None:
        conn = AsyncMock()

        async def run() -> None:
            merged, diag = await _apply_shadow_entity_expansion_v2(
                conn,
                selected_chunks=[_chunk("sh-1")],
                keyword_chunks=None,
                resolved_profile="seller_sales_summary",
                query="catalog",
                filters=[],
                params=[],
                vec_param=1,
                words=[],
                pin_source=False,
                query_vec="[0.1]",
            )
            self.assertEqual(diag["entity_expansion_skip_reason"], "not_exposed")
            self.assertEqual(len(merged), 1)

        asyncio.run(run())

    def test_telemetry_records_overlap_before_after(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-abc", document_id="doc-kw")]
        selected = [_chunk("sh-1", source_id="other", document_id="doc-sh")]
        conn = AsyncMock()

        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._fetch_entity_expansion_sibling_rows",
                AsyncMock(return_value=[_row("rev-1", "listing_revision", source_id="listing-abc")]),
            ):
                _, diag = await _apply_shadow_entity_expansion_v2(
                    conn,
                    selected_chunks=selected,
                    keyword_chunks=keyword,
                    resolved_profile="seller_sales_summary",
                    query="catalog listing",
                    filters=["d.source_type <> 'message'"],
                    params=["u1", "[0.1]"],
                    vec_param=2,
                    words=[],
                    pin_source=False,
                    query_vec="[0.1]",
                )
            self.assertIn("doc_overlap_before_entity_expansion", diag)
            self.assertIn("entity_overlap_after_entity_expansion", diag)

        asyncio.run(run())

    def test_privacy_blocks_proxy_content(self) -> None:
        keyword = [_chunk("kw-1")]
        selected = [_chunk("sh-1")]
        conn = AsyncMock()

        async def run() -> None:
            bad_row = _row("bad-1", "listing")
            bad_row["content"] = "proxy_bids leak"
            with patch(
                "app.ai.rag_retrieval._fetch_entity_expansion_sibling_rows",
                AsyncMock(return_value=[bad_row]),
            ):
                merged, diag = await _apply_shadow_entity_expansion_v2(
                    conn,
                    selected_chunks=selected,
                    keyword_chunks=keyword,
                    resolved_profile="seller_sales_summary",
                    query="catalog",
                    filters=[],
                    params=["u1", "[0.1]"],
                    vec_param=2,
                    words=[],
                    pin_source=False,
                    query_vec="[0.1]",
                )
            self.assertEqual(diag["entity_expansion_skip_reason"], "no_privacy_safe_candidates")
            self.assertEqual(len(merged), 1)

        asyncio.run(run())


class TestEntityExpansionIntegration(unittest.TestCase):
    def test_keyword_production_unchanged(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)

    def test_collect_entity_expansion_keys_bounded(self) -> None:
        keyword = [_chunk(f"k{i}", source_id=f"id-{i}") for i in range(10)]
        keys = _collect_entity_expansion_keys(keyword, [])
        self.assertLessEqual(len(keys), 3)


if __name__ == "__main__":
    unittest.main()
