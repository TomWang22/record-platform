"""T20.25B — Opt-in hybrid preview enrollment and gate tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai import insights  # noqa: E402
from app.ai.hybrid_canary import evaluate_hybrid_canary_gate  # noqa: E402


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


CONTRACT_UID = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
COHORT_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


class TestPreviewEnrollmentGate(unittest.TestCase):
    def test_non_enrolled_keyword_default(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate(COHORT_UID, preview_enrolled=False)
        self.assertFalse(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "keyword_default")

    def test_enrolled_preview_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate(COHORT_UID, preview_enrolled=True)
        self.assertTrue(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "preview_opt_in")

    def test_allowlist_beats_preview(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            gate = hc.evaluate_hybrid_canary_gate(CONTRACT_UID, preview_enrolled=False)
        self.assertTrue(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "allowlist")

    def test_anonymous_blocked(self) -> None:
        gate = evaluate_hybrid_canary_gate(None, preview_enrolled=False)
        self.assertFalse(gate.canary_allowed)
        self.assertEqual(gate.gate_reason, "keyword_default")

    def test_revoked_enrollment_keyword_default(self) -> None:
        gate = evaluate_hybrid_canary_gate(COHORT_UID, preview_enrolled=False)
        self.assertEqual(gate.gate_reason, "keyword_default")

    def test_invalid_uuid_keyword_default(self) -> None:
        gate = evaluate_hybrid_canary_gate("not-a-uuid", preview_enrolled=True)
        self.assertFalse(gate.canary_allowed)


class TestPreviewRagQuery(unittest.TestCase):
    def _keyword_result(self) -> Dict[str, Any]:
        return {
            "chunks": [
                {
                    "id": "kw-1",
                    "source_type": "listing",
                    "source_id": "L1",
                    "content": "listing price shipping",
                    "checksum": "x",
                }
            ],
            "source_refs": [{"source_type": "listing", "source_id": "L1"}],
            "retrieval_mode": "keyword",
        }

    def _hybrid_shadow(self) -> Dict[str, Any]:
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

    @patch("app.ai.insights.retrieve_chunks_vector_shadow", new_callable=AsyncMock)
    @patch("app.ai.insights.retrieve_chunks", new_callable=AsyncMock)
    @patch("app.ai.insights.is_preview_enrolled", new_callable=AsyncMock)
    @patch("app.ai.insights.get_pool", new_callable=AsyncMock)
    def test_enrolled_user_hybrid_canary(
        self,
        mock_pool: AsyncMock,
        mock_enrolled: AsyncMock,
        mock_kw: AsyncMock,
        mock_shadow: AsyncMock,
    ) -> None:
        mock_enrolled.return_value = True
        mock_kw.return_value = self._keyword_result()
        mock_shadow.return_value = self._hybrid_shadow()
        conn = MagicMock()
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_pool.return_value = pool

        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            out = _run(
                insights.rag_query(
                    user_id=COHORT_UID,
                    question="listing price auction shipping",
                )
            )

        self.assertEqual(out["details"]["retrieval_mode"], "hybrid_canary")
        hc_diag = out["details"]["hybrid_canary"]
        self.assertEqual(hc_diag["gate_reason"], "preview_opt_in")
        self.assertTrue(hc_diag["preview_opt_in"])
        self.assertEqual(hc_diag["preview_source"], "owner_opt_in")
        blob = str(out).lower()
        self.assertNotIn("message_body", blob)

    @patch("app.ai.insights.retrieve_chunks", new_callable=AsyncMock)
    @patch("app.ai.insights.is_preview_enrolled", new_callable=AsyncMock)
    @patch("app.ai.insights.get_pool", new_callable=AsyncMock)
    def test_non_enrolled_keyword_default(
        self,
        mock_pool: AsyncMock,
        mock_enrolled: AsyncMock,
        mock_kw: AsyncMock,
    ) -> None:
        mock_enrolled.return_value = False
        mock_kw.return_value = self._keyword_result()
        conn = MagicMock()
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_pool.return_value = pool

        with patch.dict(
            os.environ,
            {
                "AI_RAG_HYBRID_CANARY": "1",
                "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
                "AI_RAG_HYBRID_CANARY_PERCENT": "0",
            },
            clear=False,
        ):
            from importlib import reload
            import app.ai.config as cfg
            import app.ai.hybrid_canary as hc

            reload(cfg)
            reload(hc)
            out = _run(
                insights.rag_query(
                    user_id=COHORT_UID,
                    question="listing price auction shipping",
                )
            )

        self.assertEqual(out["details"]["retrieval_mode"], "keyword")
        hc_diag = out["details"]["hybrid_canary"]
        self.assertEqual(hc_diag["gate_reason"], "keyword_default")
        self.assertFalse(hc_diag["preview_opt_in"])


if __name__ == "__main__":
    unittest.main()
