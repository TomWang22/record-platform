"""P21.3 — Session memory unit and multi-turn flow tests."""
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
from app.ai.session_memory import (
    SessionMemoryStore,
    augment_question_with_memory,
    build_synthesis_context,
    extract_preferences_constraints,
    sanitize_memory_text,
    store,
    update_session_from_turn,
)

FORBIDDEN = (
    "message_body",
    "thread_text",
    "private obo message",
    "proxy_bids",
    "max_bid_cents",
)

TURN_PROMPTS = (
    "I care more about moving stale inventory than maximizing top dollar, "
    "but I do not want to undersell rare jazz records.",
    "Based on my seller data, give me a prioritized action plan.",
    "Review that plan for overclaims about rarity, buyer psychology, and auction urgency.",
    "Give me a final 10-bullet plan tagged [grounded], [missing evidence], "
    "or [needs manual review].",
)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _chunk_row(**kwargs):
    base = {
        "id": "c1",
        "document_id": "d1",
        "chunk_index": 0,
        "content": "Seller listing: Jazz LP Status: active Price: 45.00",
        "checksum": "x",
        "source_refs": [],
        "source_type": "listing",
        "source_id": "L1",
        "owner_user_id": "u1",
        "visibility": "public",
        "source_updated_at": None,
        "title": "Jazz LP",
        "metadata": {},
        "score": 2,
    }
    base.update(kwargs)
    return base


class FakeConn:
    def __init__(self, fetch_rows=None):
        self._fetch_rows = fetch_rows or []

    async def fetch(self, sql, *params):
        return self._fetch_rows

    async def fetchval(self, sql, *params):
        return 0

    async def execute(self, sql, *params):
        return None


class TestSessionMemorySanitizer(unittest.TestCase):
    def test_sanitize_rejects_forbidden(self):
        self.assertIsNone(sanitize_memory_text("see message_body here"))

    def test_sanitize_rejects_json_dump(self):
        self.assertIsNone(sanitize_memory_text('{"message_body": "secret"}'))

    def test_extract_stale_jazz_preferences(self):
        prefs, constraints = extract_preferences_constraints(TURN_PROMPTS[0])
        self.assertTrue(any("stale inventory" in p.lower() for p in prefs))
        self.assertTrue(any("jazz" in c.lower() for c in constraints))


class TestSessionMemoryStore(unittest.TestCase):
    def setUp(self):
        self._local = SessionMemoryStore(ttl_seconds=3600)

    def test_user_isolation(self):
        a = self._local.start("user-a")
        self.assertIsNone(self._local.get(a.session_id, "user-b"))

    def test_reset(self):
        a = self._local.start("user-a")
        self.assertTrue(self._local.reset(a.session_id, "user-a"))
        self.assertIsNone(self._local.get(a.session_id, "user-a"))


class TestSessionMemoryFourTurn(unittest.TestCase):
    def setUp(self):
        self._orig_store = insights.session_store
        insights.session_store = SessionMemoryStore(ttl_seconds=3600)
        self._store = insights.session_store

    def tearDown(self):
        insights.session_store = self._orig_store

    def _mock_pool(self, conn):
        pool = MagicMock()
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=conn)
        ctx.__aexit__ = AsyncMock(return_value=None)
        pool.acquire.return_value = ctx
        return pool

    def test_four_turn_session_flow(self):
        obo = _chunk_row(
            source_type="obo_offer_summary",
            content="Status: countered Amount: 4136 USD",
            source_id="O1",
        )
        listing = _chunk_row(source_type="listing", source_id="L1")
        conn = FakeConn(fetch_rows=[listing, obo])

        start = _run(insights.session_start(user_id="u1"))
        self.assertEqual(start["contract_id"], "session_start")
        session_id = start["details"]["session_memory"]["session_id"]
        self.assertTrue(session_id)

        templates = []
        summaries = []
        turn_counts = []

        with patch.object(insights, "get_pool", AsyncMock(return_value=self._mock_pool(conn))):
            with patch.object(insights, "resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                for prompt in TURN_PROMPTS:
                    env = _run(
                        insights.session_query(
                            user_id="u1",
                            session_id=session_id,
                            question=prompt,
                        )
                    )
                    self.assertEqual(env["contract_id"], "session_query")
                    self.assertEqual(env["model_used"], "rule-engine")
                    self.assertEqual(env["details"]["retrieval_mode"], "keyword")
                    mem = env["details"]["session_memory"]
                    turn_counts.append(mem["turn_count"])
                    templates.append(env["details"]["synthesis"]["template"])
                    summaries.append(env["summary"])
                    blob = (env["summary"] + str(mem)).lower()
                    for term in FORBIDDEN:
                        self.assertNotIn(term, blob)

        self.assertEqual(turn_counts, [1, 2, 3, 4])
        prefs_blob = " ".join(
            _run(insights.session_get(user_id="u1", session_id=session_id))["details"]["session_memory"]["preferences"]
        ).lower()
        self.assertIn("stale inventory", prefs_blob)
        self.assertTrue(
            any("jazz" in c.lower() for c in _run(insights.session_get(user_id="u1", session_id=session_id))["details"]["session_memory"]["constraints"])
        )

        final_summary = summaries[-1].lower()
        self.assertEqual(templates[-1], "tagged_executive_summary")
        self.assertIn("[grounded]", summaries[-1])
        self.assertIn("[missing evidence]", summaries[-1])
        self.assertIn("[needs manual review]", summaries[-1])
        self.assertTrue(
            "stale inventory" in final_summary or "stale inventory" in build_synthesis_context(
                self._store.get(session_id, "u1")  # type: ignore[arg-type]
            ).lower()
        )
        self.assertTrue("rare jazz" in final_summary or "jazz" in final_summary)

    def test_augment_includes_memory_after_first_turn(self):
        state = self._store.start("u1")
        update_session_from_turn(
            state,
            prompt=TURN_PROMPTS[0],
            summary="Re-ranked seller advice with your tradeoff preferences.",
            source_refs=[{"source_type": "listing", "source_id": "L1"}],
            synthesis={"template": "seller_tradeoff", "caveats": []},
        )
        augmented = augment_question_with_memory(TURN_PROMPTS[3], self._store.get(state.session_id, "u1"))
        self.assertIn("ACCUMULATED SESSION CONTEXT", augmented)
        self.assertIn("stale inventory", augmented.lower())
        self.assertIn("rare jazz", augmented.lower())


class TestSessionRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig_store = insights.session_store
        insights.session_store = SessionMemoryStore(ttl_seconds=3600)
        app = FastAPI()
        app.include_router(routes.router)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        insights.session_store = cls._orig_store

    def test_start_and_get_routes(self):
        start = self.client.post(
            "/ai/session/start",
            json={"user_id": "u-route"},
            headers={"x-user-id": "u-route"},
        )
        self.assertEqual(start.status_code, 200)
        body = start.json()
        sid = body["details"]["session_memory"]["session_id"]
        got = self.client.get(f"/ai/session/{sid}", headers={"x-user-id": "u-route"})
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.json()["details"]["session_memory"]["turn_count"], 0)


if __name__ == "__main__":
    unittest.main()
