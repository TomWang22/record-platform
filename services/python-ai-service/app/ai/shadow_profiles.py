"""T19.5/T19.6 — Route-specific shadow vector profiles (diagnostic only; keyword unchanged)."""
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

_PROFILE_QUERY_HINTS: Dict[str, List[str]] = {
    "auction_risk": [
        "bid history",
        "current bid",
        "reserve",
        "ending soon",
        "proxy pressure",
        "listing revision",
    ],
    "obo_helper": [
        "offer",
        "counter",
        "accepted",
        "rejected",
        "withdrawn",
        "fair price",
        "listing price",
        "buyer",
        "seller",
    ],
    "record_valuation": [
        "record",
        "artist",
        "title",
        "condition",
        "format",
        "purchase",
        "collection",
        "valuation",
    ],
    "seller_sales_summary": [
        "seller",
        "listing",
        "sold",
        "offer",
        "auction",
        "revenue",
        "notification",
        "performance",
    ],
    "generic_rag": ["marketplace", "listing"],
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


def resolved_profile_for_diagnostics(profile: str | None) -> Dict[str, Any]:
    """Shadow-only serialization for diagnostics; does not affect keyword retrieval."""
    resolved = resolve_shadow_profile(profile)
    meta = profile_diagnostic_meta(resolved)
    return {
        **meta,
        "query_hints_available": list(_PROFILE_QUERY_HINTS.get(resolved, [])),
        "notes": [f"shadow-only profile {resolved}"],
    }


def expand_query_with_hints(
    query: str,
    profile: str | None,
    *,
    apply_profile_hints: bool = False,
    custom_hints: List[str] | None = None,
) -> Tuple[str, List[str], bool]:
    """Shadow-only query expansion; keyword path must not call this."""
    hint_terms: List[str] = []
    if custom_hints:
        hint_terms.extend(h.strip() for h in custom_hints if h and h.strip())
    if apply_profile_hints:
        resolved = resolve_shadow_profile(profile)
        hint_terms.extend(_PROFILE_QUERY_HINTS.get(resolved, []))
    if not hint_terms:
        return query, [], False
    expanded = f"{query.strip()} {' '.join(hint_terms)}"
    return expanded, hint_terms, True
