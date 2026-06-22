"""T20.6C — Route, insights, outbox, and rag_retrieval mock-DB coverage."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai import insights, routes
from app.ai.envelope import build_envelope, source_ref
from app.ai.outbox import insert_pricing_recommendation_outbox, publish_python_ai_outbox_tick
from app.ai.providers.ollama import OllamaProvider
from app.ai.providers.transformer import HuggingFaceProvider
from app.ai.rag_retrieval import (
    _build_scope_filters,
    _fetch_diversified_vector_rows,
    _select_route_weighted_chunks,
    count_embedded_by_source_type_for_scope,
    count_embedded_chunks_for_scope,
    fetch_document_chunks_for_user,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import source_type_weights


def _chunk_row(**kwargs):
    base = {
        "id": "c1",
        "document_id": "d1",
        "chunk_index": 0,
        "content": "listing Price: 42.50 shipping condition photo",
        "checksum": "x",
        "source_refs": [],
        "source_type": "listing",
        "source_id": "L1",
        "owner_user_id": "u1",
        "visibility": "public",
        "source_updated_at": None,
        "title": "Vinyl",
        "metadata": {},
        "score": 2,
    }
    base.update(kwargs)
    return base


class FakeConn:
    def __init__(self, fetch_rows=None, fetchval=0, fetch_group=None):
        self._fetch_rows = fetch_rows or []
        self._fetchval = fetchval
        self._fetch_group = fetch_group or []
        self.executed = []

    async def fetch(self, sql, *params):
        if "GROUP BY d.source_type" in sql:
            return self._fetch_group
        return self._fetch_rows

    async def fetchval(self, sql, *params):
        return self._fetchval

    async def execute(self, sql, *params):
        self.executed.append((sql, params))


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestRoutes(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(routes.router)
        self.client = TestClient(app)

    @patch.object(insights, "rag_query", new_callable=AsyncMock)
    def test_post_rag_query(self, mock_rag):
        mock_rag.return_value = {"contract_id": "rag_query", "source_status": "live"}
        r = self.client.post("/ai/rag/query", json={"question": "What is fair price?"}, headers={"x-user-id": "u1"})
        self.assertEqual(r.status_code, 200)
        mock_rag.assert_called_once()

    @patch.object(insights, "record_valuation", new_callable=AsyncMock)
    def test_post_record_valuation(self, mock_fn):
        mock_fn.return_value = {"contract_id": "record_valuation"}
        r = self.client.post("/ai/records/valuation", json={"record_id": "rec-12345678"})
        self.assertEqual(r.status_code, 200)

    @patch.object(insights, "listing_pricing_advice", new_callable=AsyncMock)
    def test_post_pricing_advice(self, mock_fn):
        mock_fn.return_value = {"contract_id": "pricing_recommendation"}
        r = self.client.post("/ai/listings/pricing-advice", json={"listing_id": "lst-12345678"})
        self.assertEqual(r.status_code, 200)

    @patch.object(insights, "auction_risk", new_callable=AsyncMock)
    def test_post_auction_risk(self, mock_fn):
        mock_fn.return_value = {"contract_id": "auction_risk"}
        r = self.client.post("/ai/auctions/risk", json={"listing_id": "lst-12345678"})
        self.assertEqual(r.status_code, 200)

    @patch.object(insights, "seller_summary", new_callable=AsyncMock)
    def test_post_seller_summary(self, mock_fn):
        mock_fn.return_value = {"contract_id": "seller_sales_summary"}
        r = self.client.post("/ai/seller/summary", json={"user_id": "u1"})
        self.assertEqual(r.status_code, 200)

    @patch.object(insights, "buyer_collection_summary", new_callable=AsyncMock)
    def test_post_buyer_collection(self, mock_fn):
        mock_fn.return_value = {"contract_id": "buyer_collection_summary"}
        r = self.client.post("/ai/buyer/collection-summary", json={"user_id": "u1"})
        self.assertEqual(r.status_code, 200)

    @patch.object(insights, "offer_insights", new_callable=AsyncMock)
    def test_get_offer_insights(self, mock_fn):
        mock_fn.return_value = {"contract_id": "obo_helper"}
        r = self.client.get("/ai/offer-insights?listing_id=lst-12345678", headers={"x-user-id": "u1"})
        self.assertEqual(r.status_code, 200)

    def test_user_id_helper(self):
        self.assertIsNone(routes._user_id(None, None))
        self.assertIsNone(routes._user_id("null", None))
        self.assertEqual(routes._user_id("  u1 ", None), "u1")


class TestRetrieveChunksMockDb(unittest.TestCase):
    def test_keyword_retrieval_with_refs(self):
        conn = FakeConn(fetch_rows=[_chunk_row(), _chunk_row(id="c2", source_id="L2")])
        result = _run(retrieve_chunks(conn, query="listing price", user_id="u1"))
        self.assertEqual(result["retrieval_mode"], "keyword")
        self.assertTrue(result["source_refs"])
        self.assertEqual(len(result["chunks"]), 2)

    def test_keyword_pin_source_no_words(self):
        conn = FakeConn(fetch_rows=[_chunk_row(score=0)])
        result = _run(retrieve_chunks(conn, query="ignored", user_id=None, source_id="L1"))
        self.assertGreaterEqual(len(result["chunks"]), 1)

    def test_fetch_document_chunks_for_user(self):
        conn = FakeConn(fetch_rows=[_chunk_row(source_type="record")])
        result = _run(
            fetch_document_chunks_for_user(conn, user_id="u1", source_type="record", source_id="R1")
        )
        self.assertIn("chunks", result)
        self.assertEqual(len(result["chunks"]), 1)


class TestScopeFilters(unittest.TestCase):
    def test_build_scope_filters_public(self):
        filters, params, idx = _build_scope_filters(None)
        self.assertIn("public", filters[0])
        self.assertEqual(params, [])

    def test_build_scope_filters_with_types(self):
        filters, params, _idx = _build_scope_filters("u1", source_types=["listing"], require_embedding_vec=True)
        self.assertTrue(any("embedding_vec" in f for f in filters))
        self.assertEqual(params[0], "u1")
        self.assertEqual(params[1], ["listing"])


class TestRouteWeightedSelection(unittest.TestCase):
    def test_select_route_weighted_chunks(self):
        rows = [
            _chunk_row(id="a", source_type="auction_bid_summary", score=0.8),
            _chunk_row(id="b", source_type="listing", score=0.9),
            _chunk_row(id="c", source_type="obo_offer_summary", score=0.7),
        ]
        weights = source_type_weights("auction_risk")
        selected = _select_route_weighted_chunks(
            rows,
            profile="auction_risk",
            preferred=["auction_bid_summary", "listing"],
            weights=weights,
            words=[],
            pin_source=False,
            query="",
            max_chunks=3,
            max_tokens=5000,
            scope_by_type={"auction_bid_summary": 1, "listing": 1, "obo_offer_summary": 1},
        )
        types = {c["source_type"] for c in selected}
        self.assertIn("auction_bid_summary", types)


class TestVectorShadowRouteMode(unittest.TestCase):
    def test_route_mode_ok_with_mocks(self):
        conn = FakeConn(
            fetchval=10,
            fetch_rows=[_chunk_row()],
            fetch_group=[{"source_type": "listing", "cnt": 5}],
        )

        async def fake_fetch_vector(*args, **kwargs):
            return [_chunk_row()]

        with patch("app.ai.rag_retrieval._embed_query_vector", AsyncMock(return_value=[0.1] * 768)):
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch_vector)):
                result = _run(
                    retrieve_chunks_vector_shadow(
                        conn,
                        query="auction risk",
                        user_id="u1",
                        route_shadow_profile="auction_risk",
                        shadow_profile_hints=True,
                    )
                )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["profile"], "auction_risk")
        self.assertTrue(result.get("query_hint_applied"))


class TestEmbeddedCounts(unittest.TestCase):
    def test_count_embedded_chunks(self):
        conn = FakeConn(fetchval=42)
        n = _run(count_embedded_chunks_for_scope(conn, user_id=None))
        self.assertEqual(n, 42)

    def test_count_embedded_by_source_type(self):
        conn = FakeConn(fetch_group=[{"source_type": "listing", "cnt": 3}])
        m = _run(count_embedded_by_source_type_for_scope(conn, user_id="u1"))
        self.assertEqual(m["listing"], 3)


class TestOutbox(unittest.TestCase):
    def test_insert_pricing_recommendation_outbox(self):
        conn = FakeConn()
        env = build_envelope(
            "pricing_recommendation",
            source_status="live",
            model_used="rule-engine",
            summary="Fair price band computed.",
            source_refs=[source_ref("listing", "L1")],
        )
        eid = _run(
            insert_pricing_recommendation_outbox(conn, user_id="u1", listing_id="L1", envelope=env)
        )
        self.assertTrue(len(eid) > 8)
        self.assertEqual(len(conn.executed), 1)

    def test_publish_outbox_disabled(self):
        conn = FakeConn()
        with patch.dict(os.environ, {"PYTHON_AI_OUTBOX_PUBLISHER": "0"}, clear=False):
            from importlib import reload
            import app.ai.outbox as ob

            reload(ob)
            n = _run(ob.publish_python_ai_outbox_tick(conn))
        self.assertEqual(n, 0)


class TestOllamaSuccessPath(unittest.TestCase):
    def test_status_available(self):
        class FakeResp:
            status_code = 200

            def json(self):
                return {"models": [{"name": "llama3.2:1b"}, {"name": "nomic-embed-text"}]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def get(self, url):
                return FakeResp()

        provider = OllamaProvider()
        with patch("httpx.AsyncClient", return_value=FakeClient()):
            st = _run(provider.status())
        self.assertTrue(st["available"])

    def test_explain_success(self):
        class FakeResp:
            status_code = 200

            def json(self):
                return {"response": "Grounded summary from sources."}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def get(self, url):
                class Tags:
                    status_code = 200

                    def json(self):
                        return {"models": [{"name": "llama3.2:1b"}]}

                return Tags()

            async def post(self, url, json=None):
                return FakeResp()

        provider = OllamaProvider()
        with patch("httpx.AsyncClient", return_value=FakeClient()):
            result = _run(provider.explain("Summarize listing"))
        self.assertTrue(result["ok"])
        self.assertIn("Grounded", result["text"])


class TestTransformerProvider(unittest.TestCase):
    def test_hf_disabled(self):
        p = HuggingFaceProvider
        st = _run(p.status())
        self.assertFalse(st["available"])


class TestInsightsWithMockPool(unittest.TestCase):
    def _mock_pool(self, conn):
        pool = MagicMock()
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=conn)
        ctx.__aexit__ = AsyncMock(return_value=None)
        pool.acquire.return_value = ctx
        return pool

    def test_rag_query_with_shadow_vector(self):
        conn = FakeConn(fetch_rows=[_chunk_row()])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                with patch.object(
                    insights,
                    "retrieve_chunks_vector_shadow",
                    AsyncMock(
                        return_value={
                            "status": "ok",
                            "candidate_count": 1,
                            "chunks": [_chunk_row()],
                            "chunk_ids": ["c1"],
                            "latency_ms": 5.0,
                            "embedded_chunks": 10,
                            "unweighted_candidate_count": 1,
                            "unweighted_chunks": [_chunk_row()],
                            "unweighted_chunk_ids": ["c1"],
                        }
                    ),
                ):
                    env = _run(
                        insights.rag_query(user_id="u1", question="listing price", shadow_vector=True)
                    )
        self.assertIn("shadow_vector", env.get("details", {}))

    def test_rag_query_shadow_debug_diagnostics(self):
        conn = FakeConn(fetch_rows=[_chunk_row()])
        shadow_payload = {
            "status": "ok",
            "candidate_count": 1,
            "chunks": [_chunk_row()],
            "chunk_ids": ["c1"],
            "latency_ms": 5.0,
            "embedded_chunks": 10,
            "shadow_diagnostics": {
                "enabled": True,
                "timings_ms": {"total": 5},
                "counts": {"selected_count": 1},
                "overlap": {"count": 0},
            },
        }
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                with patch.object(
                    insights,
                    "retrieve_chunks_vector_shadow",
                    AsyncMock(return_value=shadow_payload),
                ):
                    env = _run(
                        insights.rag_query(
                            user_id="u1",
                            question="listing price",
                            shadow_vector=True,
                            shadow_debug=True,
                        )
                    )
        details = env.get("details", {})
        self.assertIn("shadow_diagnostics", details)
        self.assertEqual(details["shadow_diagnostics"]["counts"]["selected_count"], 1)

    def test_rag_query_without_shadow_debug_omits_diagnostics(self):
        conn = FakeConn(fetch_rows=[_chunk_row()])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                with patch.object(
                    insights,
                    "retrieve_chunks_vector_shadow",
                    AsyncMock(
                        return_value={
                            "status": "ok",
                            "candidate_count": 1,
                            "chunks": [_chunk_row()],
                            "chunk_ids": ["c1"],
                            "latency_ms": 5.0,
                            "embedded_chunks": 10,
                        }
                    ),
                ):
                    env = _run(
                        insights.rag_query(user_id="u1", question="listing price", shadow_vector=True)
                    )
        self.assertNotIn("shadow_diagnostics", env.get("details", {}))

    def test_rag_query_ollama_explanation(self):
        conn = FakeConn(fetch_rows=[_chunk_row()])
        fake_provider = MagicMock()
        fake_provider.name = "ollama"
        fake_provider.explain = AsyncMock(
            return_value={"ok": True, "text": "Summary from excerpts.", "model_used": "llama3.2:1b"}
        )
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("llama3.2:1b", None))):
                with patch.object(insights, "get_provider", return_value=fake_provider):
                    with patch.dict(os.environ, {"AI_MODEL_PROVIDER": "ollama"}, clear=False):
                        env = _run(insights.rag_query(user_id="u1", question="listing price"))
        self.assertIn("explanation", env.get("details", {}))

    def test_record_valuation_degraded_no_record(self):
        conn = FakeConn(fetch_rows=[])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.record_valuation(user_id="u1", record_id="R1"))
        self.assertEqual(env["source_status"], "degraded")

    def test_listing_pricing_advice(self):
        listing = _chunk_row(source_type="listing", content="Price: 55.00 condition good shipping photo")
        conn = FakeConn(fetch_rows=[listing])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                with patch.object(insights, "insert_pricing_recommendation_outbox", AsyncMock(return_value="e1")):
                    env = _run(insights.listing_pricing_advice(user_id="u1", listing_id="L1"))
        self.assertIn(env["contract_id"], ("pricing_recommendation", "listing_pricing_advice"))

    def test_auction_risk_with_signals(self):
        auction = _chunk_row(
            source_type="auction_bid_summary",
            content="Auction active ends: 2026-06-12 bid_count 6 proxy bids 1200 cents",
            metadata={"bid_count": 6, "reserve_met": False},
        )
        conn = FakeConn(fetch_rows=[auction])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.auction_risk(user_id="u1", listing_id="L1"))
        self.assertIn("signals", env.get("details", {}))

    def test_seller_summary(self):
        conn = FakeConn(fetch_rows=[_chunk_row(source_type="listing")])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.seller_summary(user_id="u1"))
        self.assertEqual(env["contract_id"], "seller_sales_summary")

    def test_buyer_collection_summary(self):
        conn = FakeConn(fetch_rows=[_chunk_row(source_type="record")])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.buyer_collection_summary(user_id="u1"))
        self.assertEqual(env["contract_id"], "buyer_collection_summary")

    def test_offer_insights(self):
        obo = _chunk_row(source_type="obo_offer_summary", content="offer counter accepted 3500 cents")
        conn = FakeConn(fetch_rows=[obo])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                with patch.object(insights, "insert_pricing_recommendation_outbox", AsyncMock(return_value="e1")):
                    with patch.object(insights, "publish_python_ai_outbox_tick", AsyncMock(return_value=0)):
                        env = _run(insights.offer_insights(user_id="u1", listing_id="L1"))
        self.assertEqual(env["contract_id"], "pricing_recommendation")


class TestVectorShadowNonRoute(unittest.TestCase):
    def test_non_route_vector_ok(self):
        conn = FakeConn(fetchval=10, fetch_rows=[_chunk_row()])

        with patch("app.ai.rag_retrieval._embed_query_vector", AsyncMock(return_value=[0.1] * 768)):
            with patch(
                "app.ai.rag_retrieval._fetch_vector_rows",
                AsyncMock(return_value=[_chunk_row()]),
            ):
                result = _run(retrieve_chunks_vector_shadow(conn, query="marketplace", user_id=None))
        self.assertEqual(result["status"], "ok")
        self.assertNotIn("profile", result)


class TestRegistryProviders(unittest.TestCase):
    def test_get_provider_ollama(self):
        with patch.dict(os.environ, {"AI_MODEL_PROVIDER": "ollama"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.providers.registry as reg

            reload(cfg)
            reload(reg)
            self.assertEqual(reg.get_provider("ollama").name, "ollama")
            self.assertEqual(reg.get_provider("hf").name, "hf")

    def test_resolve_model_used_ollama_unavailable(self):
        with patch.dict(os.environ, {"AI_MODEL_PROVIDER": "ollama"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.providers.registry as reg

            reload(cfg)
            reload(reg)
            with patch.object(reg._ollama, "status", AsyncMock(return_value={"available": False, "reason": "offline"})):
                model, reason = _run(reg.resolve_model_used())
            self.assertEqual(model, "rule-engine")
            self.assertEqual(reason, "offline")


class TestOutboxPublishMock(unittest.TestCase):
    def test_publish_outbox_with_mock_producer(self):
        conn = FakeConn(
            fetch_rows=[
                {"id": "e1", "aggregate_id": "L1", "payload": b'{"metadata":{},"payload":{}}'},
            ]
        )
        producer = MagicMock()
        producer.start = AsyncMock()
        producer.stop = AsyncMock()
        producer.send_and_wait = AsyncMock()

        with patch("app.ai.outbox._kafka_producer", AsyncMock(return_value=producer)):
            n = _run(publish_python_ai_outbox_tick(conn, limit=1))
        self.assertEqual(n, 1)
        producer.send_and_wait.assert_called_once()


class TestShadowProfilesEdge(unittest.TestCase):
    def test_generic_rag_hints_empty_profile(self):
        from app.ai.shadow_profiles import expand_query_with_hints

        expanded, terms, applied = expand_query_with_hints("q", "generic_rag", apply_profile_hints=True)
        self.assertTrue(applied)
        self.assertIn("marketplace", expanded)


class TestInsightsDegradedPaths(unittest.TestCase):
    def _mock_pool(self, conn):
        pool = MagicMock()
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=conn)
        ctx.__aexit__ = AsyncMock(return_value=None)
        pool.acquire.return_value = ctx
        return pool

    def test_coerce_metadata_branches(self):
        self.assertEqual(insights._coerce_metadata(None), {})
        self.assertEqual(insights._coerce_metadata({"a": 1})["a"], 1)
        self.assertEqual(insights._coerce_metadata('{"b": 2}')["b"], 2)
        self.assertEqual(insights._coerce_metadata("not-json"), {})
        self.assertEqual(insights._coerce_metadata(42), {})

    def test_listing_pricing_no_listing(self):
        conn = FakeConn(fetch_rows=[])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.listing_pricing_advice(user_id="u1", listing_id="L1"))
        self.assertEqual(env["source_status"], "degraded")

    def test_auction_risk_no_listing(self):
        conn = FakeConn(fetch_rows=[])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.auction_risk(user_id="u1", listing_id="L1"))
        self.assertEqual(env["source_status"], "degraded")

    def test_buyer_collection_empty(self):
        conn = FakeConn(fetch_rows=[])
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.buyer_collection_summary(user_id="u1"))
        self.assertEqual(env["source_status"], "degraded")

    def test_record_valuation_with_comps(self):
        record = _chunk_row(source_type="record", content="Price: 30.00")
        comp = _chunk_row(id="c2", source_type="listing", source_id="L2", content="3500 cents")
        conn = FakeConn(fetch_rows=[record])

        async def fetch_side_effect(sql, *params):
            if "source_id = $" in sql and params:
                return [record]
            return [comp]

        conn.fetch = AsyncMock(side_effect=fetch_side_effect)
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.record_valuation(user_id="u1", record_id="R1"))
        self.assertEqual(env["source_status"], "live")

    def test_offer_insights_stale_when_no_obo_chunks(self):
        listing = _chunk_row(source_type="listing", content="Price: 10.00")

        async def fetch_side_effect(sql, *params):
            for p in params:
                if isinstance(p, list) and "obo_offer_summary" in p:
                    return []
            return [listing]

        conn = FakeConn(fetch_rows=[listing])
        conn.fetch = AsyncMock(side_effect=fetch_side_effect)
        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                env = _run(insights.offer_insights(user_id=None, listing_id="L1"))
        codes = [s["code"] for s in env.get("details", {}).get("signals", [])]
        self.assertIn("stale_offer", codes)


class TestRagRetrievalExtras(unittest.TestCase):
    def test_metadata_listing_id_filter(self):
        conn = FakeConn(fetch_rows=[_chunk_row()])
        result = _run(
            retrieve_chunks(conn, query="", user_id="u1", metadata_listing_id="ML1")
        )
        self.assertEqual(len(result["chunks"]), 1)

    def test_shadow_diagnostic_error_status(self):
        from app.ai.rag_retrieval import build_shadow_vector_diagnostic

        diag = build_shadow_vector_diagnostic(
            [],
            {"status": "embed_failed", "error": "timeout", "chunks": [], "chunk_ids": []},
        )
        self.assertEqual(diag["status"], "embed_failed")
        self.assertEqual(diag["error"], "timeout")

    def test_coerce_metadata_non_dict_json(self):
        from app.ai.rag_retrieval import _coerce_metadata

        self.assertEqual(_coerce_metadata("[1,2]"), {})


class TestOutboxKafkaDisabled(unittest.TestCase):
    def test_kafka_producer_ssl_off(self):
        from importlib import reload
        import app.ai.outbox as ob

        with patch.dict(os.environ, {"KAFKA_USE_SSL": "false"}, clear=False):
            reload(ob)
            prod = _run(ob._kafka_producer())
        self.assertIsNone(prod)


if __name__ == "__main__":
    unittest.main()
