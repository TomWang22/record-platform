"""Phase 33E market analytics + memory — adapter, routes, and branch coverage."""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.ai import routes
from app.ai.analytics_memory import service as analytics_memory_service


def _sold(evidence_id: str = "sold_1", price: float = 30.0, **extra):
    row = {
        "evidence_id": evidence_id,
        "source_id": evidence_id,
        "source_type": "sale",
        "sale_kind": "sold",
        "price": price,
        "currency": "USD",
        "pressing_id": "p1",
        "release_id": "r1",
        "observed_at": "2026-06-01T12:00:00.000Z",
        "retrieved_at": "2026-06-01T12:00:00.000Z",
        "summary": evidence_id,
        "authorization_scope": "authenticated_market",
        "privacy_class": "MARKETPLACE_SHARED",
        "deletion_state": "ACTIVE",
        "days_to_sale": 8,
    }
    row.update(extra)
    return row


def _analytics_body(**extra):
    body = {
        "requesting_principal_fixture": "principal_a",
        "analytics_mode": "release_market_summary",
        "subject": {"release_id": "r1", "pressing_id": "p1"},
        "currency": "USD",
        "time_range": {
            "start": "2026-01-01T00:00:00.000Z",
            "end": "2026-07-15T00:00:00.000Z",
            "timezone": "UTC",
        },
        "events": [_sold(), _sold("sold_2", 34.0, observed_at="2026-06-15T12:00:00.000Z")],
        "min_sample": 1,
    }
    body.update(extra)
    return body


def _memory_item(memory_id: str, fact_key: str, value, **extra):
    row = {
        "memory_id": memory_id,
        "memory_class": "session",
        "owner_fixture": "principal_a",
        "scope": {"thread_id": "thread_1"},
        "source_turn_ids": ["turn_1"],
        "created_at": "2026-07-01T12:00:00.000Z",
        "updated_at": "2026-07-02T10:00:00.000Z",
        "expires_at": None,
        "content_hash": f"hash_{memory_id}",
        "provenance": "fixture",
        "confidence": 0.7,
        "sensitivity": "low",
        "deletion_state": "ACTIVE",
        "fact_key": fact_key,
        "content": {"value": value},
        "content_summary": str(value),
        "classification": "recalled_fact",
    }
    row.update(extra)
    return row


def _memory_body(**extra):
    body = {
        "requesting_principal_fixture": "principal_a",
        "thread_id": "thread_1",
        "operation": "resolve",
        "max_recall": 10,
        "memory_items": [
            _memory_item("m1", "budget", 40, updated_at="2026-07-01T10:00:00.000Z"),
            _memory_item("m2", "budget", 32, updated_at="2026-07-02T10:00:00.000Z"),
        ],
    }
    body.update(extra)
    return body


class TestPhase33eServiceAdapter(unittest.TestCase):
    def test_runner_missing_raises_500(self):
        mock_runner = MagicMock()
        mock_runner.is_file.return_value = False
        with patch.object(analytics_memory_service, "RUNNER", mock_runner):
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.analyze_market_analytics(_analytics_body())
            assert exc.value.status_code == 500
            assert exc.value.detail == "phase33e_runner_missing"

    def test_invalid_engine_json_raises_500(self):
        proc = MagicMock(returncode=0, stdout="not-json", stderr="diag")
        with patch.object(analytics_memory_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.resolve_memory(_memory_body())
            assert exc.value.status_code == 500
            assert exc.value.detail == "phase33e_invalid_engine_output"

    def test_unauthorized_scope_maps_to_403(self):
        body = {
            "status": "FAIL",
            "error": "unauthorized",
            "envelope": {"abstention": {"reason_codes": ["UNAUTHORIZED_SCOPE"]}},
        }
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(analytics_memory_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.analyze_market_analytics(
                    _analytics_body(unauthorized_scope=True)
                )
            assert exc.value.status_code == 403
            assert exc.value.detail == "unauthorized_scope"

    def test_cross_user_diagnostics_map_to_403(self):
        body = {
            "status": "FAIL",
            "error": "cross_user",
            "diagnostics": {"cross_user_leakage": True},
        }
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(analytics_memory_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.resolve_memory(_memory_body(cross_user_attempt=True))
            assert exc.value.status_code == 403
            assert exc.value.detail == "cross_user_refused"

    def test_schema_violation_maps_to_422(self):
        body = {"status": "FAIL", "schema_violations": ["x"], "error": "bad"}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="")
        with patch.object(analytics_memory_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.analyze_market_analytics(_analytics_body())
            assert exc.value.status_code == 422
            assert exc.value.detail == "schema_invalid_response"

    def test_engine_failure_maps_to_422(self):
        body = {"status": "FAIL", "error": "engine_failed"}
        proc = MagicMock(returncode=1, stdout=json.dumps(body), stderr="stderr-line")
        with patch.object(analytics_memory_service, "subprocess") as mock_sub:
            mock_sub.run.return_value = proc
            with pytest.raises(HTTPException) as exc:
                analytics_memory_service.forget_memory(_memory_body(operation="forget"))
            assert exc.value.status_code == 422

    def test_market_analytics_happy_path(self):
        out = analytics_memory_service.analyze_market_analytics(_analytics_body())
        assert out["status"] == "PASS"
        assert out["result"]["sample_size"] >= 1
        assert out["result"]["analytics_mode"] == "release_market_summary"
        assert out["diagnostics"]["production_writes"] is False
        assert out["diagnostics"]["production_db_migration"] is False
        assert out["prompt"]["retrieval_mode"] == "keyword_metadata"

    def test_sold_versus_asking_and_exact_pressing(self):
        out = analytics_memory_service.analyze_market_analytics(
            _analytics_body(
                analytics_mode="pressing_market_summary",
                require_exact_pressing=True,
                events=[
                    _sold("ok", 30),
                    _sold("wrong", 99, pressing_id="other"),
                    {**_sold("ask", 80), "sale_kind": "asking", "source_type": "listing"},
                ],
            )
        )
        assert out["status"] == "PASS"
        assert out["result"]["sold_count"] == 1
        assert out["diagnostics"]["asking_as_sold"] == 0
        assert out["diagnostics"]["wrong_pressing"] == 0

    def test_causal_and_prediction_abstain(self):
        causal = analytics_memory_service.analyze_market_analytics(
            _analytics_body(request_causal_claim=True)
        )
        assert causal["envelope"]["abstention"]["abstained"] is True
        pred = analytics_memory_service.analyze_market_analytics(
            _analytics_body(request_future_price_prediction=True)
        )
        assert pred["envelope"]["abstention"]["abstained"] is True

    def test_unauthorized_watchlist_abstains(self):
        out = analytics_memory_service.analyze_market_analytics(
            _analytics_body(
                analytics_mode="watchlist_market_report",
                unauthorized_scope=True,
                owner_principal_fixture="principal_other",
            )
        )
        assert out["envelope"]["abstention"]["abstained"] is True

    def test_memory_resolve_correction_precedence(self):
        out = analytics_memory_service.resolve_memory(_memory_body())
        assert out["status"] == "PASS"
        assert out["result"]["current_facts"]["budget"] == 32
        assert out["result"]["false_memory_claims"] == 0
        assert out["result"]["unauthorized_durable_write"] is False

    def test_memory_cross_user_and_false_memory(self):
        cross = analytics_memory_service.resolve_memory(_memory_body(cross_user_attempt=True))
        assert cross["envelope"]["abstention"]["abstained"] is True
        false_mem = analytics_memory_service.resolve_memory(
            _memory_body(request_fabricated_memory=True)
        )
        assert false_mem["envelope"]["abstention"]["abstained"] is True
        assert false_mem["result"]["false_memory_claims"] == 0

    def test_memory_forget_propagation(self):
        out = analytics_memory_service.forget_memory(
            _memory_body(
                forget_memory_ids=["src"],
                memory_items=[
                    _memory_item("src", "condition", "VG+"),
                    _memory_item(
                        "der",
                        "condition_summary",
                        "VG+",
                        memory_class="derived_market_state",
                        derived_from="src",
                    ),
                ],
            )
        )
        assert out["status"] == "PASS"
        assert out["result"]["operation"] == "forget"
        assert out["result"]["forget_applied"] is True
        assert out["result"]["recalled_items"] == []


class TestPhase33eRoutes(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(routes.router)
        self.client = TestClient(app)

    def test_market_analytics_route(self):
        r = self.client.post(
            "/ai/intelligence/market-analytics",
            json=_analytics_body(),
            headers={"x-user-id": "principal_a"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "PASS")
        self.assertIn("sample_size", body["result"])
        self.assertFalse(body["diagnostics"]["production_writes"])

    def test_memory_resolve_route(self):
        r = self.client.post(
            "/ai/intelligence/memory/resolve",
            json=_memory_body(),
            headers={"x-user-id": "principal_a"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["result"]["current_facts"]["budget"], 32)

    def test_memory_forget_route(self):
        r = self.client.post(
            "/ai/intelligence/memory/forget",
            json=_memory_body(forget_fact_keys=["budget"]),
            headers={"x-user-id": "principal_a"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["result"]["operation"], "forget")

    def test_malformed_body_rejected(self):
        r = self.client.post(
            "/ai/intelligence/market-analytics",
            json={"events": "not-a-list"},
            headers={"x-user-id": "principal_a"},
        )
        self.assertIn(r.status_code, (400, 422))

    def test_unauthorized_scope_maps_to_4xx(self):
        r = self.client.post(
            "/ai/intelligence/market-analytics",
            json=_analytics_body(
                analytics_mode="seller_inventory_report",
                unauthorized_scope=True,
                owner_principal_fixture="principal_other",
            ),
            headers={"x-user-id": "principal_a"},
        )
        # Engine abstains with PASS when scope unauthorized; either abstention or 403 is valid.
        if r.status_code == 200:
            self.assertTrue(r.json()["envelope"]["abstention"]["abstained"])
        else:
            self.assertIn(r.status_code, (403, 422))
