"""Phase 33C fixture-backed intelligence route/service tests (offline, no prod writes)."""

from __future__ import annotations

import json

from app.ai.market_intelligence.service import (
    analyze_auction,
    analyze_scarcity,
    analyze_valuation,
    analyze_watchlist_temperature,
)


def _sold(eid: str, pressing: str, price: float = 50.0) -> dict:
    return {
        "evidence_id": eid,
        "source_type": "sale",
        "source_id": eid,
        "sale_kind": "sold",
        "price": price,
        "currency": "USD",
        "pressing_id": pressing,
        "release_id": "R1",
        "observed_at": "2026-06-01T12:00:00.000Z",
        "retrieved_at": "2026-06-01T12:00:00.000Z",
        "summary": f"sold {eid}",
        "authorization_scope": "authenticated_market",
        "privacy_class": "MARKETPLACE_SHARED",
        "deletion_state": "ACTIVE",
    }


def test_scarcity_service_structured_envelope():
    out = analyze_scarcity(
        {
            "subject": {"release_id": "R1", "pressing_id": "P1"},
            "candidates": [_sold("a", "P1", 40), _sold("b", "P1", 42)],
            "active_supply_count": 2,
            "recent_sale_count": 2,
        }
    )
    assert out["status"] == "PASS"
    assert out["capability"] == "scarcity"
    assert out["envelope"]["capability"] == "scarcity"
    assert "evidence" in out["result"]
    assert out["diagnostics"]["retrieval_mode"] == "keyword_metadata"
    assert out["diagnostics"]["production_writes"] is False


def test_valuation_service_range():
    out = analyze_valuation(
        {
            "subject": {"release_id": "R1", "pressing_id": "P1", "condition": "VG+"},
            "currency": "USD",
            "candidates": [_sold("a", "P1", 50), _sold("b", "P1", 55), _sold("c", "P1", 52)],
        }
    )
    assert out["status"] == "PASS"
    result = out["result"]
    assert result["low_estimate"] <= result["fair_value"] <= result["high_estimate"]


def test_watchlist_temperature_unauthorized():
    out = analyze_watchlist_temperature(
        {
            "requesting_principal_fixture": "principal_fixture_buyer_a",
            "watchlist_owner_principal_fixture": "principal_fixture_buyer_b",
            "unauthorized_watchlist": True,
            "watchlist_auctions": [
                {
                    "lot_id": "A",
                    "current_price": 10,
                    "bid_count": 1,
                    "bid_velocity": 1,
                    "late_bid_pressure": 0.1,
                    "price_acceleration": 0,
                    "observed_at": "2026-07-15T12:00:00.000Z",
                }
            ],
        }
    )
    assert out["status"] == "PASS"
    assert out["envelope"]["abstention"]["abstained"] is True
    assert out["result"]["auction_count"] == 0
    assert out["diagnostics"].get("unauthorized_watchlist") is True


def test_no_private_fields_in_response():
    out = analyze_scarcity(
        {
            "subject": {"release_id": "R1", "pressing_id": "P1"},
            "candidates": [_sold("a", "P1"), _sold("b", "P1")],
        }
    )
    blob = json.dumps(out)
    assert "@" not in blob
    assert "eyJ" not in blob
    assert "Bearer " not in blob
