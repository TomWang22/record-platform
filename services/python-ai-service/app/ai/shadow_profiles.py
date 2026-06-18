"""T19.5 — Route-specific shadow vector profiles (diagnostic only; keyword unchanged)."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

ALLOWED_SHADOW_SOURCE_TYPES: Tuple[str, ...] = (
    "record",
    "listing",
    "listing_revision",
    "obo_offer_summary",
    "auction_bid_summary",
    "notification",
)

_PROFILE_ALIASES: Dict[str, str] = {
    "pricing_recommendation": "obo_helper",
    "buyer_collection_summary": "record_valuation",
}

_PROFILE_PREFERRED: Dict[str, List[str]] = {
    "auction_risk": [
        "auction_bid_summary",
        "listing",
        "listing_revision",
        "notification",
    ],
    "obo_helper": [
        "obo_offer_summary",
        "listing",
        "listing_revision",
        "record",
    ],
    "record_valuation": [
        "record",
        "listing",
        "notification",
    ],
    "seller_sales_summary": [
        "listing",
        "listing_revision",
        "obo_offer_summary",
        "auction_bid_summary",
        "notification",
    ],
    "generic_rag": list(ALLOWED_SHADOW_SOURCE_TYPES),
}


def resolve_shadow_profile(profile: str | None) -> str:
    """Unknown profiles fall back to generic_rag."""
    if not profile or not str(profile).strip():
        return "generic_rag"
    key = str(profile).strip().lower()
    key = _PROFILE_ALIASES.get(key, key)
    if key not in _PROFILE_PREFERRED:
        return "generic_rag"
    return key


def preferred_source_types(profile: str | None) -> List[str]:
    resolved = resolve_shadow_profile(profile)
    return list(_PROFILE_PREFERRED[resolved])


def source_type_weights(profile: str | None) -> Dict[str, float]:
    """Higher weight for earlier preferred types; non-preferred types rank lower."""
    preferred = preferred_source_types(profile)
    weights: Dict[str, float] = {}
    for i, st in enumerate(preferred):
        weights[st] = round(2.5 - (i * 0.35), 2)
    for st in ALLOWED_SHADOW_SOURCE_TYPES:
        if st not in weights:
            weights[st] = 0.35
    return weights


def profile_diagnostic_meta(profile: str | None) -> Dict[str, Any]:
    resolved = resolve_shadow_profile(profile)
    return {
        "profile": resolved,
        "preferred_source_types": preferred_source_types(resolved),
        "source_type_weights": source_type_weights(resolved),
    }
