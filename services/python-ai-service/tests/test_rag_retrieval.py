"""T15.3B — RAG retrieval privacy and source_ref unit tests (no model downloads)."""
from __future__ import annotations

import asyncio
import os
import re
import sys
import unittest
from typing import Any, Dict, List

# Allow `python services/python-ai-service/tests/test_rag_retrieval.py`
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.envelope import build_envelope, source_ref  # noqa: E402
from app.ai.providers.rule_engine import (  # noqa: E402
    auction_risk_signals,
    listing_quality_checklist,
    pricing_band_from_chunks,
)
from app.ai.rag_retrieval import FORBIDDEN_CHUNK_RE  # noqa: E402


class TestRuleEngine(unittest.TestCase):
    def test_pricing_band_from_chunks(self):
        chunks = [{"content": "Price: 42.50\nComparable 3500 cents"}]
        band = pricing_band_from_chunks(chunks)
        self.assertIsNotNone(band["mid"])

    def test_auction_risk_signals(self):
        text = "Auction active ends: 2026-06-12 bid_count 6 proxy bids 1200 cents"
        signals = auction_risk_signals(text, {"bid_count": 6, "reserve_met": False})
        codes = {s["code"] for s in signals}
        self.assertIn("bid_spike", codes)
        self.assertIn("ending_soon", codes)

    def test_listing_quality_checklist(self):
        tips = listing_quality_checklist("short")
        areas = {t["area"] for t in tips}
        self.assertIn("description", areas)


class TestEnvelope(unittest.TestCase):
    def test_live_requires_source_refs(self):
        env = build_envelope(
            "rag_query",
            source_status="live",
            model_used="rule-engine",
            summary="Grounded excerpt retrieved.",
            source_refs=[],
        )
        self.assertEqual(env["source_status"], "degraded")
        self.assertEqual(env["degraded_reason"], "no_source_refs")

    def test_forbidden_prose_rejected(self):
        with self.assertRaises(ValueError):
            build_envelope(
                "rag_query",
                source_status="degraded",
                model_used="none",
                summary="This is a mock response",
            )


class TestShadowProfiles(unittest.TestCase):
    def test_unknown_profile_falls_back_to_generic(self):
        from app.ai.shadow_profiles import resolve_shadow_profile

        self.assertEqual(resolve_shadow_profile(None), "generic_rag")
        self.assertEqual(resolve_shadow_profile(""), "generic_rag")
        self.assertEqual(resolve_shadow_profile("not_a_real_profile"), "generic_rag")

    def test_auction_risk_prefers_auction_type(self):
        from app.ai.shadow_profiles import source_type_weights

        weights = source_type_weights("auction_risk")
        self.assertGreater(
            weights.get("auction_bid_summary", 0),
            weights.get("listing", 0),
        )

    def test_pricing_recommendation_alias(self):
        from app.ai.shadow_profiles import resolve_shadow_profile

        self.assertEqual(resolve_shadow_profile("pricing_recommendation"), "obo_helper")
    def test_proxy_max_pattern(self):
        self.assertTrue(FORBIDDEN_CHUNK_RE.search("max_bid_cents exposed"))
        self.assertFalse(FORBIDDEN_CHUNK_RE.search("current bid 1200 cents"))


class TestRetrievalPrivacyIntegration(unittest.TestCase):
    """Runs against python_ai DB when POSTGRES_URL_PYTHON_AI is reachable."""

    @classmethod
    def setUpClass(cls):
        cls.db_url = os.getenv(
            "POSTGRES_URL_PYTHON_AI",
            "postgresql://postgres:postgres@127.0.0.1:5440/python_ai",
        )
        try:
            import asyncpg  # noqa: WPS433
        except ImportError:
            cls.skip_reason = "asyncpg not installed"
            return
        cls.skip_reason = None

    def _run(self, coro):
        if self.skip_reason:
            self.skipTest(self.skip_reason)
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_owner_doc_not_visible_to_other_user(self):
        async def run():
            import asyncpg
            from app.ai.rag_retrieval import retrieve_chunks

            conn = await asyncpg.connect(self.db_url)
            try:
                row = await conn.fetchrow(
                    """
                    SELECT owner_user_id, source_id FROM ai.ai_documents
                    WHERE visibility = 'owner' AND owner_user_id IS NOT NULL
                    LIMIT 1
                    """
                )
                if not row:
                    return "skip", "no owner docs"
                owner = row["owner_user_id"]
                other = "00000000-0000-4000-8000-000000000099"
                self.assertNotEqual(owner, other)
                owned = await retrieve_chunks(
                    conn, query="", user_id=owner, source_id=row["source_id"], max_chunks=5
                )
                foreign = await retrieve_chunks(
                    conn, query="", user_id=other, source_id=row["source_id"], max_chunks=5
                )
                if owned["chunks"] and foreign["chunks"]:
                    raise AssertionError("foreign user retrieved owner-only chunks")
                return "ok", None
            finally:
                await conn.close()

        status, detail = self._run(run())
        if status == "skip":
            self.skipTest(detail)

    def test_no_proxy_max_in_retrieval(self):
        async def run():
            import asyncpg
            from app.ai.rag_retrieval import retrieve_chunks

            conn = await asyncpg.connect(self.db_url)
            try:
                result = await retrieve_chunks(conn, query="auction bid proxy max", user_id=None, max_chunks=20)
                for ch in result["chunks"]:
                    if FORBIDDEN_CHUNK_RE.search(ch.get("content") or ""):
                        raise AssertionError("proxy max leaked into retrieval")
                return True
            finally:
                await conn.close()

        self._run(run())

    def test_messages_absent_without_opt_in(self):
        async def run():
            import asyncpg
            from app.ai.rag_retrieval import retrieve_chunks

            conn = await asyncpg.connect(self.db_url)
            try:
                result = await retrieve_chunks(conn, query="message thread", user_id=None, max_chunks=30)
                for ch in result["chunks"]:
                    if ch.get("source_type") == "message":
                        raise AssertionError("message doc without opt-in retrieved")
                return True
            finally:
                await conn.close()

        self._run(run())

    def test_source_refs_always_present_when_chunks(self):
        async def run():
            import asyncpg
            from app.ai.rag_retrieval import retrieve_chunks

            conn = await asyncpg.connect(self.db_url)
            try:
                result = await retrieve_chunks(conn, query="listing price", user_id=None, max_chunks=5)
                if result["chunks"]:
                    self.assertTrue(result["source_refs"])
                    for ref in result["source_refs"]:
                        self.assertIn("source_type", ref)
                        self.assertIn("source_id", ref)
                return True
            finally:
                await conn.close()

        self._run(run())


if __name__ == "__main__":
    unittest.main()
