"""Phase 33D negotiation / recommendations service tests."""

from __future__ import annotations

from app.ai.negotiation_recommendations.service import (
    analyze_negotiation,
    analyze_recommendations,
)


def _market():
    return [
        {
            "evidence_id": "sold_1",
            "source_type": "sale",
            "source_id": "sold_1",
            "sale_kind": "sold",
            "price": 30,
            "currency": "USD",
            "pressing_id": "p1",
            "release_id": "r1",
            "observed_at": "2026-07-01T12:00:00.000Z",
            "retrieved_at": "2026-07-01T12:00:00.000Z",
            "summary": "sold",
            "authorization_scope": "authenticated_market",
            "privacy_class": "MARKETPLACE_SHARED",
            "deletion_state": "ACTIVE",
            "freshness_status": "fresh",
        }
    ]


def test_negotiation_advisory_envelope():
    out = analyze_negotiation(
        {
            "requesting_principal_fixture": "buyer_a",
            "participant_side": "buyer",
            "authorized_thread_id": "t1",
            "asking_price": 40,
            "subject": {"listing_id": "L1", "release_id": "r1", "pressing_id": "p1"},
            "thread": {"thread_id": "t1", "participant_principals": ["buyer_a", "seller_b"]},
            "messages": [],
            "market_candidates": _market(),
        }
    )
    assert out["status"] == "PASS"
    assert out["result"]["automatic_send_allowed"] is False
    assert out["diagnostics"]["automatic_send_allowed"] is False
    assert out["diagnostics"]["production_writes"] is False


def test_negotiation_unauthorized_thread_abstains():
    out = analyze_negotiation(
        {
            "requesting_principal_fixture": "buyer_a",
            "participant_side": "buyer",
            "authorized_thread_id": "t2",
            "unauthorized_thread": True,
            "subject": {"listing_id": "L1", "release_id": "r1"},
            "thread": {"thread_id": "t2", "participant_principals": ["other"]},
            "market_candidates": _market(),
        }
    )
    assert out["envelope"]["abstention"]["abstained"] is True


def test_recommendations_mode_and_no_pay_to_rank():
    out = analyze_recommendations(
        {
            "requesting_principal_fixture": "buyer_a",
            "recommendation_mode": "collection_gap",
            "budget": 50,
            "candidates": [
                {
                    "entity_id": "e1",
                    "entity_type": "listing",
                    "artist": "a1",
                    "price": 22,
                    "deletion_state": "ACTIVE",
                    "authorization_scope": "authenticated_market",
                    "privacy_class": "MARKETPLACE_SHARED",
                }
            ],
        }
    )
    assert out["status"] == "PASS"
    assert out["result"]["recommendation_mode"] == "collection_gap"
    assert out["result"]["pay_to_rank"] is False
    assert len(out["result"]["recommendations"]) >= 1


def test_recommendations_cross_user_blocked():
    out = analyze_recommendations(
        {
            "requesting_principal_fixture": "buyer_a",
            "recommendation_mode": "collection_gap",
            "cross_user_collection_attempt": True,
            "candidates": [
                {
                    "entity_id": "e1",
                    "entity_type": "listing",
                    "price": 10,
                    "deletion_state": "ACTIVE",
                }
            ],
        }
    )
    assert out["envelope"]["abstention"]["abstained"] is True
