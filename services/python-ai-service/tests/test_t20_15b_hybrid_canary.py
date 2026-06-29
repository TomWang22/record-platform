"""T20.15B — Hybrid canary gate tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai import insights  # noqa: E402
from app.ai.hybrid_canary import (  # noqa: E402
    build_hybrid_canary_diagnostics,
    evaluate_hybrid_canary_gate,
    hybrid_failure_reason,
    hybrid_succeeded,
)
from app.ai.rag_retrieval import retrieve_chunks  # noqa: E402


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _keyword_result() -> Dict[str, Any]:
    return {
        "chunks": [
            {
                "id": "kw-1",
                "source_type": "listing",
                "source_id": "L1",
                "content": "safe listing excerpt",
                "checksum": "x",
            }
        ],
        "source_refs": [{"source_type": "listing", "source_id": "L1"}],
        "retrieval_mode": "keyword",
    }


def _hybrid_shadow() -> Dict[str, Any]:
    return {
        "status": "ok",
        "chunks": [
            {
                "id": "hy-1",
                "source_type": "listing_revision",
                "source_id": "L1",
                "content": "revision excerpt",
                "checksum": "y",
            }
        ],
        "shadow_diagnostics": {
            "embed": {"timed_out": False},
            "overlap": {"document_overlap_count": 1, "entity_overlap_count": 1},
            "debug": {
                "pure_vector_doc_overlap": 0,
                "pure_vector_entity_overlap": 0,
                "shadow_plus_anchor_doc_overlap": 1,
                "shadow_plus_anchor_entity_overlap": 1,
                "overlap_anchor_added": True,
                "overlap_anchor_count": 1,
                "entity_expansion_added_count": 1,
                "keyword_anchor_added": False,
            },
        },
    }


class TestHybridCanaryGates(unittest.TestCase):
    def test_non_allowlisted_user_blocked(self) -> None:
        with patch.dict(os.environ, {"AI_RAG_HYBRID_CANARY": "1", "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("other-user")
            self.assertFalse(gate.canary_allowed)

    def test_allowlisted_user_allowed_when_enabled(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("u-allow")
            self.assertTrue(gate.canary_allowed)

    def test_canary_disabled_blocks_allowlisted_user(self) -> None:
        with patch.dict(os.environ, {"AI_RAG_HYBRID_CANARY": "0", "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow"}, clear=False):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("u-allow")
            self.assertFalse(gate.canary_allowed)

    def test_percent_gt_zero_blocks_canary(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                "AI_RAG_HYBRID_CANARY_PERCENT": "5",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("u-allow")
            self.assertFalse(gate.canary_allowed)
            self.assertTrue(gate.percent_blocked)


class TestHybridCanaryDiagnostics(unittest.TestCase):
    def test_pure_vs_anchored_not_conflated(self) -> None:
        gate = evaluate_hybrid_canary_gate(None)
        diag = build_hybrid_canary_diagnostics(
            gate=gate,
            keyword_result=_keyword_result(),
            shadow=_hybrid_shadow(),
            keyword_latency_ms=12.0,
            hybrid_latency_ms=45.0,
            hybrid_fallback=False,
            hybrid_fallback_reason=None,
            hybrid_error=None,
            retrieval_mode="hybrid_canary",
        )
        self.assertEqual(diag["pure_vector_doc_overlap"], 0)
        self.assertEqual(diag["anchored_doc_overlap"], 1)
        self.assertTrue(diag["overlap_anchor_added"])

    def test_hybrid_error_falls_back(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "other",
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("x")
            reason = hc.hybrid_failure_reason(gate=gate, shadow=None, hybrid_error="boom")
            self.assertEqual(reason, "user_not_allowlisted")


class TestRagQueryHybridIntegration(unittest.TestCase):
    def test_non_allowlisted_gets_keyword_only(self) -> None:
        async def run() -> Dict[str, Any]:
            with patch.dict(os.environ, {"AI_RAG_HYBRID_CANARY": "0"}, clear=False):
                with patch("app.ai.insights.get_pool", AsyncMock(return_value=MagicMock())):
                    pool = await insights.get_pool()
                    conn = AsyncMock()
                    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
                    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
                    with patch("app.ai.insights.retrieve_chunks", AsyncMock(return_value=_keyword_result())):
                        with patch("app.ai.insights.retrieve_chunks_vector_shadow", AsyncMock()) as shadow_mock:
                            with patch("app.ai.insights.resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                                return await insights.rag_query(
                                    user_id="not-listed",
                                    question="What should I list today?",
                                )

        env = _run(run())
        self.assertEqual(env["details"]["retrieval_mode"], "keyword")
        shadow_mock = None

    def test_allowlisted_hybrid_canary_path(self) -> None:
        async def run() -> Dict[str, Any]:
            with patch.dict(
                os.environ,
                {
                    "AI_RAG_HYBRID_CANARY": "1",
                    "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                    "AI_RAG_HYBRID_CANARY_PERCENT": "0",
                },
                clear=False,
            ):
                from importlib import reload
                import app.ai.config as cfg
                import app.ai.hybrid_canary as hc

                reload(cfg)
                reload(hc)
                reload(insights)
                with patch("app.ai.insights.get_pool", AsyncMock(return_value=MagicMock())):
                    pool = await insights.get_pool()
                    conn = AsyncMock()
                    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
                    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
                    with patch("app.ai.insights.retrieve_chunks", AsyncMock(return_value=_keyword_result())):
                        with patch(
                            "app.ai.insights.retrieve_chunks_vector_shadow",
                            AsyncMock(return_value=_hybrid_shadow()),
                        ):
                            with patch("app.ai.insights.resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                                return await insights.rag_query(
                                    user_id="u-allow",
                                    question="What should I list today?",
                                )

        env = _run(run())
        self.assertEqual(env["details"]["retrieval_mode"], "hybrid_canary")
        self.assertIn("hybrid_canary", env["details"])
        self.assertEqual(env["model_used"], "rule-engine")

    def test_hybrid_failure_keyword_fallback(self) -> None:
        async def run() -> Dict[str, Any]:
            with patch.dict(
                os.environ,
                {
                    "AI_RAG_HYBRID_CANARY": "1",
                    "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                },
                clear=False,
            ):
                from importlib import reload
                import app.ai.config as cfg
                import app.ai.hybrid_canary as hc

                reload(cfg)
                reload(hc)
                reload(insights)
                with patch("app.ai.insights.get_pool", AsyncMock(return_value=MagicMock())):
                    pool = await insights.get_pool()
                    conn = AsyncMock()
                    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
                    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
                    with patch("app.ai.insights.retrieve_chunks", AsyncMock(return_value=_keyword_result())):
                        with patch(
                            "app.ai.insights.retrieve_chunks_vector_shadow",
                            AsyncMock(return_value={"status": "embed_timed_out", "chunks": []}),
                        ):
                            with patch("app.ai.insights.resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                                return await insights.rag_query(
                                    user_id="u-allow",
                                    question="What should I list today?",
                                )

        env = _run(run())
        self.assertEqual(env["details"]["retrieval_mode"], "keyword_fallback_from_hybrid")
        self.assertTrue(env["details"]["hybrid_canary"]["hybrid_fallback"])

    def test_no_proxy_leakage_in_excerpts(self) -> None:
        bad = _keyword_result()
        bad["chunks"] = [
            {
                "id": "kw-bad",
                "source_type": "listing",
                "source_id": "L1",
                "content": "proxy_bids max_bid_cents hidden",
            }
        ]

        async def run() -> Dict[str, Any]:
            with patch("app.ai.insights.get_pool", AsyncMock(return_value=MagicMock())):
                pool = await insights.get_pool()
                conn = AsyncMock()
                pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
                pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
                with patch("app.ai.insights.retrieve_chunks", AsyncMock(return_value=bad)):
                    with patch("app.ai.insights.resolve_model_used", AsyncMock(return_value=("rule-engine", None))):
                        return await insights.rag_query(user_id="u1", question="safe question")

        env = _run(run())
        joined = " ".join(env["details"]["excerpts"])
        self.assertIn("redacted", joined)


class TestKeywordRetrievalUnchanged(unittest.TestCase):
    def test_retrieve_chunks_still_keyword_mode(self) -> None:
        conn = AsyncMock()
        conn.fetch = AsyncMock(return_value=[])
        result = _run(
            retrieve_chunks(conn, query="listing price", user_id="u1")
        )
        self.assertEqual(result["retrieval_mode"], "keyword")


if __name__ == "__main__":
    unittest.main()
