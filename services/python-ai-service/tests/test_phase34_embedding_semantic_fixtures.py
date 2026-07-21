"""Coverage for Phase 34 embedding lineage + semantic search fixtures."""

import os

from app.ai.embedding_semantic_fixtures import (
    analyze_embedding_metadata,
    analyze_semantic_search,
)


def test_embedding_lineage_current_has_no_fixture_placeholders():
    out = analyze_embedding_metadata(
        {
            "principal_id": "seller-1",
            "subject": {"record_id": "rec-kenny-1"},
            "user_intent": "Show current embedding lineage",
        }
    )
    blob = str(out)
    assert "deadbeef" not in blob
    assert "fixture-embed-v1" not in blob
    assert out["freshness"] == "CURRENT"
    assert out["reembed_required"] is False
    assert out["production_writes"] is False
    assert out["entity"] == "rec-kenny-1"
    assert out["content_hash"].startswith("sha256:")


def test_embedding_stale_correction_sets_reembed_required():
    out = analyze_embedding_metadata(
        {
            "principal_id": "seller-1",
            "entity_id": "rec-kenny-1",
            "user_intent": "Mark this embedding stale and require re-embed",
        }
    )
    assert out["freshness"] == "STALE"
    assert out["reembed_required"] is True
    assert out["reembed_status"] == "REQUIRED"
    assert out["correction_change"] is not None


def test_embedding_deleted_source_state():
    out = analyze_embedding_metadata(
        {
            "principal_id": "seller-1",
            "entity_id": "rec-kenny-1",
            "user_intent": "Source was deleted",
            "deleted_source": True,
        }
    )
    assert out["deletion_state"] == "DELETED"
    assert "deleted" in out["summary"].lower()


def test_semantic_search_success_has_five_cards():
    os.environ["PHASE34_UNIT_TEST_HOOKS"] = "1"
    try:
        out = analyze_semantic_search(
            {
                "retrieval_mode": "semantic",
                "user_intent": "Find Quiet Kenny pressings",
            }
        )
        assert out["selected_mode"] == "semantic"
        assert out["executed_mode"] == "semantic"
        assert out["silent_fallback"] is False
        assert len(out["results"]) >= 5
        assert "fixture-release-1" not in str(out)
        card = out["results"][0]
        assert card["artist"]
        assert card["pressing_identity"]
        assert card["why_matched"]
    finally:
        os.environ.pop("PHASE34_UNIT_TEST_HOOKS", None)


def test_hybrid_correction_changes_mode_and_excludes_picture_discs():
    os.environ["PHASE34_UNIT_TEST_HOOKS"] = "1"
    try:
        out = analyze_semantic_search(
            {
                "retrieval_mode": "semantic",
                "user_intent": "Switch to hybrid and exclude picture discs",
            }
        )
        assert out["selected_mode"] == "hybrid"
        assert out["executed_mode"] == "hybrid"
        assert out["picture_discs_excluded"] is True
        assert out["correction_change"] is not None
        assert all(not c.get("picture_disc") for c in out["result_cards"])
    finally:
        os.environ.pop("PHASE34_UNIT_TEST_HOOKS", None)


def test_visible_fallback_is_not_silent_success():
    out = analyze_semantic_search(
        {
            "retrieval_mode": "semantic",
            "user_intent": "Show visible fallback when empty",
            "force_empty": True,
        }
    )
    assert out["executed_mode"] == "visible_fallback"
    assert out["fallback_visible"] is True
    assert out["silent_fallback"] is False
    assert out["results"] == []


def test_semantic_search_blocks_catalog_without_hooks():
    os.environ.pop("PHASE34_UNIT_TEST_HOOKS", None)
    os.environ.pop("PHASE34_ALLOW_SYNTHETIC_SALES", None)
    out = analyze_semantic_search(
        {
            "retrieval_mode": "semantic",
            "user_intent": "Find Quiet Kenny pressings",
        }
    )
    assert out["results"] == []
    assert out.get("fixture_catalog_blocked") is True or out.get("abstention_reason") == "FIXTURE_CATALOG_BLOCKED"
