"""P21.4 — Collector metadata extraction tests."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_synthesis import (
    build_collector_metadata_gaps,
    extract_collector_metadata,
    synthesize_rag_summary,
)


def _chunk(source_type: str, content: str) -> dict:
    return {"id": "c1", "source_type": source_type, "source_id": "s1", "content": content}


RICH_LISTING = (
    "Seller listing: Blue Note LP Artist: Miles Davis Album: Kind of Blue "
    "Label: Columbia Cat: BN-1234 Status: active Price: 89.99 USD "
    "Pressing: stereo first press Country: US Year: 1959 Format: LP "
    "Condition media: VG+ sleeve: VG Grade: VG+/VG "
    "Description: Plays clean. Minor ring wear. Photos included."
)

SPARSE_LISTING = "Seller listing: Basic LP Status: active Price: 12.00 USD"

RECORD_EXCERPT = (
    "Record: Kind of Blue Artist: Miles Davis Label: Columbia "
    "Title: Kind of Blue Format: LP Year: 1959"
)


class TestCollectorMetadataExtraction(unittest.TestCase):
    def test_rich_listing_fields(self):
        report = extract_collector_metadata([_chunk("listing", RICH_LISTING)])
        by_field = {e["field"]: e for e in report["field_map"]}
        self.assertEqual(by_field["pressing"]["status"], "present")
        self.assertEqual(by_field["label"]["status"], "present")
        self.assertEqual(by_field["catalog_number"]["status"], "present")
        self.assertEqual(by_field["grade"]["status"], "present")
        self.assertEqual(by_field["photos_or_visuals"]["status"], "present")
        self.assertGreater(report["completeness_score"], 50)

    def test_sparse_listing_missing_pressing(self):
        report = extract_collector_metadata([_chunk("listing", SPARSE_LISTING)])
        by_field = {e["field"]: e for e in report["field_map"]}
        self.assertEqual(by_field["title"]["status"], "present")
        self.assertEqual(by_field["price"]["status"], "present")
        self.assertEqual(by_field["pressing"]["status"], "missing")
        self.assertIn("pressing", report["high_priority_missing"])

    def test_record_excerpt_artist_title(self):
        report = extract_collector_metadata([_chunk("record", RECORD_EXCERPT)])
        by_field = {e["field"]: e for e in report["field_map"]}
        self.assertEqual(by_field["artist"]["status"], "present")
        self.assertEqual(by_field["title"]["status"], "present")
        self.assertEqual(by_field["label"]["status"], "present")

    def test_no_hallucinated_scarcity(self):
        report = extract_collector_metadata([_chunk("listing", SPARSE_LISTING)])
        by_field = {e["field"]: e for e in report["field_map"]}
        self.assertEqual(by_field["scarcity_signal"]["status"], "missing")
        self.assertTrue(
            any("do not" in n.lower() or "without" in n.lower() for n in report["collector_risk_notes"])
        )

    def test_no_message_body_leakage(self):
        toxic = "Seller listing: X Status: active message_body: secret thread_text: leak"
        report = extract_collector_metadata([_chunk("listing", toxic)])
        blob = str(report).lower()
        self.assertNotIn("secret", blob)

    def test_build_endpoint_field_map(self):
        built = build_collector_metadata_gaps([_chunk("listing", RICH_LISTING)], [{"source_type": "listing", "source_id": "s1"}])
        self.assertIn("field_map", built)
        self.assertGreater(built["completeness_score"], 0)
        self.assertTrue(built["recommended_listing_edits"])

    def test_synthesis_present_missing_format(self):
        prompt = (
            "Think like a serious vinyl collector. Which listing details are missing or weak: "
            "pressing, condition, title, price, scarcity, seller notes, or provenance?"
        )
        out = synthesize_rag_summary(
            question=prompt,
            chunks=[_chunk("listing", SPARSE_LISTING)],
            refs=[{"source_type": "listing", "source_id": "s1"}],
        )
        self.assertEqual(out["template"], "collector_metadata_gaps")
        self.assertIn("Collector metadata check:", out["summary"])
        self.assertIn("Present:", out["summary"])
        self.assertIn("Missing or unclear:", out["summary"])
        self.assertIn("Highest-impact edits:", out["summary"])
        self.assertNotIn("definitely rare", out["summary"].lower())


if __name__ == "__main__":
    unittest.main()
