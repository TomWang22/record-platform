"""T20.10A — Shadow retrieval diagnostics unit tests."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    ShadowRetrievalDiagnostics,
    _build_overlap_diagnostics,
    _count_by_source_type,
    _finalize_shadow_diagnostics,
    _partition_privacy_rows,
)
from app.ai.shadow_profiles import resolved_profile_for_diagnostics  # noqa: E402


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
            {"id": "a", "source_type": "listing"},
            {"id": "b", "source_type": "listing_revision"},
            {"id": "c", "source_type": "obo_offer_summary"},
        ]
        shadow_chunks = [
            {"id": "b", "source_type": "listing_revision"},
            {"id": "d", "source_type": "listing"},
        ]

        result = _build_overlap_diagnostics(
            keyword_chunks=keyword_chunks,
            shadow_chunks=shadow_chunks,
        )

        self.assertEqual(result.count, 1)
        self.assertEqual(result.overlap_ids, ["b"])
        self.assertAlmostEqual(result.ratio_vs_keyword, 1 / 3, places=4)
        self.assertAlmostEqual(result.ratio_vs_shadow, 0.5, places=4)

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
        )
        self.assertGreaterEqual(quotas.get("obo_offer_summary", 0), 3)
        self.assertLessEqual(quotas.get("listing", 0), 2)
        self.assertEqual(vector_fetch_extra_types("obo_helper"), ["obo_offer_summary", "listing"])

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
