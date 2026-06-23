"""T20.10A — Shadow retrieval diagnostics unit tests."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    ShadowRetrievalDiagnostics,
    _apply_keyword_alignment_boost,
    _build_overlap_diagnostics,
    _count_by_source_type,
    _finalize_shadow_diagnostics,
    _keyword_alignment_multiplier,
    _keyword_alignment_targets,
    _partition_privacy_rows,
)
from app.ai.shadow_profiles import (  # noqa: E402
    infer_shadow_profile_from_query,
    resolved_profile_for_diagnostics,
    vector_fetch_extra_types,
)


class TestShadowDiagnosticsHelpers(unittest.TestCase):
    def test_count_by_source_type_groups_correctly(self) -> None:
        chunks = [
            {"id": "a", "source_type": "listing"},
            {"id": "b", "source_type": "listing"},
            {"id": "c", "source_type": "obo_offer_summary"},
        ]
        result = _count_by_source_type(chunks)
        self.assertEqual(result, {"listing": 2, "obo_offer_summary": 1})

    def test_overlap_diagnostics_computes_ratios(self) -> None:
        keyword_chunks = [
            {"id": "a", "document_id": "doc1", "source_type": "listing", "source_id": "L1"},
            {"id": "b", "document_id": "doc2", "source_type": "listing_revision", "source_id": "R1"},
            {"id": "c", "document_id": "doc3", "source_type": "obo_offer_summary", "source_id": "O1"},
        ]
        shadow_chunks = [
            {"id": "b", "document_id": "doc2", "source_type": "listing_revision", "source_id": "R1"},
            {"id": "d", "document_id": "doc4", "source_type": "listing", "source_id": "L2"},
        ]

        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )

        self.assertEqual(result.count, 1)
        self.assertEqual(result.overlap_ids, ["b"])
        self.assertEqual(result.document_overlap_count, 1)
        self.assertEqual(result.document_overlap_ids, ["doc2"])
        self.assertAlmostEqual(result.ratio_vs_keyword, 1 / 3, places=4)
        self.assertAlmostEqual(result.ratio_vs_shadow, 0.5, places=4)
        self.assertEqual(result.explanation.zero_overlap_reason, None)
        self.assertEqual(result.explanation.shared_source_type_count, 2)

    def test_overlap_explanation_entity_and_reason(self) -> None:
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "source_id": "L1",
                "metadata": {"listing_id": "L1"},
            },
        ]
        shadow_chunks = [
            {
                "id": "s1",
                "document_id": "doc-s",
                "source_type": "obo_offer_summary",
                "source_id": "O1",
                "metadata": {"listing_id": "L1"},
            },
        ]
        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )
        self.assertEqual(result.count, 0)
        self.assertEqual(result.entity_overlap_count, 1)
        self.assertEqual(result.explanation.zero_overlap_reason, "shared_entity_different_chunks")

    def test_overlap_entity_alias_listing_source_id_without_metadata(self) -> None:
        """T20.10K — listing source_id aliases to listing_id for OBO parity."""
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "source_id": "L1",
                "metadata": {},
            },
        ]
        shadow_chunks = [
            {
                "id": "s1",
                "document_id": "doc-s",
                "source_type": "obo_offer_summary",
                "source_id": "O1",
                "metadata": {"listing_id": "L1"},
            },
        ]
        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )
        self.assertEqual(result.entity_overlap_count, 1)
        self.assertEqual(result.explanation.zero_overlap_reason, "shared_entity_different_chunks")

    def test_overlap_entity_notification_listing_id_bridge(self) -> None:
        """T20.10L — notification listing_id bridges to listing source_id alias."""
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "source_id": "L1",
                "metadata": {},
            },
        ]
        shadow_chunks = [
            {
                "id": "s1",
                "document_id": "doc-s",
                "source_type": "notification",
                "source_id": "N1",
                "metadata": {"listing_id": "L1", "event_type": "OfferReceived"},
            },
        ]
        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )
        self.assertGreaterEqual(result.entity_overlap_count, 1)

    def test_overlap_source_type_mismatch_reason(self) -> None:
        keyword_chunks = [{"id": "k1", "document_id": "d1", "source_type": "listing", "source_id": "L1"}]
        shadow_chunks = [{"id": "s1", "document_id": "d2", "source_type": "notification", "source_id": "N1"}]
        result = _build_overlap_diagnostics(keyword_chunks=keyword_chunks, shadow_chunks=shadow_chunks)
        self.assertEqual(result.explanation.zero_overlap_reason, "source_type_mismatch")

    def test_shadow_diagnostics_to_dict_shape(self) -> None:
        diagnostics = ShadowRetrievalDiagnostics(enabled=True, profile="obo_helper", query_hints=["obo"])
        payload = diagnostics.to_dict()

        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["profile"], "obo_helper")
        self.assertEqual(payload["query_hints"], ["obo"])
        self.assertIn("timings_ms", payload)
        self.assertIn("counts", payload)
        self.assertIn("by_source_type", payload)
        self.assertIn("privacy", payload)
        self.assertIn("overlap", payload)

    def test_finalize_shadow_diagnostics_counts(self) -> None:
        diagnostics = ShadowRetrievalDiagnostics(enabled=True)
        raw = [{"id": "1", "source_type": "listing"}, {"id": "2", "source_type": "obo_offer_summary"}]
        filtered = [raw[0]]
        selected = [raw[0]]
        keyword = [{"id": "1", "source_type": "listing"}]
        _finalize_shadow_diagnostics(
            diagnostics,
            raw_rows=raw,
            source_filtered_rows=raw,
            privacy_filtered_rows=filtered,
            selected_chunks=selected,
            keyword_chunks=keyword,
        )
        payload = diagnostics.to_dict()
        self.assertEqual(payload["counts"]["candidate_count_raw"], 2)
        self.assertEqual(payload["counts"]["selected_count"], 1)
        self.assertEqual(payload["overlap"]["count"], 1)

    def test_partition_privacy_rows_blocks_message_and_proxy(self) -> None:
        rows = [
            {"id": "1", "source_type": "listing", "content": "ok", "metadata": {}, "score": 1},
            {"id": "2", "source_type": "message", "content": "secret", "metadata": {}, "score": 1},
            {"id": "3", "source_type": "listing", "content": "max_bid_cents leak", "metadata": {}, "score": 1},
        ]
        allowed, privacy = _partition_privacy_rows(rows, words=[], pin_source=False, query="")
        self.assertEqual(len(allowed), 1)
        self.assertEqual(privacy.blocked_message_count, 1)
        self.assertEqual(privacy.blocked_proxy_count, 1)

    def test_resolved_profile_for_diagnostics(self) -> None:
        details = resolved_profile_for_diagnostics("obo_helper")
        self.assertEqual(details["profile"], "obo_helper")
        self.assertIn("obo_offer_summary", details["preferred_source_types"])
        self.assertTrue(details["query_hints_available"])

    def test_custom_comma_separated_hints(self) -> None:
        from app.ai.shadow_profiles import expand_query_with_hints

        expanded, terms, applied, truncated = expand_query_with_hints(
            "OBO summary",
            "obo_helper",
            custom_hints=["obo", "owner_visible"],
        )
        self.assertTrue(applied)
        self.assertFalse(truncated)
        self.assertEqual(terms, ["obo", "owner_visible"])
        self.assertIn("owner_visible", expanded)

    def test_obo_focused_quotas_and_fetch_plan(self) -> None:
        from app.ai.shadow_profiles import (
            is_obo_focused,
            preferred_type_quotas,
            vector_fetch_extra_types,
        )

        self.assertTrue(is_obo_focused("obo_helper", None))
        quotas = preferred_type_quotas(
            "obo_helper",
            8,
            {"obo_offer_summary": 18, "listing": 10, "listing_revision": 4},
            custom_hints=["owner_visible"],
            query="owner OBO summary",
        )
        self.assertGreaterEqual(quotas.get("obo_offer_summary", 0), 3)
        self.assertLessEqual(quotas.get("listing", 0), 2)
        self.assertEqual(vector_fetch_extra_types("obo_helper"), ["obo_offer_summary", "listing"])

    def test_infer_shadow_profile_from_query(self) -> None:
        from app.ai.shadow_profiles import infer_shadow_profile_from_query

        self.assertEqual(
            infer_shadow_profile_from_query(
                "Give me an owner-visible summary of OBO activity for my active listings."
            ),
            "obo_helper",
        )
        self.assertEqual(
            infer_shadow_profile_from_query(
                "What notifications matter most for my selling activity right now?"
            ),
            "seller_sales_summary",
        )
        self.assertEqual(
            infer_shadow_profile_from_query(
                "What are the most recent pricing or revision changes across my listings?"
            ),
            "seller_sales_summary",
        )

    def test_seller_sales_summary_quotas_include_obo_for_offer_prompt(self) -> None:
        from app.ai.shadow_profiles import preferred_type_quotas

        quotas = preferred_type_quotas(
            "seller_sales_summary",
            8,
            {
                "obo_offer_summary": 18,
                "listing": 10,
                "listing_revision": 8,
                "notification": 6,
            },
            query="Summarize the latest offers I have received on my listings.",
        )
        self.assertGreaterEqual(quotas.get("obo_offer_summary", 0), 2)
        self.assertGreaterEqual(quotas.get("listing", 0), 2)

    def test_shared_source_alignment_diagnostics(self) -> None:
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "source_id": "L1",
                "metadata": {"listing_id": "L1"},
            },
        ]
        shadow_chunks = [
            {
                "id": "s1",
                "document_id": "doc-s",
                "source_type": "listing",
                "source_id": "L2",
                "metadata": {"listing_id": "L1"},
            },
        ]
        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )
        self.assertEqual(result.explanation.zero_overlap_reason, "shared_entity_different_chunks")
        self.assertIn("listing", result.explanation.shared_source_alignment)
        self.assertEqual(
            result.explanation.shared_source_alignment["listing"]["shared_entity_count"],
            1,
        )

    def test_keyword_alignment_targets_and_boost(self) -> None:
        keyword_chunks = [
            {
                "id": "k1",
                "document_id": "doc-k",
                "source_type": "listing",
                "metadata": {"listing_id": "L1"},
            },
        ]
        chunk_ids, doc_ids, entity_keys = _keyword_alignment_targets(keyword_chunks)
        self.assertEqual(chunk_ids, {"k1"})
        self.assertEqual(doc_ids, {"doc-k"})
        self.assertIn("listing_id:L1", entity_keys)

        rows = [
            {"id": "k1", "source_type": "listing", "score": 0.5, "metadata": {}},
            {"id": "s2", "source_type": "listing", "score": 0.9, "metadata": {"listing_id": "L1"}},
        ]
        boosted = _apply_keyword_alignment_boost(rows, keyword_chunks)
        self.assertEqual(boosted[0]["id"], "s2")
        self.assertEqual(boosted[1]["id"], "k1")
        self.assertEqual(
            _keyword_alignment_multiplier(
                rows[1],
                keyword_chunk_ids=chunk_ids,
                keyword_document_ids=doc_ids,
                keyword_entity_keys=entity_keys,
            ),
            1.25,
        )

    def test_vector_fetch_extra_types_for_seller_prompt(self) -> None:
        extra = vector_fetch_extra_types(
            "seller_sales_summary",
            query="What notifications matter most for my selling activity right now?",
        )
        self.assertIn("notification", extra)
        self.assertIn("obo_offer_summary", extra)

    def test_infer_shadow_profile_auction_route(self) -> None:
        self.assertEqual(
            infer_shadow_profile_from_query("Show auction proxy pressure on my listings."),
            "auction_risk",
        )

    def test_hint_expansion_cap_truncates_profile_hints(self) -> None:
        from app.ai.shadow_profiles import expand_query_with_hints

        long_base = "x" * 490
        expanded, terms, applied, truncated = expand_query_with_hints(
            long_base,
            "obo_helper",
            apply_profile_hints=True,
            max_expanded_chars=512,
        )
        self.assertTrue(applied)
        self.assertTrue(truncated)
        self.assertLessEqual(len(expanded), 512)

    def test_shadow_embed_diagnostics_to_dict(self) -> None:
        from app.ai.rag_retrieval import ShadowEmbedDiagnostics, ShadowRetrievalDiagnostics

        diagnostics = ShadowRetrievalDiagnostics(
            enabled=True,
            embed=ShadowEmbedDiagnostics(
                provider="ollama",
                model="nomic-embed-text",
                query_length=42,
                expanded_query_length=120,
                timeout_ms=5000,
                latency_ms=180,
            ),
        )
        payload = diagnostics.to_dict()
        self.assertIn("embed", payload)
        self.assertEqual(payload["embed"]["provider"], "ollama")
        self.assertEqual(payload["embed"]["query_length"], 42)

    def test_shadow_embed_timeout_fail_closed(self) -> None:
        import asyncio
        from unittest.mock import AsyncMock, patch

        import httpx

        from app.ai.rag_retrieval import retrieve_chunks_vector_shadow

        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=5)

        async def run():
            with patch(
                "app.ai.rag_retrieval._call_ollama_embed",
                AsyncMock(side_effect=httpx.TimeoutException("timeout")),
            ):
                return await retrieve_chunks_vector_shadow(
                    conn,
                    query="owner OBO summary",
                    user_id="u1",
                    include_diagnostics=True,
                )

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(run())
        finally:
            loop.close()

        self.assertEqual(result["status"], "embed_timed_out")
        self.assertTrue(result.get("embed_timed_out"))
        sd = result["shadow_diagnostics"]
        self.assertTrue(sd["embed"]["timed_out"])
        self.assertEqual(result["chunks"], [])

    def test_shadow_embed_cache_hit(self) -> None:
        import asyncio
        from unittest.mock import AsyncMock, patch

        from app.ai.rag_retrieval import (
            _shadow_embed_cache,
            _shadow_embed_query,
        )

        _shadow_embed_cache.clear()
        vec = [0.01] * 768
        call = AsyncMock(return_value=vec)

        async def run_twice():
            with patch("app.ai.rag_retrieval._call_ollama_embed", call):
                first, meta1 = await _shadow_embed_query(
                    "cached query",
                    original_query_length=12,
                    profile_hints_enabled=False,
                    hint_terms_count=0,
                    hint_expansion_truncated=False,
                )
                second, meta2 = await _shadow_embed_query(
                    "cached query",
                    original_query_length=12,
                    profile_hints_enabled=False,
                    hint_terms_count=0,
                    hint_expansion_truncated=False,
                )
                return first, meta1, second, meta2

        loop = asyncio.new_event_loop()
        try:
            first, meta1, second, meta2 = loop.run_until_complete(run_twice())
        finally:
            loop.close()
            _shadow_embed_cache.clear()

        self.assertEqual(first, second)
        self.assertFalse(meta1.cache_hit)
        self.assertTrue(meta2.cache_hit)
        self.assertEqual(call.await_count, 1)


if __name__ == "__main__":
    unittest.main()
