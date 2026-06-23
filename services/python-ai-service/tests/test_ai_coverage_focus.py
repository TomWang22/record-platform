"""T20.6C — Focused unit tests for app/ai module coverage (no Ollama, no DB required)."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.envelope import (  # noqa: E402
    assert_no_forbidden_prose,
    build_envelope,
    chunk_to_citation,
    source_ref,
)
from app.ai.providers.registry import get_provider, provider_status_map, resolve_model_used  # noqa: E402
from app.ai.providers.rule_engine import RuleEngineProvider  # noqa: E402
from app.ai.rag_retrieval import (  # noqa: E402
    FORBIDDEN_CHUNK_RE,
    _apply_route_weights,
    _chunk_passes_privacy,
    _coerce_metadata,
    _embed_query_vector,
    _merge_vector_rows,
    _rows_to_chunks,
    _top_results_from_chunks,
    _visibility_clause,
    build_shadow_vector_diagnostic,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import (  # noqa: E402
    profile_diagnostic_meta,
    preferred_source_types,
    resolve_shadow_profile,
    source_type_weights,
)


def _row(**kwargs):
    defaults = {
        "id": "chunk-1",
        "document_id": "doc-1",
        "chunk_index": 0,
        "content": "listing price 4200 cents",
        "checksum": "abc",
        "source_refs": [],
        "source_type": "listing",
        "source_id": "lst-1",
        "owner_user_id": None,
        "visibility": "public",
        "source_updated_at": None,
        "title": "Test listing",
        "metadata": {},
        "score": 0.9,
    }
    defaults.update(kwargs)
    return defaults


class TestEnvelopeExtended(unittest.TestCase):
    def test_source_ref_optional_fields(self):
        ref = source_ref("listing", "x1", field="price", freshness="2026-01-01", checksum="c1")
        self.assertEqual(ref["field"], "price")
        self.assertEqual(ref["freshness"], "2026-01-01")

    def test_live_with_refs_stays_live(self):
        refs = [source_ref("record", "r1")]
        env = build_envelope(
            "rag_query",
            source_status="live",
            model_used="rule-engine",
            summary="Grounded excerpt retrieved.",
            source_refs=refs,
        )
        self.assertEqual(env["source_status"], "live")
        self.assertEqual(len(env["source_refs"]), 1)

    def test_degraded_explicit(self):
        env = build_envelope(
            "rag_query",
            source_status="degraded",
            model_used="none",
            summary="Corpus unavailable.",
            degraded_reason="db_down",
        )
        self.assertEqual(env["degraded_reason"], "db_down")

    def test_forbidden_terms_in_summary(self):
        for term in ("demo", "mock", "placeholder"):
            with self.assertRaises(ValueError):
                assert_no_forbidden_prose(f"response contains {term}")

    def test_chunk_to_citation_truncates(self):
        cit = chunk_to_citation({"content": "x" * 500, "source_type": "listing", "source_id": "1"})
        self.assertLessEqual(len(cit["excerpt"]), 240)


class TestRagRetrievalPrivacy(unittest.TestCase):
    def test_visibility_public_only(self):
        sql, params = _visibility_clause(None)
        self.assertIn("public", sql)
        self.assertEqual(params, [])

    def test_visibility_owner_clause(self):
        sql, params = _visibility_clause("user-abc")
        self.assertIn("owner", sql)
        self.assertEqual(params, ["user-abc"])

    def test_forbidden_proxy_leak_blocked(self):
        row = _row(content="max_bid_cents exposed in chunk")
        self.assertFalse(_chunk_passes_privacy(row, words=[], pin_source=False, query=""))

    def test_message_without_opt_in_blocked(self):
        row = _row(source_type="message", content="hello", metadata={"opt_in": False})
        self.assertFalse(_chunk_passes_privacy(row, words=[], pin_source=False, query=""))

    def test_message_with_opt_in_allowed(self):
        row = _row(source_type="message", content="hello buyer", metadata={"opt_in": True})
        self.assertTrue(_chunk_passes_privacy(row, words=[], pin_source=False, query=""))

    def test_zero_score_filtered_when_query_present(self):
        row = _row(score=0, content="listing")
        self.assertFalse(_chunk_passes_privacy(row, words=["listing"], pin_source=False, query="listing"))

    def test_pin_source_allows_zero_score(self):
        row = _row(score=0, content="listing pinned")
        self.assertTrue(_chunk_passes_privacy(row, words=[], pin_source=True, query=""))

    def test_coerce_metadata_json_string(self):
        meta = _coerce_metadata('{"listing_id": "L1"}')
        self.assertEqual(meta["listing_id"], "L1")

    def test_coerce_metadata_invalid_json(self):
        self.assertEqual(_coerce_metadata("{bad"), {})

    def test_rows_to_chunks_respects_token_budget(self):
        rows = [_row(id=f"c{i}", content="word " * 200) for i in range(5)]
        chunks = _rows_to_chunks(rows, words=[], pin_source=False, query="", max_chunks=5, max_tokens=50)
        self.assertGreaterEqual(len(chunks), 1)
        self.assertLessEqual(len(chunks), 5)

    def test_merge_vector_rows_dedupes(self):
        r1 = _row(id="same")
        r2 = _row(id="same", score=0.5)
        merged = _merge_vector_rows([r1], [r2])
        self.assertEqual(len(merged), 1)

    def test_apply_route_weights_prefers_auction(self):
        rows = [
            _row(id="a", source_type="listing", score=0.5),
            _row(id="b", source_type="auction_bid_summary", score=0.7),
        ]
        weights = source_type_weights("auction_risk")
        ranked = _apply_route_weights(rows, weights)
        self.assertEqual(ranked[0]["source_type"], "auction_bid_summary")

    def test_top_results_no_body_leak(self):
        tops = _top_results_from_chunks([{"source_type": "obo_offer_summary", "source_id": "o1", "title": "Offer"}])
        self.assertNotIn("content", tops[0])
        self.assertEqual(tops[0]["label"], "Offer")

    def test_build_shadow_diagnostic_overlap(self):
        kw = [{"id": "1", "source_type": "listing"}]
        shadow = {
            "chunk_ids": ["1", "2"],
            "chunks": [{"id": "1", "source_type": "listing"}, {"id": "2", "source_type": "obo_offer_summary"}],
            "candidate_count": 2,
            "latency_ms": 12.3,
            "embedded_chunks": 100,
        }
        diag = build_shadow_vector_diagnostic(kw, shadow)
        self.assertEqual(diag["overlap_with_keyword"], 1)
        self.assertIn("obo_offer_summary", diag["source_type_distribution"])

    def test_obo_forbidden_pattern(self):
        self.assertTrue(FORBIDDEN_CHUNK_RE.search("proxy_bids visible"))
        self.assertFalse(FORBIDDEN_CHUNK_RE.search("current bid 1200 cents"))


class TestEmbeddingDimension(unittest.TestCase):
    def _run(self, coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_dimension_mismatch_raises(self):
        bad_vec = [0.1] * 10

        class FakeResp:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return {"embeddings": [bad_vec]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, url, json=None):
                return FakeResp()

        with patch("httpx.AsyncClient", return_value=FakeClient()):
            with self.assertRaises(RuntimeError) as ctx:
                self._run(_embed_query_vector("test query"))
            self.assertIn("dimension_mismatch", str(ctx.exception))

    def test_valid_dimension_returns_vector(self):
        dim = 768
        good_vec = [0.01] * dim

        class FakeResp:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return {"embedding": good_vec}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, url, json=None):
                return FakeResp()

        with patch("app.ai.rag_retrieval.AI_RAG_VECTOR_DIM", dim):
            with patch("httpx.AsyncClient", return_value=FakeClient()):
                vec = self._run(_embed_query_vector("search"))
                self.assertEqual(len(vec), dim)


class TestVectorShadowDegraded(unittest.TestCase):
    def _run(self, coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_insufficient_embeddings(self):
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=0)
        result = self._run(
            retrieve_chunks_vector_shadow(conn, query="test", user_id=None)
        )
        self.assertEqual(result["status"], "insufficient_embeddings")
        self.assertEqual(result["chunks"], [])

    def test_embed_failed_returns_degraded(self):
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=5)

        with patch(
            "app.ai.rag_retrieval._call_ollama_embed",
            AsyncMock(side_effect=RuntimeError("ollama down")),
        ):
            result = self._run(
                retrieve_chunks_vector_shadow(conn, query="test", user_id="u1")
            )
        self.assertEqual(result["status"], "embed_failed")
        self.assertIn("ollama down", result.get("error", ""))


class TestProviderRegistry(unittest.TestCase):
    def _run(self, coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_get_provider_rule_default(self):
        with patch.dict(os.environ, {"AI_MODEL_PROVIDER": "rule"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.providers.registry as reg

            reload(cfg)
            reload(reg)
            p = reg.get_provider()
            self.assertEqual(p.name, "rule")

    def test_ollama_degraded_explain(self):
        from app.ai.providers.ollama import OllamaProvider

        provider = OllamaProvider()
        with patch.object(provider, "status", AsyncMock(return_value={"available": False, "reason": "offline"})):
            result = self._run(provider.explain("prompt"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["degraded_reason"], "offline")

    def test_rule_engine_structured_only(self):
        provider = RuleEngineProvider()
        result = self._run(provider.explain("prompt"))
        self.assertTrue(result["ok"])
        self.assertEqual(result["degraded_reason"], "rule_engine_structured_only")

    def test_resolve_model_used_rule(self):
        with patch.dict(os.environ, {"AI_MODEL_PROVIDER": "rule"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.providers.registry as reg

            reload(cfg)
            reload(reg)
            model, reason = self._run(reg.resolve_model_used())
            self.assertEqual(model, "rule-engine")
            self.assertIsNone(reason)

    def test_provider_status_map(self):
        status = self._run(provider_status_map())
        self.assertIn("rule", status)
        self.assertIn("active", status)


class TestShadowProfilesExtended(unittest.TestCase):
    def test_profile_diagnostic_meta(self):
        meta = profile_diagnostic_meta("auction_risk")
        self.assertEqual(meta["profile"], "auction_risk")
        self.assertIn("auction_bid_summary", meta["preferred_source_types"])

    def test_preferred_source_types_obo(self):
        types = preferred_source_types("obo_helper")
        self.assertEqual(types[0], "obo_offer_summary")

    def test_seller_sales_summary_profile(self):
        self.assertEqual(resolve_shadow_profile("seller_sales_summary"), "seller_sales_summary")
        weights = source_type_weights("seller_sales_summary")
        self.assertGreater(weights.get("obo_offer_summary", 0), weights.get("record", 0))
        self.assertGreater(weights.get("listing_revision", 0), weights.get("record", 0))

    def test_infer_shadow_profile_generic_empty(self):
        from app.ai.shadow_profiles import infer_shadow_profile_from_query

        self.assertEqual(infer_shadow_profile_from_query(""), "generic_rag")


class TestInsightsDegraded(unittest.TestCase):
    def _run(self, coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_rag_query_db_unavailable(self):
        from app.ai import insights

        with patch.object(insights, "get_pool", AsyncMock(return_value=None)):
            env = self._run(insights.rag_query(user_id=None, question="hello"))
        self.assertEqual(env["source_status"], "degraded")
        self.assertEqual(env["degraded_reason"], "python_ai_db_unavailable")


if __name__ == "__main__":
    unittest.main()
