"""T20.13I — Unit tests for deterministic RAG answer synthesis."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_synthesis import (
    classify_rag_intent,
    synthesize_rag_summary,
)


def _chunk(source_type: str, content: str, **kwargs) -> dict:
    return {
        "id": kwargs.get("id", "c1"),
        "source_type": source_type,
        "source_id": kwargs.get("source_id", "s1"),
        "content": content,
        "metadata": kwargs.get("metadata", {}),
    }


def _ref(source_type: str, source_id: str = "s1") -> dict:
    return {"source_type": source_type, "source_id": source_id}


OBO_PENDING = (
    "Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf "
    "Status: pending Amount: 4436 USD Attempt: 1"
)
OBO_COUNTERED = (
    "Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf "
    "Status: countered Amount: 4136 USD Attempt: 1"
)
LISTING = (
    "Seller listing: E2E Lean Listing Status: active Type: fixed_price "
    "Price: 45.99 USD Description: Quiet vinyl"
)
REVISION = (
    "Listing revision for E2E Lean Listing Editor: abc Title: E2E Lean Listing "
    "Description: price updated"
)
AUCTION = "Auction active ends: 2026-06-12 bid_count 6 proxy bids 1200 cents"


class TestClassifyIntent(unittest.TestCase):
    def test_catalog_activity(self):
        q = "Summarize listing activity and buyer interest for my catalog."
        self.assertEqual(classify_rag_intent(q), "catalog_activity")

    def test_seller_notifications(self):
        q = "What notifications matter most for my selling activity right now?"
        self.assertEqual(classify_rag_intent(q), "seller_notifications")

    def test_offer_bidding(self):
        q = "Show a concise summary of bidding and offer activity tied to my recent listings."
        self.assertEqual(classify_rag_intent(q), "offer_bidding_activity")

    def test_listing_revision(self):
        q = "What changed recently on listing revisions that may affect offers?"
        self.assertEqual(classify_rag_intent(q), "listing_revision_changes")

    def test_private_negotiation(self):
        q = "Summarize my private seller-side negotiation context without exposing message bodies."
        self.assertEqual(classify_rag_intent(q), "private_negotiation_no_messages")

    def test_seller_attention(self):
        q = "What should I pay attention to as a seller today?"
        self.assertEqual(classify_rag_intent(q), "seller_attention_today")

    def test_marketplace(self):
        q = "Give me a grounded summary of recent marketplace activity relevant to me."
        self.assertEqual(classify_rag_intent(q), "marketplace_activity_summary")

    def test_generic_fallback(self):
        self.assertEqual(classify_rag_intent("hello world"), "generic_grounded")


class TestSynthesisTemplates(unittest.TestCase):
    def test_empty_chunks(self):
        out = synthesize_rag_summary(question="catalog", chunks=[], refs=[])
        self.assertEqual(out["template"], "empty")
        self.assertIn("No matching", out["summary"])

    def test_catalog_activity(self):
        chunks = [
            _chunk("listing", LISTING),
            _chunk("listing_revision", REVISION, id="c2"),
            _chunk("obo_offer_summary", OBO_PENDING, id="c3"),
        ]
        refs = [_ref("listing"), _ref("listing_revision", "r1"), _ref("obo_offer_summary", "o1")]
        out = synthesize_rag_summary(
            question="Summarize listing activity and buyer interest for my catalog.",
            chunks=chunks,
            refs=refs,
        )
        self.assertEqual(out["template"], "catalog_activity")
        self.assertIn("catalog shows", out["summary"].lower())
        self.assertIn("Private message bodies were not used", out["summary"])
        self.assertNotIn("Retrieved 8 grounded excerpts", out["summary"])

    def test_seller_notifications(self):
        chunks = [_chunk("obo_offer_summary", OBO_COUNTERED), _chunk("obo_offer_summary", OBO_PENDING, id="c2")]
        out = synthesize_rag_summary(
            question="What notifications matter most for my selling activity right now?",
            chunks=chunks,
            refs=[_ref("obo_offer_summary")],
        )
        self.assertEqual(out["template"], "seller_notifications")
        self.assertIn("Offer activity", out["summary"])
        self.assertIn("countered", out["summary"].lower())

    def test_offer_bidding_activity(self):
        chunks = [
            _chunk("obo_offer_summary", OBO_PENDING),
            _chunk("auction_bid_summary", AUCTION, id="c2", metadata={"bid_count": 6}),
        ]
        out = synthesize_rag_summary(
            question="Show bidding and offer activity tied to my recent listings.",
            chunks=chunks,
            refs=[_ref("obo_offer_summary"), _ref("auction_bid_summary", "a1")],
        )
        self.assertEqual(out["template"], "offer_bidding_activity")
        self.assertIn("Offer and bidding activity", out["summary"])
        self.assertIn("pending", out["summary"].lower())

    def test_listing_revision_caveat_obo_only(self):
        chunks = [_chunk("obo_offer_summary", OBO_PENDING), _chunk("obo_offer_summary", OBO_COUNTERED, id="c2")]
        out = synthesize_rag_summary(
            question="What changed recently on listing revisions that may affect offers?",
            chunks=chunks,
            refs=[_ref("obo_offer_summary")],
        )
        self.assertEqual(out["template"], "listing_revision_changes")
        self.assertIn("No listing_revision excerpts", out["summary"])
        self.assertIn("no_revision_chunks_obo_only", out["caveats"])

    def test_listing_revision_with_revisions(self):
        chunks = [_chunk("listing_revision", REVISION), _chunk("listing", LISTING, id="c2")]
        out = synthesize_rag_summary(
            question="What changed recently on listing revisions?",
            chunks=chunks,
            refs=[_ref("listing_revision"), _ref("listing")],
        )
        self.assertIn("Recent listing revision signals", out["summary"])
        self.assertNotIn("No listing_revision excerpts", out["summary"])

    def test_private_negotiation_lists_only(self):
        chunks = [_chunk("listing", LISTING)]
        out = synthesize_rag_summary(
            question="Summarize private negotiation without message bodies.",
            chunks=chunks,
            refs=[_ref("listing")],
        )
        self.assertEqual(out["template"], "private_negotiation_no_messages")
        self.assertIn("Private message bodies were not ingested", out["summary"])
        self.assertIn("listing_only_not_negotiation", out["caveats"])

    def test_private_negotiation_with_obo(self):
        chunks = [_chunk("obo_offer_summary", OBO_COUNTERED)]
        out = synthesize_rag_summary(
            question="Private negotiation context without message bodies.",
            chunks=chunks,
            refs=[_ref("obo_offer_summary")],
        )
        self.assertIn("message bodies excluded", out["summary"].lower())

    def test_seller_attention_ranked_actions(self):
        chunks = [
            _chunk("obo_offer_summary", OBO_COUNTERED),
            _chunk("obo_offer_summary", OBO_PENDING, id="c2"),
            _chunk("listing", LISTING, id="c3"),
        ]
        out = synthesize_rag_summary(
            question="What should I pay attention to as a seller today?",
            chunks=chunks,
            refs=[_ref("obo_offer_summary"), _ref("listing")],
        )
        self.assertEqual(out["template"], "seller_attention_today")
        self.assertIn("Top seller actions", out["summary"])
        self.assertIn("1.", out["summary"])
        self.assertIn("2.", out["summary"])

    def test_marketplace_activity(self):
        chunks = [_chunk("obo_offer_summary", OBO_PENDING), _chunk("listing", LISTING, id="c2")]
        out = synthesize_rag_summary(
            question="Give me a grounded summary of recent marketplace activity relevant to me.",
            chunks=chunks,
            refs=[_ref("obo_offer_summary"), _ref("listing")],
        )
        self.assertEqual(out["template"], "marketplace_activity_summary")
        self.assertIn("marketplace activity", out["summary"].lower())

    def test_no_message_body_emitted(self):
        bad = _chunk("listing", "message_body: secret thread_text content")
        out = synthesize_rag_summary(
            question="catalog activity",
            chunks=[bad],
            refs=[_ref("listing")],
        )
        self.assertNotIn("secret", out["summary"].lower())
        self.assertNotIn("message_body", out["summary"].lower())

    def test_envelope_shape_fields(self):
        chunks = [_chunk("listing", LISTING)]
        out = synthesize_rag_summary(question="catalog", chunks=chunks, refs=[_ref("listing")])
        self.assertIn("summary", out)
        self.assertIn("template", out)
        self.assertIn("caveats", out)
        self.assertIn("parsed_signals", out)
        self.assertIsInstance(out["parsed_signals"]["source_types"], list)


if __name__ == "__main__":
    unittest.main()
