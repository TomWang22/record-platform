"""T15.3C — Canonical AI HTTP routes."""
from __future__ import annotations

import time
from typing import List, Optional

from fastapi import APIRouter, Header, Query, Request
from pydantic import BaseModel, Field

from app.ai import insights
from app.ai.config import AI_RAG_SHADOW_VECTOR
from app.ai.kpi_query_observations import emit_rag_query_observation_safe
from app.ai.market_intelligence import (
    analyze_auction,
    analyze_scarcity,
    analyze_valuation,
    analyze_watchlist_temperature,
)
from app.ai.negotiation_recommendations import (
    analyze_negotiation,
    analyze_recommendations,
)
from app.ai.server_timing import inject_redacted_rag_timing_details

router = APIRouter(prefix="/ai", tags=["ai-platform"])


def _parse_custom_query_hints(value: Optional[str]) -> Optional[List[str]]:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    return [part.strip() for part in raw.split(",") if part.strip()]


def _user_id(header: Optional[str], body_user: Optional[str]) -> Optional[str]:
    uid = (header or body_user or "").strip()
    if uid in ("", "null", "None"):
        return None
    return uid


class RagQueryBody(BaseModel):
    question: str = Field(..., min_length=2)
    user_id: Optional[str] = None
    source_types: Optional[List[str]] = None


class RecordValuationBody(BaseModel):
    record_id: str
    user_id: Optional[str] = None
    include_comps: bool = True


class ListingIdBody(BaseModel):
    listing_id: str
    user_id: Optional[str] = None


class UserBody(BaseModel):
    user_id: Optional[str] = None


class SessionStartBody(BaseModel):
    user_id: Optional[str] = None


class SessionQueryBody(BaseModel):
    session_id: str = Field(..., min_length=8)
    question: str = Field(..., min_length=2)
    user_id: Optional[str] = None
    source_types: Optional[List[str]] = None


class SessionResetBody(BaseModel):
    session_id: str = Field(..., min_length=8)
    user_id: Optional[str] = None


@router.post("/session/start")
async def post_session_start(
    body: SessionStartBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.session_start(user_id=_user_id(x_user_id, body.user_id))


@router.post("/session/query")
async def post_session_query(
    body: SessionQueryBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.session_query(
        user_id=_user_id(x_user_id, body.user_id),
        session_id=body.session_id,
        question=body.question,
        source_types=body.source_types,
    )


@router.get("/session/{session_id}")
async def get_session(
    session_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.session_get(user_id=_user_id(x_user_id, None), session_id=session_id)


@router.post("/session/reset")
async def post_session_reset(
    body: SessionResetBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.session_reset(
        user_id=_user_id(x_user_id, body.user_id),
        session_id=body.session_id,
    )


@router.get("/rag/preview/status")
async def get_rag_preview_status(
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.rag_preview_status(user_id=_user_id(x_user_id, None))


@router.post("/rag/preview/enroll")
async def post_rag_preview_enroll(
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.rag_preview_enroll(user_id=_user_id(x_user_id, None))


@router.post("/rag/preview/revoke")
async def post_rag_preview_revoke(
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.rag_preview_revoke(user_id=_user_id(x_user_id, None))


@router.head("/rag/transport-probe")
@router.get("/rag/transport-probe")
async def rag_transport_probe(
    correlation_id: str = Query(..., min_length=8, max_length=128),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Read-only transport forensics endpoint — safe for QUIC/TLS 0-RTT replay testing."""
    _ = _user_id(x_user_id, None)
    return {
        "ok": True,
        "transport_probe": True,
        "mutating": False,
        "correlation_id": correlation_id,
        "rag_post_early_data_blocked": True,
    }


@router.post("/rag/query")
async def post_rag_query(
    request: Request,
    body: RagQueryBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    shadow_vector: bool = Query(False),
    shadow_profile: Optional[str] = Query(None),
    shadow_profile_hints: bool = Query(False),
    shadow_query_hints: Optional[str] = Query(
        None,
        description="Comma-separated shadow-only query hint terms, e.g. obo,owner_visible",
    ),
    shadow_debug: bool = Query(False),
):
    started = time.perf_counter()
    result = await insights.rag_query(
        user_id=_user_id(x_user_id, body.user_id),
        question=body.question,
        source_types=body.source_types,
        shadow_vector=shadow_vector or AI_RAG_SHADOW_VECTOR,
        shadow_profile=shadow_profile,
        shadow_profile_hints=shadow_profile_hints,
        shadow_custom_query_hints=_parse_custom_query_hints(shadow_query_hints),
        shadow_debug=shadow_debug,
    )
    rag_total_ms = int((time.perf_counter() - started) * 1000)
    kpi_started = time.perf_counter()
    await emit_rag_query_observation_safe(
        http_scope=request.scope,
        rag_envelope=result,
        rag_total_ms=rag_total_ms,
        http_status=200,
    )
    kpi_query_write_ms = int((time.perf_counter() - kpi_started) * 1000)
    inject_redacted_rag_timing_details(
        result,
        rag_total_ms=rag_total_ms,
        kpi_query_write_ms=kpi_query_write_ms,
    )
    return result


@router.post("/records/valuation")
async def post_record_valuation(
    body: RecordValuationBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.record_valuation(
        user_id=_user_id(x_user_id, body.user_id),
        record_id=body.record_id,
    )


@router.post("/listings/pricing-advice")
async def post_pricing_advice(
    body: ListingIdBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.listing_pricing_advice(
        user_id=_user_id(x_user_id, body.user_id),
        listing_id=body.listing_id,
    )


@router.post("/auctions/risk")
async def post_auction_risk(
    body: ListingIdBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.auction_risk(
        user_id=_user_id(x_user_id, body.user_id),
        listing_id=body.listing_id,
    )


@router.post("/seller/summary")
async def post_seller_summary(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.seller_summary(user_id=_user_id(x_user_id, body.user_id))


@router.post("/buyer/collection-summary")
async def post_buyer_collection_summary(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.buyer_collection_summary(user_id=_user_id(x_user_id, body.user_id))


@router.post("/seller/listing-advice")
async def post_seller_listing_advice(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.seller_listing_advice(user_id=_user_id(x_user_id, body.user_id))


@router.post("/seller/negotiation-strategy")
async def post_seller_negotiation_strategy(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.seller_negotiation_strategy(user_id=_user_id(x_user_id, body.user_id))


@router.post("/seller/auction-pressure")
async def post_seller_auction_pressure(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.seller_auction_pressure(user_id=_user_id(x_user_id, body.user_id))


@router.post("/seller/collector-metadata-gaps")
async def post_seller_collector_metadata_gaps(
    body: UserBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.seller_collector_metadata_gaps(user_id=_user_id(x_user_id, body.user_id))


@router.get("/offer-insights")
async def get_offer_insights(
    listing_id: str = Query(..., min_length=8),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    return await insights.offer_insights(user_id=_user_id(x_user_id, None), listing_id=listing_id)


class IntelligenceBody(BaseModel):
    """Phase 33C/33D structured intelligence request (fixture-backed deterministic engines)."""

    subject: Optional[dict] = None
    candidates: Optional[list] = None
    authorized_scopes: Optional[List[str]] = None
    requesting_principal_fixture: Optional[str] = None
    principal_id: Optional[str] = None
    currency: Optional[str] = None
    analysis_mode: Optional[str] = None
    auction: Optional[dict] = None
    watchlist_auctions: Optional[list] = None
    watchlist_owner_principal_fixture: Optional[str] = None
    unauthorized_watchlist: Optional[bool] = None
    request_bidder_identity: Optional[bool] = None
    claim_collusion: Optional[bool] = None
    comparable_auctions: Optional[list] = None
    active_supply_count: Optional[int] = None
    recent_sale_count: Optional[int] = None
    require_exact_pressing: Optional[bool] = None
    claim_rarity_from_zero_results: Optional[bool] = None
    unidentified_pressing: Optional[bool] = None
    min_sold_comps: Optional[int] = None
    scarcity_adjustment: Optional[float] = None
    liquidity_adjustment: Optional[float] = None
    condition_confidence: Optional[float] = None
    # Phase 33D negotiation / recommendations
    participant_side: Optional[str] = None
    authorized_thread_id: Optional[str] = None
    thread: Optional[dict] = None
    messages: Optional[list] = None
    offers: Optional[list] = None
    market_candidates: Optional[list] = None
    asking_price: Optional[float] = None
    budget: Optional[float] = None
    seller_minimum: Optional[float] = None
    recommendation_mode: Optional[str] = None
    owned_entity_ids: Optional[list] = None
    negative_preferences: Optional[list] = None
    allow_public_cold_start: Optional[bool] = None
    max_results: Optional[int] = None
    max_per_artist: Optional[int] = None
    required_format: Optional[str] = None
    unauthorized_thread: Optional[bool] = None
    request_auto_send: Optional[bool] = None
    request_impersonation: Optional[bool] = None
    request_fabricated_leverage: Optional[bool] = None
    request_guaranteed_appreciation: Optional[bool] = None
    cross_user_collection_attempt: Optional[bool] = None
    cross_user_watchlist_attempt: Optional[bool] = None


def _intelligence_payload(body: IntelligenceBody, x_user_id: Optional[str]) -> dict:
    data = body.model_dump(exclude_none=True)
    uid = _user_id(x_user_id, None)
    if uid and "requesting_principal_fixture" not in data and "principal_id" not in data:
        data["principal_id"] = uid
    return data


@router.post("/intelligence/scarcity")
async def post_intelligence_scarcity(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33C scarcity — deterministic evidence engine (keyword/metadata default)."""
    return analyze_scarcity(_intelligence_payload(body, x_user_id))


@router.post("/intelligence/valuation")
async def post_intelligence_valuation(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33C valuation — sold-vs-asking separated ranges (not legacy RAG valuation)."""
    return analyze_valuation(_intelligence_payload(body, x_user_id))


@router.post("/intelligence/auction")
async def post_intelligence_auction(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33C single-auction intelligence (aggregates only; no bidder identity)."""
    payload = _intelligence_payload(body, x_user_id)
    payload["analysis_mode"] = "single_auction"
    return analyze_auction(payload)


@router.post("/intelligence/auction/watchlist-temperature")
async def post_intelligence_watchlist_temperature(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33C authorized watchlist-batch market temperature."""
    return analyze_watchlist_temperature(_intelligence_payload(body, x_user_id))


@router.post("/intelligence/negotiation")
async def post_intelligence_negotiation(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33D negotiation assistance — advisory only; automatic_send_allowed=false."""
    return analyze_negotiation(_intelligence_payload(body, x_user_id))


@router.post("/intelligence/recommendations")
async def post_intelligence_recommendations(
    body: IntelligenceBody,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
):
    """Phase 33D explainable recommendations — no pay-to-rank; keyword/metadata default."""
    return analyze_recommendations(_intelligence_payload(body, x_user_id))
