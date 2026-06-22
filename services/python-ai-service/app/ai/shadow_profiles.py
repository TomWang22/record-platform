"""T19.5/T19.6 — Route-specific shadow vector profiles (diagnostic only; keyword unchanged)."""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

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

_OBO_FOCUS_HINTS = frozenset({"obo", "owner_visible", "owner-visible", "offer", "offers"})

_PROFILE_FIXED_WEIGHTS: Dict[str, Dict[str, float]] = {
    "obo_helper": {
        "obo_offer_summary": 3.5,
        "listing": 1.35,
        "listing_revision": 1.1,
        "record": 0.85,
        "auction_bid_summary": 0.35,
        "notification": 0.35,
    },
}


def _normalize_hints(custom_hints: Optional[Sequence[str]]) -> List[str]:
    if not custom_hints:
        return []
    return [str(h).strip().lower() for h in custom_hints if h and str(h).strip()]


def is_obo_focused(profile: str | None, custom_hints: Optional[Sequence[str]] = None) -> bool:
    """Shadow-only: OBO owner/seller prompts need stronger OBO selection."""
    resolved = resolve_shadow_profile(profile)
    if resolved == "obo_helper":
        return True
    hints = _normalize_hints(custom_hints)
    return any(h in _OBO_FOCUS_HINTS for h in hints)


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
    resolved = resolve_shadow_profile(profile)
    if resolved in _PROFILE_FIXED_WEIGHTS:
        weights = dict(_PROFILE_FIXED_WEIGHTS[resolved])
        for st in ALLOWED_SHADOW_SOURCE_TYPES:
            if st not in weights:
                weights[st] = 0.35
        return weights
    preferred = preferred_source_types(resolved)
    weights: Dict[str, float] = {}
    for i, st in enumerate(preferred):
        weights[st] = round(2.5 - (i * 0.35), 2)
    for st in ALLOWED_SHADOW_SOURCE_TYPES:
        if st not in weights:
            weights[st] = 0.35
    return weights


def preferred_type_quotas(
    profile: str | None,
    max_chunks: int,
    scope_by_type: Mapping[str, int],
    *,
    custom_hints: Optional[Sequence[str]] = None,
) -> Dict[str, int]:
    """Shadow-only reserved slots per source type before weighted fill."""
    resolved = resolve_shadow_profile(profile)
    preferred = preferred_source_types(resolved)
    quotas: Dict[str, int] = {}

    if is_obo_focused(resolved, custom_hints):
        obo_available = int(scope_by_type.get("obo_offer_summary", 0))
        if obo_available > 0:
            quotas["obo_offer_summary"] = min(
                obo_available,
                max(3, max_chunks // 2),
                max_chunks,
            )
        listing_available = int(scope_by_type.get("listing", 0))
        if listing_available > 0:
            quotas["listing"] = min(listing_available, 2)
        revision_available = int(scope_by_type.get("listing_revision", 0))
        if revision_available > 0:
            quotas["listing_revision"] = min(revision_available, 1)
        return quotas

    uniform = max(1, min(3, max_chunks // max(len(preferred), 1)))
    for st in preferred:
        if int(scope_by_type.get(st, 0)) > 0:
            quotas[st] = uniform
    return quotas


def non_primary_source_caps(
    profile: str | None,
    max_chunks: int,
    *,
    custom_hints: Optional[Sequence[str]] = None,
) -> Dict[str, int]:
    """Shadow-only hard caps for non-primary types during weighted fill."""
    if not is_obo_focused(profile, custom_hints):
        return {}
    return {
        "listing": min(3, max_chunks),
        "listing_revision": min(2, max_chunks),
        "record": 1,
        "notification": 1,
        "auction_bid_summary": 1,
    }


def vector_fetch_extra_types(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
) -> List[str]:
    """Shadow-only: narrow per-type vector fetches to cut latency on focused routes."""
    resolved = resolve_shadow_profile(profile)
    if is_obo_focused(resolved, custom_hints):
        return ["obo_offer_summary", "listing"]
    return preferred_source_types(resolved)[:3]


def profile_diagnostic_meta(profile: str | None) -> Dict[str, Any]:
    resolved = resolve_shadow_profile(profile)
    return {
        "profile": resolved,
        "preferred_source_types": preferred_source_types(resolved),
        "source_type_weights": source_type_weights(resolved),
        "obo_focused": is_obo_focused(resolved),
        "vector_fetch_extra_types": vector_fetch_extra_types(resolved),
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


def _cap_hint_expansion(
    base: str,
    hint_terms: List[str],
    max_expanded_chars: int | None,
) -> Tuple[str, List[str], bool]:
    """Shadow-only: keep embed input bounded when profile hints inflate query length."""
    base = base.strip()
    if not hint_terms:
        return base, [], False
    if not max_expanded_chars or max_expanded_chars <= 0:
        return f"{base} {' '.join(hint_terms)}", hint_terms, False
    used: List[str] = []
    truncated = False
    for term in hint_terms:
        candidate = f"{base} {' '.join([*used, term])}"
        if len(candidate) <= max_expanded_chars:
            used.append(term)
            continue
        truncated = True
        break
    if not used:
        return base, [], truncated
    return f"{base} {' '.join(used)}", used, truncated


def expand_query_with_hints(
    query: str,
    profile: str | None,
    *,
    apply_profile_hints: bool = False,
    custom_hints: List[str] | None = None,
    max_expanded_chars: int | None = None,
) -> Tuple[str, List[str], bool, bool]:
    """Shadow-only query expansion; keyword path must not call this."""
    hint_terms: List[str] = []
    if custom_hints:
        hint_terms.extend(h.strip() for h in custom_hints if h and h.strip())
    if apply_profile_hints:
        resolved = resolve_shadow_profile(profile)
        hint_terms.extend(_PROFILE_QUERY_HINTS.get(resolved, []))
    if not hint_terms:
        return query, [], False, False
    expanded, used_terms, truncated = _cap_hint_expansion(
        query,
        hint_terms,
        max_expanded_chars,
    )
    return expanded, used_terms, bool(used_terms), truncated
