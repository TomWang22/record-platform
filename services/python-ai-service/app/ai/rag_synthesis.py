"""T20.13I — Deterministic keyword RAG answer synthesis (rule-engine, no LLM)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.ai.providers.rule_engine import auction_risk_signals

FORBIDDEN_EMIT = re.compile(
    r"message_body|thread_text|private obo message|lorem ipsum",
    re.I,
)

_INTENT_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    (
        "private_negotiation_no_messages",
        ("private", "negotiation", "message bod"),
    ),
    (
        "listing_revision_changes",
        ("listing revision", "revision", "what changed recently"),
    ),
    (
        "seller_attention_today",
        ("pay attention", "seller today", "should i pay attention"),
    ),
    (
        "seller_notifications",
        ("notification", "selling activity right now", "matter most"),
    ),
    (
        "offer_bidding_activity",
        ("bidding", "offer activity", "bid activity"),
    ),
    (
        "catalog_activity",
        ("catalog", "buyer interest", "listing activity"),
    ),
    (
        "marketplace_activity_summary",
        ("marketplace activity", "recent marketplace", "marketplace summary"),
    ),
)


def classify_rag_intent(question: str) -> str:
    q = (question or "").lower()
    for intent, phrases in _INTENT_RULES:
        if any(p in q for p in phrases):
            return intent
    return "generic_grounded"


def _chunks_by_type(chunks: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for ch in chunks:
        st = str(ch.get("source_type") or "unknown")
        out.setdefault(st, []).append(ch)
    return out


def _refs_source_types(refs: Sequence[Dict[str, Any]]) -> List[str]:
    return sorted({str(r.get("source_type")) for r in refs if r.get("source_type")})


def _sanitize_line(text: str, *, max_len: int = 120) -> str:
    line = " ".join((text or "").split())
    if FORBIDDEN_EMIT.search(line):
        return "[redacted — private message content excluded]"
    return line[:max_len]


def _parse_prices(text: str) -> List[float]:
    prices: List[float] = []
    for m in re.findall(r"Price:\s*([0-9.]+)", text or ""):
        prices.append(float(m))
    for m in re.findall(r"Amount:\s*([0-9.]+)", text or ""):
        prices.append(float(m))
    for m in re.findall(r"(\d+)\s*cents", text or "", re.I):
        prices.append(int(m) / 100.0)
    return prices


def _parse_obo_facts(content: str) -> Dict[str, Any]:
    text = content or ""
    status = "unknown"
    for st in ("countered", "pending", "accepted", "declined", "expired"):
        if re.search(rf"Status:\s*{st}", text, re.I):
            status = st
            break
    amounts = _parse_prices(text)
    listing_m = re.search(r"listing\s+([0-9a-f-]{8,})", text, re.I)
    return {
        "status": status,
        "amount": amounts[0] if amounts else None,
        "listing_ref": listing_m.group(1)[:8] if listing_m else None,
        "snippet": _sanitize_line(text),
    }


def _parse_listing_facts(content: str) -> Dict[str, Any]:
    text = content or ""
    title_m = re.search(r"(?:Seller listing:|Listing:)\s*(.+?)\s+Status:", text, re.I)
    status_m = re.search(r"Status:\s*(\w+)", text, re.I)
    prices = _parse_prices(text)
    return {
        "title": _sanitize_line(title_m.group(1) if title_m else "listing", max_len=60),
        "status": status_m.group(1) if status_m else "unknown",
        "price": prices[0] if prices else None,
        "snippet": _sanitize_line(text),
    }


def _parse_revision_facts(content: str) -> Dict[str, Any]:
    text = content or ""
    title_m = re.search(r"Title:\s*(.+?)(?:\s+Description:|$)", text, re.I)
    return {
        "title": _sanitize_line(title_m.group(1) if title_m else "revision", max_len=60),
        "snippet": _sanitize_line(text),
    }


def _obo_status_counts(chunks: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for ch in chunks:
        if ch.get("source_type") != "obo_offer_summary":
            continue
        st = _parse_obo_facts(ch.get("content") or "")["status"]
        counts[st] = counts.get(st, 0) + 1
    return counts


def _format_obo_line(fact: Dict[str, Any]) -> str:
    amt = f"${fact['amount']:.0f}" if fact.get("amount") is not None else "amount n/a"
    listing = fact.get("listing_ref") or "listing"
    return f"{fact['status']} {amt} on {listing}…"


def _grounding_footer(chunk_count: int, source_types: Sequence[str]) -> str:
    types_label = ", ".join(source_types) if source_types else "none"
    return (
        f"Grounding: based on {chunk_count} excerpt(s) from {types_label}. "
        "Private message bodies were not used."
    )


def _synthesize_catalog(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    listings = by_type.get("listing", [])
    revisions = by_type.get("listing_revision", [])
    obo = by_type.get("obo_offer_summary", [])
    listing_facts = [_parse_listing_facts(c.get("content") or "") for c in listings[:3]]
    rev_facts = [_parse_revision_facts(c.get("content") or "") for c in revisions[:2]]
    obo_counts = _obo_status_counts(chunks)

    lines = [
        f"Your catalog shows {len(listings)} listing excerpt(s) and {len(revisions)} revision excerpt(s) in grounded records.",
        "",
        "1. Active listing activity: "
        + (
            "; ".join(
                f"{f['title']} — {f['status']}"
                + (f", ${f['price']:.2f}" if f.get("price") is not None else "")
                for f in listing_facts
            )
            if listing_facts
            else "no listing excerpts in this retrieval set"
        ),
        "2. Buyer/offer interest: "
        + (
            f"{obo_counts.get('pending', 0)} pending, {obo_counts.get('countered', 0)} countered offer summary excerpt(s)"
            if obo
            else "no offer summaries in this retrieval set"
        ),
        "3. Revisions or price changes: "
        + (
            "; ".join(f"{f['title']} — {f['snippet'][:80]}" for f in rev_facts)
            if rev_facts
            else "none in retrieved excerpts"
        ),
        "",
        "Recommended next step: Review listings with pending offer summaries or recent revisions.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_seller_notifications(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    obo = by_type.get("obo_offer_summary", [])
    notifications = by_type.get("notification", [])
    obo_facts = sorted(
        [_parse_obo_facts(c.get("content") or "") for c in obo],
        key=lambda f: {"countered": 0, "pending": 1}.get(f["status"], 2),
    )
    obo_lines = [_format_obo_line(f) for f in obo_facts[:3]]

    lines = [
        "Here are the main seller signals from your grounded records:",
        "",
        "1. Offer activity: "
        + (
            f"{len(obo)} offer summary excerpt(s) — e.g. {obo_lines[0]}"
            + (f"; {obo_lines[1]}" if len(obo_lines) > 1 else "")
            if obo_lines
            else "none in this retrieval set"
        ),
        "2. Notifications: "
        + (
            f"{len(notifications)} notification excerpt(s)"
            if notifications
            else "none in this retrieval set"
        ),
        "",
        "Recommended next step: Respond to countered/pending offers before expiry.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_offer_bidding(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    obo_counts = _obo_status_counts(chunks)
    obo_chunks = [c for c in chunks if c.get("source_type") == "obo_offer_summary"]
    listing_ids = {
        _parse_obo_facts(c.get("content") or "")["listing_ref"]
        for c in obo_chunks
        if _parse_obo_facts(c.get("content") or "")["listing_ref"]
    }
    prices: List[float] = []
    for ch in chunks:
        prices.extend(_parse_prices(ch.get("content") or ""))
    prices.sort()
    auction_chunks = [c for c in chunks if c.get("source_type") == "auction_bid_summary"]
    auction_notes: List[str] = []
    for ch in auction_chunks[:2]:
        for sig in auction_risk_signals(ch.get("content") or "", ch.get("metadata")):
            auction_notes.append(f"{sig['code']} ({sig['severity']})")

    price_band = (
        f"${prices[0]:.0f}–${prices[-1]:.0f} USD"
        if len(prices) >= 2
        else (f"${prices[0]:.0f} USD" if prices else "n/a")
    )

    lines = [
        "Offer and bidding activity from your retrieved records:",
        "",
        "1. Offers: "
        f"{obo_counts.get('pending', 0)} pending, {obo_counts.get('countered', 0)} countered "
        f"across {len(listing_ids) or len(obo_chunks)} listing reference(s)",
        f"2. Amounts seen: {price_band} (from grounded excerpts only)",
        "3. Auction/bid signals: "
        + ("; ".join(auction_notes) if auction_notes else "none in this set"),
        "",
        "Recommended next step: Prioritize countered offers and listings with expiring pending amounts.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_listing_revision(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    revisions = by_type.get("listing_revision", [])
    obo = by_type.get("obo_offer_summary", [])
    listings = by_type.get("listing", [])

    if not revisions and obo:
        obo_facts = [_parse_obo_facts(c.get("content") or "") for c in obo[:2]]
        lines = [
            "No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only.",
            "",
            "1. Offer activity found instead: "
            + ("; ".join(_format_obo_line(f) for f in obo_facts) if obo_facts else "none"),
            "2. Revision changes: not available in retrieved excerpts — open listing revisions directly for field-level history.",
            "",
            "Recommended next step: Confirm offer amounts still match current listing price/terms.",
            "",
            _grounding_footer(len(chunks), _refs_source_types(refs)),
        ]
        return "\n".join(lines)

    rev_facts = [_parse_revision_facts(c.get("content") or "") for c in revisions[:3]]
    obo_facts = [_parse_obo_facts(c.get("content") or "") for c in obo[:2]]
    lines = [
        "Recent listing revision signals:",
        "",
        "1. Revision: "
        + ("; ".join(f"{f['title']} — {f['snippet'][:80]}" for f in rev_facts) if rev_facts else "none"),
        f"2. Related listings: {len(listings)} listing excerpt(s)",
        "3. Offer impact: "
        + (
            "; ".join(_format_obo_line(f) for f in obo_facts)
            if obo_facts
            else "no offer summaries linked in this set"
        ),
        "",
        "Recommended next step: Confirm offer amounts still match revised listing price/terms.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_private_negotiation(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    obo = by_type.get("obo_offer_summary", [])
    listings = by_type.get("listing", [])

    if not obo and listings:
        lines = [
            "Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries.",
            "",
            "Private message bodies were not ingested or included in this answer.",
            "",
            "Recommended next step: Query offer activity for listings with active OBO threads.",
            "",
            _grounding_footer(len(chunks), _refs_source_types(refs)),
        ]
        return "\n".join(lines)

    obo_counts = _obo_status_counts(chunks)
    obo_facts = [_parse_obo_facts(c.get("content") or "") for c in obo[:3]]
    lines = [
        "Private negotiation context (offer summaries only — message bodies excluded):",
        "",
        f"1. Offer status: {obo_counts.get('pending', 0)} pending, {obo_counts.get('countered', 0)} countered",
        "2. Top offer lines: "
        + ("; ".join(_format_obo_line(f) for f in obo_facts) if obo_facts else "none"),
        f"3. Listings referenced: {len(listings)} listing excerpt(s) in set",
        "",
        "Private message bodies were not ingested or included in this answer.",
        "",
        "Recommended next step: Review countered/pending offers in your offers inbox.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _rank_seller_actions(chunks: Sequence[Dict[str, Any]]) -> List[str]:
    actions: List[Tuple[int, str]] = []
    for ch in chunks:
        st = ch.get("source_type")
        content = ch.get("content") or ""
        if st == "obo_offer_summary":
            fact = _parse_obo_facts(content)
            if fact["status"] == "countered":
                priority = 0
                actions.append((priority, f"Respond to countered offer {_format_obo_line(fact)}"))
            elif fact["status"] == "pending":
                priority = 1
                actions.append((priority, f"Review pending offer {_format_obo_line(fact)}"))
        elif st == "auction_bid_summary":
            for sig in auction_risk_signals(content, ch.get("metadata")):
                if sig["code"] == "ending_soon":
                    actions.append((1, f"Auction ending soon — {sig['detail']}"))
        elif st == "listing_revision":
            fact = _parse_revision_facts(content)
            actions.append((2, f"Check revision on {fact['title']}"))
        elif st == "listing":
            fact = _parse_listing_facts(content)
            if fact["status"] == "active":
                actions.append((3, f"Refresh active listing {fact['title']}"))

    actions.sort(key=lambda x: x[0])
    seen: set[str] = set()
    ranked: List[str] = []
    for _prio, text in actions:
        if text in seen:
            continue
        seen.add(text)
        ranked.append(text)
        if len(ranked) >= 3:
            break
    return ranked


def _synthesize_seller_attention(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    ranked = _rank_seller_actions(chunks)
    if not ranked:
        ranked = ["Review active listings and open offer summaries in your seller dashboard"]

    lines = ["Top seller actions from grounded records today:", ""]
    for idx, action in enumerate(ranked[:3], 1):
        lines.append(f"{idx}. {action}")
    lines.extend(["", _grounding_footer(len(chunks), _refs_source_types(refs))])
    return "\n".join(lines)


def _synthesize_marketplace(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    types_present = _refs_source_types(refs)

    def _type_line(source_type: str, label: str) -> str:
        items = by_type.get(source_type, [])
        if not items:
            return f"{label}: none in set"
        if source_type == "listing":
            f = _parse_listing_facts(items[0].get("content") or "")
            return f"{label}: {len(items)} excerpt(s) — {f['title']} ({f['status']})"
        if source_type == "obo_offer_summary":
            c = _obo_status_counts(items)
            return f"{label}: {len(items)} excerpt(s) — {c.get('pending', 0)} pending, {c.get('countered', 0)} countered"
        return f"{label}: {len(items)} excerpt(s)"

    priority_action = _rank_seller_actions(chunks)
    next_step = priority_action[0] if priority_action else "Review seller dashboard for new activity"

    lines = [
        "Recent marketplace activity relevant to you (seller-scoped):",
        "",
        f"1. {_type_line('listing', 'Listings')}",
        f"2. {_type_line('obo_offer_summary', 'Offers')}",
        f"3. Revisions/notifications/auctions: "
        + ", ".join(
            f"{t}={len(by_type.get(t, []))}"
            for t in ("listing_revision", "notification", "auction_bid_summary")
            if t in types_present or by_type.get(t)
        )
        or "none in set",
        "",
        f"Recommended next step: {next_step}",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_generic(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    counts = {k: len(v) for k, v in by_type.items()}
    counts_label = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) if counts else "none"
    lines = [
        f"Grounded records summary across {len(chunks)} excerpt(s): {counts_label}.",
        "",
        "Review attached source excerpts for listing, offer, and revision details.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def synthesize_rag_summary(
    *,
    question: str,
    chunks: Sequence[Dict[str, Any]],
    refs: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build deterministic summary text and synthesis metadata."""
    if not chunks:
        return {
            "summary": "No matching corpus excerpts for this question.",
            "template": "empty",
            "caveats": ["no_chunks"],
            "parsed_signals": {},
        }

    template = classify_rag_intent(question)
    caveats: List[str] = []

    builders = {
        "catalog_activity": _synthesize_catalog,
        "seller_notifications": _synthesize_seller_notifications,
        "offer_bidding_activity": _synthesize_offer_bidding,
        "listing_revision_changes": _synthesize_listing_revision,
        "private_negotiation_no_messages": _synthesize_private_negotiation,
        "seller_attention_today": _synthesize_seller_attention,
        "marketplace_activity_summary": _synthesize_marketplace,
    }
    builder = builders.get(template, _synthesize_generic)
    summary = builder(chunks, refs)

    if template == "listing_revision_changes":
        if not _chunks_by_type(chunks).get("listing_revision"):
            caveats.append("no_revision_chunks_obo_only")
    if template == "private_negotiation_no_messages":
        if not _chunks_by_type(chunks).get("obo_offer_summary"):
            caveats.append("listing_only_not_negotiation")

    if FORBIDDEN_EMIT.search(summary):
        summary = "Summary withheld — retrieved content failed safety filter."
        caveats.append("safety_filter")

    return {
        "summary": summary,
        "template": template,
        "caveats": caveats,
        "parsed_signals": {
            "obo_status_counts": _obo_status_counts(chunks),
            "source_types": _refs_source_types(refs),
            "chunk_count": len(chunks),
        },
    }
