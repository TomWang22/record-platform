"""T19.5/T19.6 — Route-specific shadow vector profiles (diagnostic only; keyword unchanged)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

ALLOWED_SHADOW_SOURCE_TYPES: Tuple[str, ...] = (
    "record",
    "listing",
    "listing_revision",
    "obo_offer_summary",
    "auction_bid_summary",
    "notification",
)

# T20.10AC/AF — diagnostic overlap refinement caps (flags default off in config).
SHADOW_NEIGHBOR_PER_DOC = 1
SHADOW_NEIGHBOR_GLOBAL_CAP = 3
SHADOW_NEIGHBOR_DOCS_CONSIDERED = 3
SHADOW_ENTITY_LISTING_FETCH_LIMIT = 8
SHADOW_ENTITY_LISTING_ID_CAP = 5
SHADOW_ENTITY_HINT_SCORE_MULTIPLIER = 1.5

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

_LISTING_REVISION_TERMS = frozenset(
    {"revision", "revisions", "pricing", "price", "priced", "reprice"}
)
_NOTIFICATION_TERMS = frozenset({"notification", "notifications", "notify"})
_OBO_QUERY_TERMS = frozenset(
    {"offer", "offers", "obo", "counter", "negotiation", "negotiate", "bid", "bidding"}
)
_AUCTION_QUERY_TERMS = frozenset({"auction", "proxy", "reserve"})
_LISTING_QUERY_TERMS = frozenset({"listing", "listings", "catalog", "seller", "selling"})

_PROFILE_FIXED_WEIGHTS: Dict[str, Dict[str, float]] = {
    "obo_helper": {
        "obo_offer_summary": 3.5,
        "listing": 1.35,
        "listing_revision": 1.1,
        "record": 0.85,
        "auction_bid_summary": 0.35,
        "notification": 0.35,
    },
    "seller_sales_summary": {
        "obo_offer_summary": 2.8,
        "listing": 2.2,
        "listing_revision": 2.4,
        "notification": 2.0,
        "auction_bid_summary": 1.6,
        "record": 1.0,
    },
}


def _normalize_hints(custom_hints: Optional[Sequence[str]]) -> List[str]:
    if not custom_hints:
        return []
    return [str(h).strip().lower() for h in custom_hints if h and str(h).strip()]


def _query_tokens(query: str) -> set[str]:
    return set(re.findall(r"[a-z0-9'-]+", (query or "").lower()))


def _query_has_terms(query: str, terms: frozenset[str]) -> bool:
    tokens = _query_tokens(query)
    return bool(tokens & terms) or any(term in (query or "").lower() for term in terms)


def infer_shadow_profile_from_query(query: str) -> str:
    """Shadow-only: pick a route profile when none is supplied explicitly."""
    q = (query or "").lower()
    tokens = _query_tokens(query)
    if "owner-visible" in q or "owner visible" in q:
        return "obo_helper"
    if _query_has_terms(query, _NOTIFICATION_TERMS) and not _query_has_terms(query, _OBO_QUERY_TERMS):
        return "seller_sales_summary"
    if _query_has_terms(query, _AUCTION_QUERY_TERMS) and not _query_has_terms(query, _OBO_QUERY_TERMS):
        return "auction_risk"
    if _query_has_terms(query, _LISTING_REVISION_TERMS):
        return "seller_sales_summary"
    if _query_has_terms(query, _OBO_QUERY_TERMS):
        return "seller_sales_summary"
    if _query_has_terms(query, _LISTING_QUERY_TERMS):
        return "seller_sales_summary"
    if tokens:
        return "seller_sales_summary"
    return "generic_rag"


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
    query: str = "",
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

    if resolved == "seller_sales_summary":
        remaining = max_chunks
        if _query_has_terms(query, _OBO_QUERY_TERMS):
            obo_available = int(scope_by_type.get("obo_offer_summary", 0))
            if obo_available > 0:
                slot = min(obo_available, 3, remaining)
                quotas["obo_offer_summary"] = slot
                remaining -= slot
        if _query_has_terms(query, _LISTING_REVISION_TERMS):
            revision_available = int(scope_by_type.get("listing_revision", 0))
            if revision_available > 0 and remaining > 0:
                slot = min(revision_available, 3, remaining)
                quotas["listing_revision"] = slot
                remaining -= slot
        if _query_has_terms(query, _NOTIFICATION_TERMS):
            notification_available = int(scope_by_type.get("notification", 0))
            if notification_available > 0 and remaining > 0:
                slot = min(notification_available, 2, remaining)
                quotas["notification"] = slot
                remaining -= slot
        listing_available = int(scope_by_type.get("listing", 0))
        if listing_available > 0 and remaining > 0:
            quotas["listing"] = min(listing_available, max(2, remaining))
        if quotas:
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
    if is_obo_focused(profile, custom_hints):
        return {
            "listing": min(3, max_chunks),
            "listing_revision": min(2, max_chunks),
            "record": 1,
            "notification": 1,
            "auction_bid_summary": 1,
        }
    resolved = resolve_shadow_profile(profile)
    if resolved == "seller_sales_summary":
        return {
            "notification": min(2, max_chunks),
            "auction_bid_summary": min(2, max_chunks),
            "record": 1,
        }
    return {}


SHADOW_MIN_SOURCE_DIVERSITY = 5
SHADOW_DIVERSITY_TOPUP_LIMIT = 3


@dataclass(frozen=True, slots=True)
class ShadowFetchStrategy:
    """Shadow-only candidate fetch plan (T20.10W/T20.10Y); keyword path must not use this."""

    fetch_strategy: str  # scoped_first | global_first
    primary_source_type: Optional[str]
    extra_source_types: List[str]
    diversity_topup_source_types: List[str]
    diversity_topup_limit: int = SHADOW_DIVERSITY_TOPUP_LIMIT
    min_source_diversity: int = SHADOW_MIN_SOURCE_DIVERSITY


def resolve_primary_source_type(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
    *,
    query: str = "",
    scope_by_type: Mapping[str, int],
) -> Optional[str]:
    """Shadow-only: primary typed fetch for strongly classified route profiles."""
    resolved = resolve_shadow_profile(profile)
    if resolved == "generic_rag":
        return None

    if is_obo_focused(resolved, custom_hints):
        if int(scope_by_type.get("obo_offer_summary", 0)) > 0:
            return "obo_offer_summary"
        return None

    if resolved == "record_valuation":
        if int(scope_by_type.get("record", 0)) > 0:
            return "record"
        return None

    if resolved == "auction_risk":
        if int(scope_by_type.get("auction_bid_summary", 0)) > 0:
            return "auction_bid_summary"
        return None

    if resolved == "seller_sales_summary":
        if _query_has_terms(query, _NOTIFICATION_TERMS) and not _query_has_terms(query, _OBO_QUERY_TERMS):
            if int(scope_by_type.get("notification", 0)) > 0:
                return "notification"
        if _query_has_terms(query, _LISTING_REVISION_TERMS):
            if int(scope_by_type.get("listing_revision", 0)) > 0:
                return "listing_revision"
        if _query_has_terms(query, _OBO_QUERY_TERMS):
            if int(scope_by_type.get("obo_offer_summary", 0)) > 0:
                return "obo_offer_summary"
        if int(scope_by_type.get("listing", 0)) > 0:
            return "listing"
        return None

    return None


def _extra_source_types_excluding_primary(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
    *,
    query: str = "",
    primary_source_type: Optional[str] = None,
) -> List[str]:
    extras = vector_fetch_extra_types(profile, custom_hints, query=query)
    seen: set[str] = set()
    ordered: List[str] = []
    for st in extras:
        if st == primary_source_type or st in seen:
            continue
        seen.add(st)
        ordered.append(st)
    return ordered


def diversity_topup_source_types(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
    *,
    query: str = "",
    primary_source_type: Optional[str] = None,
    scope_by_type: Mapping[str, int],
) -> List[str]:
    """Shadow-only: small typed fetches to restore rollout source-diversity gate."""
    resolved = resolve_shadow_profile(profile)
    candidates: List[str]

    if is_obo_focused(resolved, custom_hints) or resolved == "obo_helper":
        candidates = ["listing", "listing_revision", "notification"]
    elif resolved == "record_valuation":
        candidates = ["listing", "listing_revision", "notification", "obo_offer_summary"]
    elif resolved == "seller_sales_summary":
        candidates = ["listing_revision", "notification", "obo_offer_summary", "listing"]
    elif resolved == "auction_risk":
        candidates = ["listing", "listing_revision"]
    elif resolved == "generic_rag":
        if _query_has_terms(query, _NOTIFICATION_TERMS):
            candidates = ["notification", "listing", "listing_revision", "obo_offer_summary"]
        else:
            candidates = ["listing_revision", "notification", "listing"]
    else:
        candidates = ["listing_revision", "notification"]

    seen: set[str] = set()
    ordered: List[str] = []
    for st in candidates:
        if st == primary_source_type or st in seen:
            continue
        if int(scope_by_type.get(st, 0)) <= 0:
            continue
        seen.add(st)
        ordered.append(st)
    return ordered


def pool_diversity_satisfied(
    pool_by_type: Mapping[str, int],
    min_distinct: int = SHADOW_MIN_SOURCE_DIVERSITY,
) -> bool:
    """Shadow-only: distinct source types present in candidate pool."""
    distinct = sum(1 for count in pool_by_type.values() if int(count) > 0)
    return distinct >= min_distinct


def resolve_shadow_fetch_strategy(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
    *,
    query: str = "",
    scope_by_type: Mapping[str, int],
) -> ShadowFetchStrategy:
    """Shadow-only fetch ordering for route-mode vector retrieval."""
    primary = resolve_primary_source_type(
        profile,
        custom_hints,
        query=query,
        scope_by_type=scope_by_type,
    )
    extras = _extra_source_types_excluding_primary(
        profile,
        custom_hints,
        query=query,
        primary_source_type=primary,
    )
    topups = diversity_topup_source_types(
        profile,
        custom_hints,
        query=query,
        primary_source_type=primary,
        scope_by_type=scope_by_type,
    )
    fetch_strategy = "scoped_first" if primary else "global_first"
    return ShadowFetchStrategy(
        fetch_strategy=fetch_strategy,
        primary_source_type=primary,
        extra_source_types=extras,
        diversity_topup_source_types=topups,
        diversity_topup_limit=SHADOW_DIVERSITY_TOPUP_LIMIT,
        min_source_diversity=SHADOW_MIN_SOURCE_DIVERSITY,
    )


def candidate_pool_is_sufficient(
    pool_size: int,
    max_chunks: int,
    *,
    pool_by_type: Mapping[str, int],
    profile: str | None,
    scope_by_type: Mapping[str, int],
    custom_hints: Optional[Sequence[str]] = None,
    query: str = "",
    primary_source_type: Optional[str] = None,
) -> bool:
    """Shadow-only: enough candidates to skip further fetches."""
    if pool_size >= max_chunks:
        return True
    if primary_source_type:
        available = int(scope_by_type.get(primary_source_type, 0))
        fetched = int(pool_by_type.get(primary_source_type, 0))
        if available > 0 and fetched >= min(available, max_chunks):
            return True
    quotas = preferred_type_quotas(
        profile,
        max_chunks,
        scope_by_type,
        custom_hints=custom_hints,
        query=query,
    )
    if quotas and pool_size >= sum(min(q, int(scope_by_type.get(st, 0))) for st, q in quotas.items()):
        return True
    return False


def source_type_quota_satisfied(
    source_type: str,
    pool_by_type: Mapping[str, int],
    profile: str | None,
    max_chunks: int,
    scope_by_type: Mapping[str, int],
    custom_hints: Optional[Sequence[str]] = None,
    query: str = "",
) -> bool:
    """Shadow-only: per-type quota already met in the current candidate pool."""
    quotas = preferred_type_quotas(
        profile,
        max_chunks,
        scope_by_type,
        custom_hints=custom_hints,
        query=query,
    )
    quota = quotas.get(source_type, 0)
    if quota <= 0:
        return False
    return int(pool_by_type.get(source_type, 0)) >= quota


def needs_global_fallback(
    pool_size: int,
    max_chunks: int,
    *,
    pool_by_type: Mapping[str, int],
    profile: str | None,
    scope_by_type: Mapping[str, int],
    custom_hints: Optional[Sequence[str]] = None,
    query: str = "",
    primary_source_type: Optional[str] = None,
) -> bool:
    """Shadow-only: global fetch required after primary typed fetch underfills."""
    return not candidate_pool_is_sufficient(
        pool_size,
        max_chunks,
        pool_by_type=pool_by_type,
        profile=profile,
        scope_by_type=scope_by_type,
        custom_hints=custom_hints,
        query=query,
        primary_source_type=primary_source_type,
    )


def vector_fetch_extra_types(
    profile: str | None,
    custom_hints: Optional[Sequence[str]] = None,
    *,
    query: str = "",
) -> List[str]:
    """Shadow-only: narrow per-type vector fetches to cut latency on focused routes."""
    resolved = resolve_shadow_profile(profile)
    if is_obo_focused(resolved, custom_hints):
        return ["obo_offer_summary", "listing"]
    if resolved == "seller_sales_summary":
        extra: List[str] = ["listing", "obo_offer_summary"]
        if _query_has_terms(query, _LISTING_REVISION_TERMS):
            extra.append("listing_revision")
        if _query_has_terms(query, _NOTIFICATION_TERMS):
            extra.append("notification")
        if _query_has_terms(query, _AUCTION_QUERY_TERMS):
            extra.append("auction_bid_summary")
        seen: set[str] = set()
        ordered: List[str] = []
        for st in extra:
            if st not in seen:
                seen.add(st)
                ordered.append(st)
        return ordered[:4]
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
