"""T15.3C — Canonical insight builders (rules + optional Ollama explanation)."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.ai.envelope import build_envelope, chunk_to_citation, source_ref
from app.ai.outbox import insert_pricing_recommendation_outbox, publish_python_ai_outbox_tick
from app.ai.providers.registry import get_provider, resolve_model_used
from app.ai.providers.rule_engine import (
    auction_risk_signals,
    listing_quality_checklist,
    pricing_band_from_chunks,
)
from app.ai.rag_retrieval import (
    build_shadow_vector_diagnostic,
    fetch_document_chunks_for_user,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.db import get_pool


def _coerce_metadata(meta: Any) -> Dict[str, Any]:
    if meta is None:
        return {}
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        try:
            parsed = json.loads(meta)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


async def _with_conn(fn):
    pool = await get_pool()
    if not pool:
        return None, "python_ai_db_unavailable"
    async with pool.acquire() as conn:
        return await fn(conn), None


def _join_content(chunks: List[Dict[str, Any]]) -> str:
    return "\n\n".join(c.get("content") or "" for c in chunks)


async def rag_query(
    *,
    user_id: Optional[str],
    question: str,
    source_types: Optional[List[str]] = None,
    shadow_vector: bool = False,
    shadow_profile: Optional[str] = None,
    shadow_profile_hints: bool = False,
    shadow_custom_query_hints: Optional[List[str]] = None,
    shadow_debug: bool = False,
) -> Dict[str, Any]:
    async def run(conn):
        keyword = await retrieve_chunks(conn, query=question, user_id=user_id, source_types=source_types)
        shadow_diag = None
        shadow_diagnostics = None
        if shadow_vector:
            shadow = await retrieve_chunks_vector_shadow(
                conn,
                query=question,
                user_id=user_id,
                source_types=source_types,
                route_shadow_profile=shadow_profile,
                shadow_profile_hints=shadow_profile_hints,
                shadow_custom_query_hints=shadow_custom_query_hints,
                include_diagnostics=shadow_debug,
                keyword_chunks_for_overlap=keyword["chunks"] if shadow_debug else None,
            )
            unweighted_result = {
                "candidate_count": shadow.get("unweighted_candidate_count", shadow.get("candidate_count", 0)),
                "chunks": shadow.get("unweighted_chunks", shadow.get("chunks", [])),
                "chunk_ids": shadow.get("unweighted_chunk_ids", shadow.get("chunk_ids", [])),
                "latency_ms": shadow.get("latency_ms"),
            }
            shadow_diag = build_shadow_vector_diagnostic(
                keyword["chunks"], shadow, unweighted_result=unweighted_result
            )
            if shadow_debug and shadow.get("shadow_diagnostics"):
                shadow_diagnostics = shadow["shadow_diagnostics"]
        return keyword, shadow_diag, shadow_diagnostics

    result, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "rag_query",
            source_status="degraded",
            model_used="none",
            summary="RAG corpus unavailable",
            details={},
            source_refs=[],
            degraded_reason=err,
        )
    keyword_result, shadow_diag, shadow_diagnostics = result
    chunks = keyword_result["chunks"]
    refs = keyword_result["source_refs"]
    citations = [chunk_to_citation(c) for c in chunks[:5]]
    status = "live" if refs else "degraded"
    summary = f"Retrieved {len(chunks)} grounded excerpts for your question."
    if not chunks:
        summary = "No matching corpus excerpts for this question."
    details = {
        "retrieval_mode": keyword_result["retrieval_mode"],
        "chunk_count": len(chunks),
        "excerpts": [c.get("content", "")[:300] for c in chunks[:3]],
    }
    if shadow_diag is not None:
        details["shadow_vector"] = shadow_diag
    if shadow_diagnostics is not None:
        details["shadow_diagnostics"] = shadow_diagnostics
    provider = get_provider()
    if provider.name == "ollama" and chunks:
        expl = await provider.explain(
            f"Summarize only from these sources:\n{_join_content(chunks[:3])}\n\nQuestion: {question}",
            system="Cite only provided excerpts. No fabrication.",
        )
        if expl.get("ok") and expl.get("text"):
            details["explanation"] = expl["text"][:800]
            model_used = expl.get("model_used") or model_used
        elif model_deg:
            details["model_degraded_reason"] = model_deg
    elif model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "rag_query",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=refs,
        citations=citations,
        confidence=0.7 if refs else 0.0,
        degraded_reason=None if status == "live" else "no_matching_chunks",
    )


async def record_valuation(*, user_id: Optional[str], record_id: str) -> Dict[str, Any]:
    async def run(conn):
        rec = await fetch_document_chunks_for_user(
            conn, user_id=user_id, source_type="record", source_id=record_id
        )
        comps = await retrieve_chunks(
            conn,
            query=_join_content(rec["chunks"]),
            user_id=user_id,
            source_types=["listing", "obo_offer_summary"],
            max_chunks=5,
        )
        return rec, comps

    data, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "record_valuation",
            source_status="degraded",
            model_used="none",
            summary="Record valuation unavailable",
            degraded_reason=err,
        )
    rec, comps = data
    refs = rec["source_refs"] + comps["source_refs"]
    band = pricing_band_from_chunks(rec["chunks"] + comps["chunks"])
    status = "live" if rec["source_refs"] else "degraded"
    summary = (
        f"Estimated band ${band['low']}-${band['high']} from collection record and comparables."
        if band["low"] is not None
        else "Record located; insufficient comparable pricing in corpus."
    )
    details = {"valuation_band": band, "comparable_chunks": len(comps["chunks"])}
    if model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "record_valuation",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=refs,
        confidence=0.65 if band["low"] is not None else 0.3,
        degraded_reason=None if status == "live" else "record_not_in_corpus",
    )


async def listing_pricing_advice(*, user_id: Optional[str], listing_id: str) -> Dict[str, Any]:
    async def run(conn):
        listing = await fetch_document_chunks_for_user(
            conn, user_id=user_id, source_type="listing", source_id=listing_id
        )
        revs = await retrieve_chunks(
            conn,
            query="",
            user_id=user_id,
            source_types=["listing_revision"],
            metadata_listing_id=listing_id,
            max_chunks=3,
        )
        obo = await retrieve_chunks(
            conn, query=listing_id, user_id=user_id, source_types=["obo_offer_summary"], max_chunks=5
        )
        auction = await retrieve_chunks(
            conn, query=listing_id, user_id=user_id, source_types=["auction_bid_summary"], max_chunks=3
        )
        comps = await retrieve_chunks(
            conn, query=_join_content(listing["chunks"]), user_id=user_id, source_types=["listing"], max_chunks=5
        )
        return listing, revs, obo, auction, comps

    data, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "pricing_recommendation",
            source_status="degraded",
            model_used="none",
            summary="Pricing advice unavailable",
            degraded_reason=err,
        )
    listing, revs, obo, auction, comps = data
    all_chunks = listing["chunks"] + revs["chunks"] + obo["chunks"] + auction["chunks"] + comps["chunks"]
    refs: List[Dict[str, Any]] = []
    for part in (listing, revs, obo, auction, comps):
        refs.extend(part["source_refs"])
    # dedupe
    seen = set()
    unique_refs = []
    for r in refs:
        k = (r["source_type"], r["source_id"])
        if k in seen:
            continue
        seen.add(k)
        unique_refs.append(r)
    band = pricing_band_from_chunks(all_chunks)
    quality = listing_quality_checklist(_join_content(listing["chunks"]))
    status = "live" if unique_refs else "degraded"
    summary = (
        f"Suggested price near ${band['mid']} based on listing, revisions, and offer/auction summaries."
        if band["mid"] is not None
        else "Listing corpus found; expand pricing signals with active comparables."
    )
    details = {
        "suggested_fixed_price": band.get("mid"),
        "obo_floor": band.get("low"),
        "auction_starting_bid": band.get("low"),
        "auction_reserve_hint": band.get("mid"),
        "quality_signals": quality,
        "negotiation_guidance": {
            "recommendation": "review_offer_summaries",
            "note": "Offer summaries only; private message bodies are not ingested.",
        },
    }
    if model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "pricing_recommendation",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=unique_refs,
        confidence=0.6 if band["mid"] is not None else 0.25,
        degraded_reason=None if status == "live" else "listing_not_in_corpus",
    )


async def auction_risk(*, user_id: Optional[str], listing_id: str) -> Dict[str, Any]:
    async def run(conn):
        found = await retrieve_chunks(
            conn,
            query=listing_id,
            user_id=user_id,
            source_types=["auction_bid_summary"],
            source_id=listing_id,
            max_chunks=6,
        )
        if found["chunks"]:
            return found
        return await retrieve_chunks(
            conn,
            query=listing_id,
            user_id=user_id,
            source_types=["auction_bid_summary"],
            metadata_listing_id=listing_id,
            max_chunks=6,
        )

    result, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "auction_risk",
            source_status="degraded",
            model_used="none",
            summary="Auction risk unavailable",
            degraded_reason=err,
        )
    chunks = result["chunks"]
    refs = result["source_refs"]
    text = _join_content(chunks)
    meta = _coerce_metadata(chunks[0].get("metadata") if chunks else None)
    signals = auction_risk_signals(text, meta)
    status = "live" if refs else "degraded"
    summary = f"{len(signals)} auction risk signal(s) from bid summaries."
    details = {"signals": signals, "bidder_masking": "bidder hashes only in corpus"}
    if model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "auction_risk",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=refs,
        confidence=0.55 if signals else 0.2,
        degraded_reason=None if status == "live" else "auction_summary_missing",
    )


async def seller_summary(*, user_id: Optional[str]) -> Dict[str, Any]:
    async def run(conn):
        return await retrieve_chunks(
            conn,
            query="seller listing offer auction",
            user_id=user_id,
            source_types=["listing", "obo_offer_summary", "auction_bid_summary", "notification"],
            max_chunks=10,
        )

    result, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "seller_sales_summary",
            source_status="degraded",
            model_used="none",
            summary="Seller summary unavailable",
            degraded_reason=err,
        )
    refs = result["source_refs"]
    by_type: Dict[str, int] = {}
    for r in refs:
        by_type[r["source_type"]] = by_type.get(r["source_type"], 0) + 1
    status = "live" if refs else "degraded"
    summary = f"Seller activity across {len(refs)} grounded sources."
    details = {"counts_by_source_type": by_type, "metrics": {"source_documents": len(refs)}}
    if model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "seller_sales_summary",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=refs,
        confidence=0.5 if refs else 0.0,
        degraded_reason=None if status == "live" else "no_seller_corpus",
    )


async def buyer_collection_summary(*, user_id: Optional[str]) -> Dict[str, Any]:
    async def run(conn):
        records = await retrieve_chunks(
            conn,
            query="",
            user_id=user_id,
            source_types=["record"],
            max_chunks=12,
        )
        notes = await retrieve_chunks(
            conn,
            query="purchase acquisition",
            user_id=user_id,
            source_types=["notification"],
            max_chunks=6,
        )
        merged_chunks = records["chunks"] + notes["chunks"]
        merged_refs = records["source_refs"] + notes["source_refs"]
        seen = set()
        unique_refs = []
        for r in merged_refs:
            k = (r["source_type"], r["source_id"])
            if k in seen:
                continue
            seen.add(k)
            unique_refs.append(r)
        return {
            "chunks": merged_chunks,
            "source_refs": unique_refs,
            "retrieval_mode": "keyword",
            "token_count": records.get("token_count", 0) + notes.get("token_count", 0),
            "embedding_available": False,
        }

    result, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "buyer_collection_summary",
            source_status="degraded",
            model_used="none",
            summary="Collection summary unavailable",
            degraded_reason=err,
        )
    refs = result["source_refs"]
    records = [r for r in refs if r["source_type"] == "record"]
    status = "live" if records else "degraded"
    summary = f"Collection spans {len(records)} catalogued records."
    details = {
        "record_count": len(records),
        "acquisition_patterns": {"grounded_records": len(records)},
    }
    if model_deg:
        details["model_degraded_reason"] = model_deg
    return build_envelope(
        "buyer_collection_summary",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=refs,
        confidence=0.55 if records else 0.0,
        degraded_reason=None if status == "live" else "no_record_corpus",
    )


async def offer_insights(*, user_id: Optional[str], listing_id: str) -> Dict[str, Any]:
    """T15.4C — OBO negotiation helper signals (summaries only, no raw negotiation text)."""
    async def run(conn):
        listing = await fetch_document_chunks_for_user(
            conn, user_id=user_id, source_type="listing", source_id=listing_id
        )
        obo = await retrieve_chunks(
            conn,
            query=listing_id,
            user_id=user_id,
            source_types=["obo_offer_summary"],
            max_chunks=8,
        )
        trends = await retrieve_chunks(
            conn,
            query=_join_content(listing["chunks"]),
            user_id=user_id,
            source_types=["listing", "listing_revision"],
            max_chunks=5,
        )
        return listing, obo, trends

    data, err = await _with_conn(run)
    model_used, model_deg = await resolve_model_used()
    if err:
        return build_envelope(
            "pricing_recommendation",
            source_status="degraded",
            model_used="none",
            summary="Offer insights unavailable",
            degraded_reason=err,
        )
    listing, obo, trends = data
    refs = listing["source_refs"] + obo["source_refs"] + trends["source_refs"]
    seen = set()
    unique_refs: List[Dict[str, Any]] = []
    for r in refs:
        k = (r["source_type"], r["source_id"])
        if k in seen:
            continue
        seen.add(k)
        unique_refs.append(r)
    band = pricing_band_from_chunks(listing["chunks"] + obo["chunks"] + trends["chunks"])
    obo_count = len(obo["chunks"])
    signals: List[Dict[str, Any]] = []
    if band.get("mid") is not None:
        signals.append({
            "code": "fair_offer_band",
            "low": band.get("low"),
            "high": band.get("high"),
            "mid": band.get("mid"),
        })
    if obo_count > 0:
        signals.append({"code": "counter_suggestion", "action": "review_latest_offer_summary"})
        signals.append({"code": "buyer_pressure", "offer_summaries": obo_count})
    else:
        signals.append({"code": "stale_offer", "detail": "No OBO summaries in corpus for listing"})
    if band.get("low") is not None and band.get("mid") is not None:
        spread = float(band["mid"]) - float(band["low"])
        if spread > float(band["mid"]) * 0.25:
            signals.append({"code": "accept_risk", "detail": "Wide offer band vs listing trend"})
    status = "live" if unique_refs else "degraded"
    summary = f"{len(signals)} OBO helper signal(s) from offer summaries and listing trends."
    details = {
        "signals": signals,
        "privacy": "offer_summaries_only_no_message_bodies",
    }
    if model_deg:
        details["model_degraded_reason"] = model_deg
    envelope = build_envelope(
        "pricing_recommendation",
        source_status=status,
        model_used=model_used,
        summary=summary,
        details=details,
        source_refs=unique_refs,
        confidence=0.6 if obo_count else 0.35,
        degraded_reason=None if status == "live" else "no_obo_corpus",
    )
    if user_id and status == "live":
        async def persist(conn):
            await insert_pricing_recommendation_outbox(
                conn,
                user_id=user_id,
                listing_id=listing_id,
                envelope=envelope,
            )
            await publish_python_ai_outbox_tick(conn)
        await _with_conn(persist)
    return envelope
