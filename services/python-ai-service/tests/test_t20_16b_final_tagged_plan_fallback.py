"""T20.16B — final_tagged_plan hybrid fallback remediation tests."""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.hybrid_canary import (  # noqa: E402
    FINAL_TAGGED_PLAN_PROMPT_CLASS,
    TAGGED_EXECUTIVE_SUMMARY_RETRIEVAL_QUERY,
    evaluate_hybrid_canary_gate,
    hybrid_failure_reason,
    refine_hybrid_fallback_reason,
    resolve_hybrid_retrieval_plan,
)
from app.ai.rag_retrieval import (  # noqa: E402
    FORBIDDEN_CHUNK_RE,
    _keyword_chunk_passes_anchor_privacy,
    _select_keyword_anchor_chunks,
)
from app.ai.rag_synthesis import classify_rag_intent  # noqa: E402


FINAL_PROMPT = (
    "Give me a 10-bullet plan tagged [grounded], [missing evidence], "
    "or [needs manual review]."
)
LISTING_PROMPT = "Which of my listings need attention first, and why?"


class TestFinalTaggedPlanFallback(unittest.TestCase):
    def test_resolve_expansion_only_for_tagged_executive_summary(self) -> None:
        plan = resolve_hybrid_retrieval_plan(FINAL_PROMPT)
        self.assertEqual(plan.prompt_class, FINAL_TAGGED_PLAN_PROMPT_CLASS)
        self.assertTrue(plan.query_expanded)
        self.assertEqual(plan.retrieval_query, TAGGED_EXECUTIVE_SUMMARY_RETRIEVAL_QUERY)
        self.assertEqual(classify_rag_intent(FINAL_PROMPT), "tagged_executive_summary")

        unchanged = resolve_hybrid_retrieval_plan(LISTING_PROMPT)
        self.assertIsNone(unchanged.prompt_class)
        self.assertFalse(unchanged.query_expanded)
        self.assertEqual(unchanged.retrieval_query, LISTING_PROMPT)

    def test_explicit_fallback_reason_when_hybrid_still_empty(self) -> None:
        reason = refine_hybrid_fallback_reason(
            prompt_class=FINAL_TAGGED_PLAN_PROMPT_CLASS,
            generic_reason="true_zero_result",
        )
        self.assertEqual(reason, "final_tagged_plan_insufficient_hybrid_evidence")

        other = refine_hybrid_fallback_reason(
            prompt_class=None,
            generic_reason="true_zero_result",
        )
        self.assertEqual(other, "true_zero_result")

    def test_keyword_anchor_top_up_respects_cap(self) -> None:
        chunks = [
            {
                "id": f"kw-{i}",
                "source_type": "listing",
                "source_id": f"L{i}",
                "content": f"listing excerpt {i}",
            }
            for i in range(5)
        ]
        anchors = _select_keyword_anchor_chunks(chunks, existing_ids=[], max_anchors=2)
        self.assertEqual(len(anchors), 2)
        self.assertTrue(all(a.get("keyword_anchor_added") for a in anchors))

    def test_privacy_filter_blocks_forbidden_chunks(self) -> None:
        bad = {
            "id": "bad-1",
            "source_type": "auction_bid_summary",
            "content": "proxy_bids max_bid_cents leak",
        }
        self.assertFalse(_keyword_chunk_passes_anchor_privacy(bad))
        self.assertTrue(FORBIDDEN_CHUNK_RE.search(bad["content"]))
        anchors = _select_keyword_anchor_chunks([bad], existing_ids=[])
        self.assertEqual(anchors, [])

    def test_hybrid_failure_reason_values_remain_valid(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            shadow_ok = {
                "status": "ok",
                "chunks": [{"source_type": "listing", "source_id": "L1", "content": "x"}],
                "shadow_diagnostics": {"debug": {}, "embed": {}},
            }
            shadow_zero = {
                "status": "ok",
                "chunks": [],
                "shadow_diagnostics": {
                    "debug": {"true_zero_result_after_fallback": True},
                    "embed": {},
                },
            }
            self.assertIsNone(hybrid_failure_reason(gate=gate, shadow=shadow_ok))
            self.assertEqual(
                hybrid_failure_reason(gate=gate, shadow=shadow_zero),
                "true_zero_result",
            )

    def test_keyword_fallback_remains_when_hybrid_fails(self) -> None:
        gate = evaluate_hybrid_canary_gate(None)
        self.assertFalse(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "keyword_default")


if __name__ == "__main__":
    unittest.main()
