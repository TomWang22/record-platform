"""Phase 33D service/route coverage — behavior tests for uncovered branches.

These tests restore the python-ai-service lines gate without lowering thresholds.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.ai import routes
from app.ai.market_intelligence import service as market_service
from app.ai.negotiation_recommendations import service as negrec_service


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


def _candidate(entity_id: str = "e1", **extra):
    row = {
        "entity_id": entity_id,
        "entity_type": "listing",
        "artist": "a1",
        "price": 22,
        "deletion_state": "ACTIVE",
        "authorization_scope": "authenticated_market",
        "privacy_class": "MARKETPLACE_SHARED",
    }
    row.update(extra)
    return row


def _negotiation_body(**extra):
    body = {
        "requesting_principal_fixture": "buyer_a",
        "participant_side": "buyer",
        "authorized_thread_id": "t1",
        "asking_price": 40,
        "subject": {"listing_id": "L1", "release_id": "r1", "pressing_id": "p1"},
        "thread": {"thread_id": "t1", "participant_principals": ["buyer_a", "seller_b"]},
        "messages": [],
        "market_candidates": _market(),
    }
    body.update(extra)
    return body


class TestPhase33dServiceAdapter(unittest.TestCase):
    def test_runner_missing_raises_500(self):
        mock_runner = MagicMock()
        mock_runner.is_file.return_value = False
        with patch.object(negrec_service, "RUNNER", mock_runner):
            with pytest.raises(HTTPException) as exc:
                negrec_service.analyze_negotiation(_negotiation_body())
            assert exc.value.status_code == 500
            assert exc.value.detail == "phase33d_runner_missing"

    def test_invalid_engine_json_raises_500(self):
        proc = MagicMock(returncode=0, stdout="not-json", stderr="diag")
        with patch.object(negrec_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                negrec_service.analyze_recommendations(
                    {
                        "requesting_principal_fixture": "buyer_a",
                        "recommendation_mode": "collection_gap",
                        "candidates": [_candidate()],
                    }
                )
            assert exc.value.status_code == 500
            assert exc.value.detail == "phase33d_invalid_engine_output"

    def test_unauthorized_thread_short_circuits_without_engine(self):
        """Contract A: unauthorized returns structured 200-shaped PASS without Node."""
        with patch.object(negrec_service, "subprocess") as mock_sub:
            out = negrec_service.analyze_negotiation(
                _negotiation_body(unauthorized_thread=True)
            )
            mock_sub.run.assert_not_called()
        assert out["status"] == "PASS"
        assert out["diagnostics"]["unauthorized_thread"] is True
        assert out["diagnostics"]["engine_invoked"] is False
        assert out["envelope"]["authorization_scope"]["authorized"] is False
        assert out["result"]["automatic_send_allowed"] is False
        assert "UNAUTHORIZED_THREAD" in out["envelope"]["abstention"]["reason_codes"]

    def test_unauthorized_mode_short_circuits_without_engine(self):
        with patch.object(negrec_service, "subprocess") as mock_sub:
            out = negrec_service.analyze_negotiation(
                {
                    "principal_id": "buyer_a",
                    "mode": "unauthorized_thread",
                    "capability_mode": "unauthorized_thread",
                }
            )
            mock_sub.run.assert_not_called()
        assert out["diagnostics"]["unauthorized_thread"] is True
        assert out["diagnostics"]["engine_invoked"] is False

    def test_schema_violation_maps_to_422(self):
        body = {"status": "FAIL", "schema_violations": ["x"], "error": "bad"}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(negrec_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                negrec_service.analyze_recommendations(
                    {
                        "requesting_principal_fixture": "buyer_a",
                        "recommendation_mode": "collection_gap",
                        "candidates": [_candidate()],
                    }
                )
            assert exc.value.status_code == 422
            assert exc.value.detail == "SCHEMA_INVALID_RESPONSE"

    def test_engine_failure_maps_to_500(self):
        body = {"status": "FAIL", "error": "engine_failed"}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="stderr-line")
        with patch.object(negrec_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                negrec_service.analyze_negotiation(_negotiation_body())
            assert exc.value.status_code == 500
            assert exc.value.detail == "ENGINE_INTERNAL_FAILURE"

    def test_buyer_negotiation_happy_path(self):
        out = negrec_service.analyze_negotiation(_negotiation_body())
        assert out["status"] == "PASS"
        assert out["result"]["participant_side"] == "buyer"
        assert out["result"]["automatic_send_allowed"] is False
        assert out["diagnostics"]["production_writes"] is False
        assert out["prompt"]["retrieval_mode"] == "keyword_metadata"

    def test_seller_negotiation_happy_path(self):
        out = negrec_service.analyze_negotiation(
            _negotiation_body(participant_side="seller", seller_minimum=28)
        )
        assert out["result"]["participant_side"] == "seller"

    def test_auto_send_refusal_abstains(self):
        out = negrec_service.analyze_negotiation(_negotiation_body(request_auto_send=True))
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_impersonation_refusal_abstains(self):
        out = negrec_service.analyze_negotiation(_negotiation_body(request_impersonation=True))
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_fabricated_leverage_refusal_abstains(self):
        out = negrec_service.analyze_negotiation(
            _negotiation_body(request_fabricated_leverage=True)
        )
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_corrected_budget_precedence(self):
        out = negrec_service.analyze_negotiation(
            _negotiation_body(
                budget=40,
                messages=[
                    {
                        "message_id": "m1",
                        "thread_id": "t1",
                        "participant_side": "buyer",
                        "correction_budget": 32,
                    }
                ],
            )
        )
        assert any("32" in s for s in out["result"]["stated_objectives"])

    def test_deleted_message_not_applied(self):
        out = negrec_service.analyze_negotiation(
            _negotiation_body(
                budget=30,
                messages=[
                    {
                        "message_id": "del",
                        "thread_id": "t1",
                        "deleted": True,
                        "correction_budget": 999,
                    }
                ],
            )
        )
        assert out["diagnostics"]["deleted_message_influence"] == 0
        assert not any("999" in s for s in out["result"]["stated_objectives"])

    def test_recommendation_modes_and_filters(self):
        modes = [
            "similar_release",
            "collection_gap",
            "budget_opportunity",
            "auction_watch",
            "condition_upgrade",
            "seller_restock",
            "sell_hold_watch",
            "portfolio_diversification",
            "market_opportunity",
        ]
        for mode in modes:
            out = negrec_service.analyze_recommendations(
                {
                    "requesting_principal_fixture": "buyer_a",
                    "recommendation_mode": mode,
                    "budget": 50,
                    "candidates": [_candidate(f"c_{mode}")],
                }
            )
            assert out["result"]["recommendation_mode"] == mode
            assert out["result"]["pay_to_rank"] is False

    def test_unsupported_mode_abstains(self):
        out = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "not_a_mode",
                "candidates": [_candidate()],
            }
        )
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_cross_user_collection_abstains(self):
        out = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "collection_gap",
                "cross_user_collection_attempt": True,
                "candidates": [_candidate()],
            }
        )
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_budget_and_negative_preference_filter(self):
        out = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "budget_opportunity",
                "budget": 20,
                "negative_preferences": ["artist_bad"],
                "candidates": [
                    _candidate("ok", artist="artist_ok", price=18),
                    _candidate("bad", artist="artist_bad", price=15),
                    _candidate("over", artist="artist_ok", price=40),
                ],
            }
        )
        ids = {r["entity_id"] for r in out["result"]["recommendations"]}
        assert "ok" in ids
        assert "bad" not in ids
        assert "over" not in ids

    def test_deleted_and_unavailable_excluded(self):
        out = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "similar_release",
                "candidates": [
                    _candidate("deleted", deleted=True, deletion_state="DELETED"),
                    _candidate("unavail", unavailable=True),
                    _candidate("good"),
                ],
            }
        )
        ids = {r["entity_id"] for r in out["result"]["recommendations"]}
        assert ids == {"good"}

    def test_already_owned_suppressed_except_upgrade(self):
        owned = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "similar_release",
                "owned_entity_ids": ["owned"],
                "candidates": [_candidate("owned"), _candidate("other")],
            }
        )
        assert all(r["entity_id"] != "owned" for r in owned["result"]["recommendations"])
        upgrade = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "condition_upgrade",
                "owned_entity_ids": ["owned"],
                "candidates": [_candidate("owned"), _candidate("other")],
            }
        )
        assert any(r["entity_id"] == "owned" for r in upgrade["result"]["recommendations"])

    def test_cold_start_public(self):
        out = negrec_service.analyze_recommendations(
            {
                "allow_public_cold_start": True,
                "recommendation_mode": "similar_release",
                "candidates": [_candidate("cold")],
            }
        )
        assert out["status"] == "PASS"
        assert out["result"]["recommendations"]

    def test_zero_candidates_abstains(self):
        out = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "collection_gap",
                "candidates": [],
            }
        )
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_pay_to_rank_and_appreciation_refused(self):
        pay = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "market_opportunity",
                "request_pay_to_rank": True,
                "candidates": [_candidate()],
            }
        )
        assert pay["envelope"]["abstention"]["abstained"] is True
        appr = negrec_service.analyze_recommendations(
            {
                "requesting_principal_fixture": "buyer_a",
                "recommendation_mode": "market_opportunity",
                "request_guaranteed_appreciation": True,
                "candidates": [_candidate()],
            }
        )
        assert appr["envelope"]["abstention"]["abstained"] is True


class TestPhase33cServiceAdapterExceptions(unittest.TestCase):
    def test_market_runner_missing(self):
        mock_runner = MagicMock()
        mock_runner.is_file.return_value = False
        with patch.object(market_service, "RUNNER", mock_runner):
            with pytest.raises(HTTPException) as exc:
                market_service.analyze_scarcity({"subject": {"release_id": "r1"}})
            assert exc.value.detail == "phase33c_runner_missing"

    def test_market_invalid_json(self):
        proc = MagicMock(returncode=0, stdout="{bad", stderr="")
        with patch.object(market_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                market_service.analyze_valuation({"subject": {"release_id": "r1"}})
            assert exc.value.detail == "phase33c_invalid_engine_output"

    def test_market_unauthorized_watchlist_403(self):
        body = {"status": "FAIL", "diagnostics": {"unauthorized_watchlist": True}}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(market_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                market_service.analyze_watchlist_temperature({"watchlist_auctions": []})
            assert exc.value.status_code == 403

    def test_market_schema_invalid_422(self):
        body = {"status": "FAIL", "schema_violations": ["x"]}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(market_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                market_service.analyze_auction({"auction": {"lot_id": "A"}})
            assert exc.value.detail == "schema_invalid_response"

    def test_watchlist_temperature_sets_mode(self):
        out = market_service.analyze_watchlist_temperature(
            {
                "requesting_principal_fixture": "buyer_a",
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


class TestPhase33IntelligenceRoutes(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(routes.router)
        self.client = TestClient(app)

    def test_negotiation_route_advisory_only(self):
        r = self.client.post(
            "/ai/intelligence/negotiation",
            json=_negotiation_body(),
            headers={"x-user-id": "buyer_a"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "PASS")
        self.assertFalse(body["result"]["automatic_send_allowed"])

    def test_recommendations_route_no_pay_to_rank(self):
        r = self.client.post(
            "/ai/intelligence/recommendations",
            json={
                "recommendation_mode": "collection_gap",
                "budget": 50,
                "candidates": [_candidate()],
            },
            headers={"x-user-id": "buyer_a"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body["result"]["pay_to_rank"])

    def test_intelligence_payload_injects_principal_from_header(self):
        r = self.client.post(
            "/ai/intelligence/recommendations",
            json={"recommendation_mode": "similar_release", "candidates": [_candidate()]},
            headers={"x-user-id": "header_principal"},
        )
        self.assertEqual(r.status_code, 200)
        scope = r.json()["result"]["recommendation_scope"]
        self.assertEqual(scope["principal"], "header_principal")

    def test_scarcity_route(self):
        r = self.client.post(
            "/ai/intelligence/scarcity",
            json={
                "subject": {"release_id": "R1", "pressing_id": "P1"},
                "candidates": _market(),
                "active_supply_count": 1,
                "recent_sale_count": 1,
            },
        )
        self.assertEqual(r.status_code, 200)

    def test_valuation_route(self):
        r = self.client.post(
            "/ai/intelligence/valuation",
            json={
                "subject": {"release_id": "R1", "pressing_id": "P1"},
                "currency": "USD",
                "candidates": _market(),
            },
        )
        self.assertEqual(r.status_code, 200)

    def test_auction_routes(self):
        auction = {
            "lot_id": "A1",
            "current_price": 10,
            "bid_count": 1,
            "bid_velocity": 1,
            "late_bid_pressure": 0.1,
            "price_acceleration": 0,
            "observed_at": "2026-07-15T12:00:00.000Z",
        }
        r1 = self.client.post("/ai/intelligence/auction", json={"auction": auction})
        self.assertEqual(r1.status_code, 200)
        r2 = self.client.post(
            "/ai/intelligence/auction/watchlist-temperature",
            json={"watchlist_auctions": [auction]},
        )
        self.assertEqual(r2.status_code, 200)
