"""T15.3C — Canonical AI HTTP routes."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

from app.ai import insights
from app.ai.config import AI_RAG_SHADOW_VECTOR

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


@router.post("/rag/query")
async def post_rag_query(
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
    return await insights.rag_query(
        user_id=_user_id(x_user_id, body.user_id),
        question=body.question,
        source_types=body.source_types,
        shadow_vector=shadow_vector or AI_RAG_SHADOW_VECTOR,
        shadow_profile=shadow_profile,
        shadow_profile_hints=shadow_profile_hints,
        shadow_custom_query_hints=_parse_custom_query_hints(shadow_query_hints),
        shadow_debug=shadow_debug,
    )


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
