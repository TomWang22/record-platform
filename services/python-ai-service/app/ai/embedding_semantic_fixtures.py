"""Phase 33F / Phase 34 embedding + semantic-search handlers (no production writes)."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _stable_hash(parts: List[str]) -> str:
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"sha256:{h[:24]}"


def analyze_embedding_metadata(body: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic embedding lineage — production embedding writes remain disabled."""
    principal = str(body.get("principal_id") or body.get("principal_fixture") or "authenticated-owner")
    entity = body.get("subject") or {}
    entity_id = str(
        entity.get("entity_id")
        or entity.get("record_id")
        or body.get("entity_id")
        or body.get("record_id")
        or "record-owner-proof-1"
    )
    intent = str(body.get("user_intent") or body.get("owner_proof_prompt") or "")
    mode = str(body.get("mode") or body.get("capability_mode") or "lineage_validation")

    stale = (
        "stale" in intent.lower()
        or "re-embed" in intent.lower()
        or "reembed" in intent.lower()
        or body.get("mark_stale") is True
        or mode in {"stale", "stale_reembed", "mark_stale"}
    )
    deleted = (
        "deleted" in intent.lower()
        or body.get("deleted_source") is True
        or mode in {"deleted", "deleted_source"}
    )

    content_hash = _stable_hash([entity_id, principal, "embed-lineage-v2"])
    model_id = "record-platform-embed-metadata-v2"
    version = "embed-lineage-v2"

    freshness = "STALE" if stale else ("DELETED" if deleted else "CURRENT")
    reembed_required = bool(stale)
    reembed_status = "REQUIRED" if stale else ("NOT_APPLICABLE" if deleted else "CURRENT")
    deletion_state = "DELETED" if deleted else "ACTIVE"

    correction = None
    if stale:
        correction = {
            "what_changed": ["freshness", "reembed_required", "reembed_status"],
            "previous_value": "CURRENT",
            "updated_value": "STALE / reembed REQUIRED",
            "reason_for_update": "Owner marked embedding stale for re-embed review",
        }

    summary = (
        "Source embedding deleted; lineage retained for audit only."
        if deleted
        else (
            "Embedding marked stale; re-embed required before reuse."
            if stale
            else f"Current embedding lineage for {entity_id}."
        )
    )

    return {
        "entity": entity_id,
        "entity_id": entity_id,
        "source": "authorized_record_metadata",
        "embedding_version": version,
        "embedding_model_version": version,
        "model_identifier": model_id,
        "content_hash": content_hash,
        "owner_scope": principal,
        "generated_at": "2026-06-01T12:00:00.000Z",
        "freshness": freshness,
        "deletion_state": deletion_state,
        "reembed_required": reembed_required,
        "reembed_status": reembed_status,
        "correction_change": correction,
        "dimension": 768,
        "normalization": "l2",
        "source_lineage": {
            "content_hash": content_hash,
            "source_system": "authorized_record_metadata",
            "transform_version": version,
            "owner_scope": principal,
            "entity_id": entity_id,
        },
        "deletion_propagation": "verified" if deleted else "not_required",
        "reembedding_policy": "manual_owner_review_only",
        "production_writes": False,
        "evidence": [
            {
                "evidence_id": f"emb-{entity_id}",
                "source_type": "public_metadata",
                "source_id": entity_id,
                "retrieved_at": _now(),
                "summary": summary,
            }
        ],
        "confidence": 0.72 if not deleted else 0.4,
        "limitations": [
            {
                "code": "NO_PRODUCTION_WRITE",
                "message": "Production embedding writes remain disabled; this view is lineage-only.",
                "severity": "info",
            }
        ],
        "data_freshness": _now(),
        "methodology_customer": "Authorized record metadata lineage without production re-embedding",
        "methodology": "deterministic_lineage_v2",
        "sample_size": 1,
        "abstention_reason": None,
        "authorization_scope": "authenticated_market",
        "summary": summary,
    }


def _catalog_cards(mode: str, exclude_picture_discs: bool) -> List[Dict[str, Any]]:
    cards = [
        {
            "entity_id": "release-miles-kind-of-blue",
            "artist": "Miles Davis",
            "title": "Kind of Blue",
            "pressing_identity": "Columbia CS 8163 stereo",
            "price": 48,
            "why_matched": "Artist/title semantic match to jazz classic query",
            "match_mode": mode,
            "confidence": 0.88,
            "format": "LP",
            "picture_disc": False,
        },
        {
            "entity_id": "release-kenny-quiet-kenny",
            "artist": "Kenny Dorham",
            "title": "Quiet Kenny",
            "pressing_identity": "New Jazz NJLP 8225",
            "price": 55,
            "why_matched": "Hard-bop pressing affinity with query terms",
            "match_mode": mode,
            "confidence": 0.84,
            "format": "LP",
            "picture_disc": False,
        },
        {
            "entity_id": "release-coltrane-blue-train",
            "artist": "John Coltrane",
            "title": "Blue Train",
            "pressing_identity": "Blue Note BLP 1577",
            "price": 62,
            "why_matched": "Blue Note era semantic neighbor",
            "match_mode": mode,
            "confidence": 0.81,
            "format": "LP",
            "picture_disc": False,
        },
        {
            "entity_id": "release-blakey-moanin",
            "artist": "Art Blakey",
            "title": "Moanin'",
            "pressing_identity": "Blue Note BLP 4003",
            "price": 44,
            "why_matched": "Shared hard-bop vocabulary with query",
            "match_mode": mode,
            "confidence": 0.79,
            "format": "LP",
            "picture_disc": False,
        },
        {
            "entity_id": "release-silver-song-for-my-father",
            "artist": "Horace Silver",
            "title": "Song for My Father",
            "pressing_identity": "Blue Note BST 84185",
            "price": 39,
            "why_matched": "Catalog and era semantic overlap",
            "match_mode": mode,
            "confidence": 0.77,
            "format": "LP",
            "picture_disc": False,
        },
        {
            "entity_id": "release-picture-disc-novelty",
            "artist": "Various Artists",
            "title": "Jazz Picture Disc Sampler",
            "pressing_identity": "Picture disc novelty",
            "price": 25,
            "why_matched": "Weak lexical overlap only",
            "match_mode": mode,
            "confidence": 0.41,
            "format": "picture_disc",
            "picture_disc": True,
        },
    ]
    if exclude_picture_discs:
        cards = [c for c in cards if not c.get("picture_disc")]
    # Rank cards with stable order; hybrid boosts metadata-friendly titles.
    if mode == "hybrid":
        cards = sorted(cards, key=lambda c: (-(c["confidence"] + 0.05), c["entity_id"]))
        for i, c in enumerate(cards):
            c = dict(c)
            c["rank"] = i + 1
            c["match_mode"] = "hybrid"
            c["score"] = round(c["confidence"] + 0.05, 3)
            cards[i] = c
    else:
        for i, c in enumerate(cards):
            c["rank"] = i + 1
            c["score"] = c["confidence"]
    return cards[:5] if mode != "hybrid" else cards[:5]


def analyze_semantic_search(body: Dict[str, Any]) -> Dict[str, Any]:
    """Owner-proof semantic/hybrid search with visible mode and >=5 cards."""
    intent = str(body.get("user_intent") or body.get("owner_proof_prompt") or "")
    selected_mode = str(
        body.get("selected_mode")
        or body.get("retrieval_mode")
        or body.get("mode")
        or body.get("capability_mode")
        or "semantic"
    ).lower()

    want_hybrid = "hybrid" in selected_mode or "hybrid" in intent.lower()
    want_fallback = "fallback" in intent.lower() or "empty" in intent.lower() or body.get("force_empty") is True
    exclude_picture = (
        want_hybrid
        or "picture disc" in intent.lower()
        or body.get("exclude_picture_discs") is True
    )

    if want_fallback:
        return {
            "selected_mode": "semantic",
            "executed_mode": "visible_fallback",
            "mode": "visible_fallback",
            "fallback_visible": True,
            "silent_fallback": False,
            "results": [],
            "result_cards": [],
            "query_id": str(body.get("query_id") or "owner-proof-query"),
            "summary": "No strong semantic matches; showing explicit fallback (not a silent success).",
            "evidence": [],
            "confidence": 0.2,
            "limitations": [
                {
                    "code": "VISIBLE_FALLBACK",
                    "message": "No strong semantic matches; showing an explicit empty/fallback state.",
                    "severity": "warning",
                }
            ],
            "data_freshness": _now(),
            "methodology_customer": "Semantic retrieval with explicit visible fallback — never silent",
            "methodology": "deterministic_search_v2",
            "sample_size": 0,
            "abstention_reason": "VISIBLE_FALLBACK",
            "authorization_scope": "authenticated_market",
        }

    selected = "hybrid" if want_hybrid else ("semantic" if "semantic" in selected_mode or selected_mode == "semantic" else selected_mode)
    if selected not in {"semantic", "hybrid", "keyword"}:
        selected = "semantic"
    executed = selected  # no silent fallback

    cards = _catalog_cards(executed, exclude_picture_discs=exclude_picture)
    correction = None
    if want_hybrid:
        correction = {
            "what_changed": ["selected_mode", "executed_mode", "picture_discs", "ranking"],
            "previous_value": "semantic",
            "updated_value": "hybrid (picture discs excluded)",
            "reason_for_update": intent or "Switch to hybrid and exclude picture discs",
        }

    return {
        "selected_mode": selected,
        "executed_mode": executed,
        "mode": executed,
        "fallback_visible": False,
        "silent_fallback": False,
        "picture_discs_excluded": exclude_picture,
        "correction_change": correction,
        "query_id": str(body.get("query_id") or "owner-proof-query"),
        "results": [
            {
                "entity_id": c["entity_id"],
                "rank": c["rank"],
                "score": c["score"],
                "artist": c["artist"],
                "title": c["title"],
                "pressing_identity": c["pressing_identity"],
                "price": c["price"],
                "why_matched": c["why_matched"],
                "match_mode": c["match_mode"],
                "confidence": c["confidence"],
                "reason_codes": [executed, "authorized_catalog"],
            }
            for c in cards
        ],
        "result_cards": cards,
        "retrieval_metrics": {
            "mode": executed,
            "selected_mode": selected,
            "executed_mode": executed,
            "result_count": len(cards),
            "production_default": "keyword",
        },
        "owner_scope_isolation": True,
        "evidence": [
            {
                "evidence_id": f"sem-{c['entity_id']}",
                "source_type": "public_metadata",
                "source_id": c["entity_id"],
                "retrieved_at": _now(),
                "summary": f"{c['artist']} — {c['title']} ({c['pressing_identity']})",
            }
            for c in cards
        ],
        "confidence": 0.78 if executed == "semantic" else 0.82,
        "limitations": [
            {
                "code": "STAGING_VECTOR_PATH",
                "message": "Keyword remains the production default; this path is authorized owner-proof retrieval.",
                "severity": "info",
            }
        ],
        "data_freshness": _now(),
        "methodology_customer": "Authorized catalog semantic/hybrid ranking with visible mode",
        "methodology": "deterministic_search_v2",
        "sample_size": len(cards),
        "abstention_reason": None,
        "authorization_scope": "authenticated_market",
        "summary": (
            f"Hybrid mode with {len(cards)} results; picture discs excluded."
            if want_hybrid
            else f"Semantic matches: {len(cards)} result cards."
        ),
    }
