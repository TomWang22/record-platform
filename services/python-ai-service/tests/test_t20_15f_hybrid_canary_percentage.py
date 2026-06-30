"""T20.15F — Hybrid canary percentage gate tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai import insights  # noqa: E402
from app.ai.hybrid_canary import (  # noqa: E402
    evaluate_hybrid_canary_gate,
    in_percentage_cohort,
    percentage_bucket,
)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _reload_hybrid_modules():
    from importlib import reload
    import app.ai.config as cfg
    import app.ai.hybrid_canary as hc

    reload(cfg)
    reload(hc)
    reload(insights)
    return cfg, hc


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
                "shadow_plus_anchor_doc_overlap": 1,
                "shadow_plus_anchor_entity_overlap": 1,
            },
        },
    }


class TestPercentageBucket(unittest.TestCase):
    def test_same_user_id_same_bucket(self) -> None:
        uid = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
        self.assertEqual(percentage_bucket(uid), percentage_bucket(uid.upper()))

    def test_buckets_in_range(self) -> None:
        samples = [
            "00000000-0000-0000-0000-000000000001",
            "11111111-1111-1111-1111-111111111111",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
        ]
        for uid in samples:
            bucket = percentage_bucket(uid)
            self.assertGreaterEqual(bucket, 0)
            self.assertLessEqual(bucket, 99)

    def test_different_uuids_can_differ(self) -> None:
        buckets = {
            percentage_bucket(f"{i:08x}-0000-0000-0000-000000000000")
            for i in range(32)
        }
        self.assertGreater(len(buckets), 1)


class TestPercentageCohort(unittest.TestCase):
    def test_percent_zero_excludes_all(self) -> None:
        uid = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
        self.assertFalse(in_percentage_cohort(uid, 0))
        self.assertFalse(in_percentage_cohort(uid, -1))

    def test_percent_one_includes_only_bucket_zero(self) -> None:
        included = []
        excluded = []
        for i in range(200):
            uid = f"{i:08x}-0000-0000-0000-000000000000"
            if percentage_bucket(uid) == 0:
                included.append(uid)
            else:
                excluded.append(uid)
        self.assertTrue(included)
        for uid in included:
            self.assertTrue(in_percentage_cohort(uid, 1))
        for uid in excluded[:20]:
            self.assertFalse(in_percentage_cohort(uid, 1))

    def test_percent_over_100_clamped(self) -> None:
        uid = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
        self.assertTrue(in_percentage_cohort(uid, 150))

    def test_percent_five_includes_buckets_0_through_4(self) -> None:
        in_cohort = {
            0: "00000040-0000-4000-8000-000000000000",
            1: "0000002a-0000-4000-8000-000000000000",
            4: "0000001b-0000-4000-8000-000000000000",
        }
        out_cohort = {
            5: "00000047-0000-4000-8000-000000000000",
            9: "5a68fe88-c134-4166-b145-57534a3656b9",
        }
        for b, uid in in_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertTrue(in_percentage_cohort(uid, 5))
        for b, uid in out_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertFalse(in_percentage_cohort(uid, 5))

    def test_percent_ten_includes_buckets_0_through_9(self) -> None:
        in_cohort = {
            0: "00000040-0000-4000-8000-000000000000",
            1: "0000002a-0000-4000-8000-000000000000",
            9: "5a68fe88-c134-4166-b145-57534a3656b9",
        }
        out_cohort = {
            10: "000001bc-0000-4000-8000-000000000000",
            11: "0000009a-0000-4000-8000-000000000000",
            15: "2ed75568-7deb-4c29-91b0-6919f24a0c9f",
        }
        for b, uid in in_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertTrue(in_percentage_cohort(uid, 10))
        for b, uid in out_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertFalse(in_percentage_cohort(uid, 10))

    def test_percent_twenty_five_includes_buckets_0_through_24(self) -> None:
        in_cohort = {
            0: "00000040-0000-4000-8000-000000000000",
            1: "0000002a-0000-4000-8000-000000000000",
            9: "5a68fe88-c134-4166-b145-57534a3656b9",
            10: "000001bc-0000-4000-8000-000000000000",
            20: "00000002-0000-4000-8000-000000000000",
        }
        out_cohort = {
            25: "0000003b-0000-4000-8000-000000000000",
            26: "00000033-0000-4000-8000-000000000000",
            30: "000000f4-0000-4000-8000-000000000000",
        }
        for b, uid in in_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertTrue(in_percentage_cohort(uid, 25))
        for b, uid in out_cohort.items():
            self.assertEqual(percentage_bucket(uid), b)
            self.assertFalse(in_percentage_cohort(uid, 25))


class TestGateEvaluation(unittest.TestCase):
    def test_percent_zero_non_allowlisted_keyword_default(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "",
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            gate = hc.evaluate_hybrid_canary_gate("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            self.assertFalse(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "keyword_default")

    def test_allowlist_overrides_percent_zero(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            gate = hc.evaluate_hybrid_canary_gate("u-allow")
            self.assertTrue(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "allowlist")

    def test_unauthenticated_keyword_default(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_RAG_HYBRID_CANARY": "1", "AI_RAG_HYBRID_CANARY_PERCENT": "5"},
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            gate = hc.evaluate_hybrid_canary_gate(None)
            self.assertFalse(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "keyword_default")

    def test_invalid_user_id_keyword_default(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_RAG_HYBRID_CANARY": "1", "AI_RAG_HYBRID_CANARY_PERCENT": "5"},
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            gate = hc.evaluate_hybrid_canary_gate("not-a-uuid")
            self.assertFalse(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "keyword_default")

    def test_prod_percent_blocked(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_PERCENT": "5",
                "KUBERNETES_NAMESPACE": "record-platform",
                "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT": "0",
            },
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            gate = hc.evaluate_hybrid_canary_gate(uid)
            self.assertFalse(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "prod_percent_blocked")

    def test_prod_percent_allowed_when_flag_set(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_PERCENT": "100",
                "KUBERNETES_NAMESPACE": "record-platform",
                "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT": "1",
            },
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            gate = hc.evaluate_hybrid_canary_gate(uid)
            self.assertTrue(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "percentage")

    def test_percentage_gate_reason(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_PERCENT": "100",
            },
            clear=False,
        ):
            _, hc = _reload_hybrid_modules()
            uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            gate = hc.evaluate_hybrid_canary_gate(uid)
            self.assertTrue(gate.canary_allowed)
            self.assertEqual(gate.gate_reason, "percentage")
            self.assertTrue(gate.percentage_cohort)


class TestRagQueryPercentageIntegration(unittest.TestCase):
    def test_non_allowlisted_percent_zero_stays_keyword(self) -> None:
        async def run() -> Dict[str, Any]:
            with patch.dict(
                os.environ,
                {
                    "AI_RAG_HYBRID_CANARY": "1",
                    "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "",
                    "AI_RAG_HYBRID_CANARY_PERCENT": "0",
                },
                clear=False,
            ):
                _reload_hybrid_modules()
                with patch("app.ai.insights.get_pool", AsyncMock(return_value=MagicMock())):
                    pool = await insights.get_pool()
                    conn = AsyncMock()
                    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
                    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
                    with patch("app.ai.insights.retrieve_chunks", AsyncMock(return_value=_keyword_result())):
                        with patch("app.ai.insights.retrieve_chunks_vector_shadow", AsyncMock()) as shadow_mock:
                            with patch(
                                "app.ai.insights.resolve_model_used",
                                AsyncMock(return_value=("rule-engine", None)),
                            ):
                                env = await insights.rag_query(
                                    user_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                                    question="What should I list today?",
                                )
            shadow_mock.assert_not_called()
            return env

        env = _run(run())
        self.assertEqual(env["details"]["retrieval_mode"], "keyword")
        diag = env["details"]["hybrid_canary"]
        self.assertEqual(diag["gate_reason"], "keyword_default")

    def test_keyword_fallback_still_works(self) -> None:
        async def run() -> Dict[str, Any]:
            with patch.dict(
                os.environ,
                {
                    "AI_RAG_HYBRID_CANARY": "1",
                    "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "u-allow",
                },
                clear=False,
            ):
                _reload_hybrid_modules()
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
                            with patch(
                                "app.ai.insights.resolve_model_used",
                                AsyncMock(return_value=("rule-engine", None)),
                            ):
                                return await insights.rag_query(
                                    user_id="u-allow",
                                    question="What should I list today?",
                                )

        env = _run(run())
        self.assertEqual(env["details"]["retrieval_mode"], "keyword_fallback_from_hybrid")
        self.assertTrue(env["details"]["hybrid_canary"]["hybrid_fallback"])

    def test_no_forbidden_leakage_strings(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
