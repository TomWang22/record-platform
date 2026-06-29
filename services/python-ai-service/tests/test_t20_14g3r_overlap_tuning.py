"""T20.14G3R — Overlap anchor top-up and keyword entity bridge tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    _apply_keyword_entity_bridge_v2,
    _apply_overlap_anchor_topup,
    retrieve_chunks,
)
from app.ai.shadow_profiles import (  # noqa: E402
    SHADOW_OVERLAP_ANCHOR_MAX,
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


class TestOverlapAnchorTopup(unittest.TestCase):
    def test_nonzero_shadow_zero_doc_entity_adds_overlap_anchor(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-kw", document_id="doc-kw")]
        shadow = [
            _chunk(
                "sh-1",
                source_id="obo-1",
                source_type="obo_offer_summary",
                document_id="doc-sh",
            )
        ]
        merged, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        self.assertTrue(diag["overlap_anchor_attempted"])
        self.assertTrue(diag["overlap_anchor_added"])
        self.assertEqual(diag["overlap_anchor_reason"], "zero_doc_entity_overlap")
        self.assertTrue(any(c.get("overlap_anchor_added") for c in merged))
        self.assertGreater(
            diag["doc_overlap_after_overlap_anchor"] + diag["entity_overlap_after_overlap_anchor"],
            0,
        )

    def test_overlap_anchor_capped_at_one_by_default(self) -> None:
        keyword = [
            _chunk("kw-1", source_id="a", document_id="d1"),
            _chunk("kw-2", source_id="b", document_id="d2"),
        ]
        shadow = [_chunk("sh-1", source_type="obo_offer_summary", source_id="x", document_id="d-sh")]
        _, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        self.assertLessEqual(diag["overlap_anchor_count"], SHADOW_OVERLAP_ANCHOR_MAX)

    def test_overlap_anchor_privacy_blocks_forbidden_refs(self) -> None:
        keyword = [
            _chunk("kw-bad", content="proxy_bids hidden", source_id="bad"),
        ]
        shadow = [_chunk("sh-1", source_type="obo_offer_summary", source_id="x", document_id="d-sh")]
        merged, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        self.assertFalse(diag["overlap_anchor_added"])
        self.assertEqual(len(merged), 1)

    def test_overlap_already_positive_skips_anchor(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-1", document_id="doc-shared")]
        shadow = [_chunk("sh-1", source_id="listing-1", document_id="doc-shared")]
        merged, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        self.assertFalse(diag["overlap_anchor_attempted"])
        self.assertEqual(diag["overlap_anchor_reason"], "overlap_already_positive")
        self.assertEqual(len(merged), 1)


class TestKeywordEntityBridge(unittest.TestCase):
    def test_keyword_entity_bridge_adds_sibling(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-abc")]
        selected = [
            _chunk("sh-1", source_type="obo_offer_summary", source_id="obo-1", document_id="doc-sh")
        ]
        conn = AsyncMock()

        async def run() -> None:
            with patch(
                "app.ai.rag_retrieval._fetch_entity_expansion_sibling_rows",
                AsyncMock(return_value=[_row("rev-1", "listing_revision", source_id="listing-abc")]),
            ):
                merged, diag = await _apply_keyword_entity_bridge_v2(
                    conn,
                    selected_chunks=selected,
                    keyword_chunks=keyword,
                    resolved_profile="seller_sales_summary",
                    query="Summarize listing activity",
                    filters=[],
                    params=["vec"],
                    vec_param=1,
                    words=[],
                    pin_source=False,
                    query_vec="[0.1]",
                )
                self.assertTrue(diag["keyword_entity_bridge_attempted"])
                self.assertTrue(diag["keyword_entity_bridge_added"])
                self.assertTrue(any(c.get("keyword_entity_bridge_added") for c in merged))

        asyncio.run(run())


class TestOverlapTelemetrySplit(unittest.TestCase):
    def test_pure_vector_telemetry_preserved_separately(self) -> None:
        keyword = [_chunk("kw-1", source_id="listing-kw", document_id="doc-kw")]
        shadow = [
            _chunk("sh-1", source_type="obo_offer_summary", source_id="obo-1", document_id="doc-sh")
        ]
        merged, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        self.assertIn("doc_overlap_before_overlap_anchor", diag)
        self.assertIn("doc_overlap_after_overlap_anchor", diag)
        self.assertFalse(any(c.get("keyword_anchor_added") for c in merged))


class TestProductionKeywordUnchanged(unittest.TestCase):
    def test_retrieve_chunks_signature_unchanged(self) -> None:
        import inspect

        sig = inspect.signature(retrieve_chunks)
        self.assertIn("query", sig.parameters)


class TestNoForbiddenLeakage(unittest.TestCase):
    def test_overlap_anchor_diag_has_no_forbidden_strings(self) -> None:
        keyword = [_chunk("kw-1")]
        shadow = [_chunk("sh-1", source_type="obo_offer_summary", source_id="obo-1")]
        _, diag = _apply_overlap_anchor_topup(shadow, keyword_chunks=keyword)
        blob = str(diag)
        self.assertNotIn("proxy_bids", blob)
        self.assertNotIn("max_bid_cents", blob)


if __name__ == "__main__":
    unittest.main()
