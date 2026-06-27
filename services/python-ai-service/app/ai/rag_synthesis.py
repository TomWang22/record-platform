"""T20.13I — Deterministic keyword RAG answer synthesis (rule-engine, no LLM)."""
from __future__ import annotations

import json
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
    # T20.13X — longform / domain intents (higher priority than generic negotiation)
    if "10-bullet" in q and (
        "tagged" in q or "[grounded]" in q or "missing evidence" in q or "seller plan" in q
    ):
        return "tagged_executive_summary"
    if "accumulated session context" in q or len(question or "") > 1500:
        if "tagged as" in q and ("10-bullet" in q or "[grounded]" in q or "missing evidence" in q):
            return "tagged_executive_summary"
        if "review your own advice" in q or (
            "overclaim" in q and "10-bullet" not in q and "[grounded]" not in q
        ):
            return "self_review_overclaim"
        if "using everything above" in q or "final seller action plan" in q:
            return "final_action_plan"
    if "10-bullet" in q and "seller plan" in q:
        return "tagged_executive_summary"
    if "re-rank" in q and ("stale inventory" in q or "rare jazz" in q or "underselling" in q):
        return "seller_tradeoff"
    if "draft a better collector-facing" in q or ("listing title and description" in q and "pick one listing" in q):
        return "listing_rewrite"
    if ("pressing" in q or "provenance" in q or "collector" in q) and (
        "condition" in q or "scarcity" in q or "seller notes" in q
    ):
        return "collector_metadata_gaps"
    if "health check" in q or ("weak listings" in q and "buyer interest" in q):
        return "listing_advice"
    if "accept, counter, or review" in q or ("negotiation logic" in q and "offer" in q):
        return "negotiation_strategy"
    if "raise / hold / review" in q or "raise, hold, or review" in q:
        return "pricing_plan"
    if (
        "auction pressure" in q
        or "thin demand" in q
        or "bid risk" in q
        or ("focus on auction" in q and "urgency" in q)
    ):
        return "auction_pressure"
    if "30 minutes" in q and ("prioritized" in q or "action list" in q):
        return "prioritized_action_plan"
    if "seller action plan" in q and "today" in q:
        return "final_action_plan"
    if "what can i infer about buyer" in q or ("negotiation posture" in q and "buyer" in q):
        return "buyer_psychology_cautious"
    for intent, phrases in _INTENT_RULES:
        if any(p in q for p in phrases):
            return intent
    return "generic_grounded"


def _coerce_chunk_metadata(meta: Any) -> Dict[str, Any]:
    """Normalize chunk metadata — dict, JSON string, or invalid → safe dict."""
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
        meta = _coerce_chunk_metadata(ch.get("metadata"))
        for sig in auction_risk_signals(ch.get("content") or "", meta):
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
            meta = _coerce_chunk_metadata(ch.get("metadata"))
            for sig in auction_risk_signals(content, meta):
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


def _scan_collector_metadata(chunks: Sequence[Dict[str, Any]]) -> Dict[str, str]:
    combined = "\n".join(c.get("content") or "" for c in chunks).lower()
    return {
        "title": "present" if re.search(r"title:|listing:|seller listing:", combined, re.I) else "missing",
        "price": "present" if re.search(r"price:|amount:|cents", combined, re.I) else "missing",
        "condition": (
            "present"
            if re.search(r"condition|plays clean|\bnm\b|\bmint\b|\bvg\b|near mint", combined, re.I)
            else "missing from retrieved excerpts"
        ),
        "pressing": "present" if re.search(r"pressing|mono|stereo|blue note|first press", combined, re.I) else "missing",
        "scarcity": "present" if re.search(r"scarcity|rare|limited|first press|out of print", combined, re.I) else "missing",
        "seller_notes": (
            "present"
            if re.search(r"description:|seller notes|notes:", combined, re.I) or len(combined) > 200
            else "missing"
        ),
        "provenance": "present" if re.search(r"provenance|purchased from|owned since|acquired", combined, re.I) else "missing",
    }


def _extract_seller_tradeoffs(question: str) -> Dict[str, bool]:
    q = (question or "").lower()
    return {
        "move_stale_inventory": any(p in q for p in ("stale inventory", "move inventory", "moving stale")),
        "avoid_underselling": any(p in q for p in ("avoid underselling", "undersell", "maximize top dollar")),
        "rare_jazz": any(p in q for p in ("rare jazz", "jazz records", "rare jazz records")),
        "limited_time": "30 minute" in q or "30 minutes" in q,
    }


def _negotiation_action_for(fact: Dict[str, Any], listing_price: Optional[float]) -> Tuple[str, str, float]:
    status = fact.get("status") or "unknown"
    amount = fact.get("amount")
    if status == "accepted":
        return "review", "Offer marked accepted in summary — confirm settlement terms manually.", 0.55
    if status == "countered":
        detail = f"Countered at ${amount:.0f}" if amount is not None else "Countered amount n/a"
        if listing_price is not None and amount is not None and amount >= listing_price * 0.85:
            return "review", f"{detail}; compare to listing ${listing_price:.2f} before accepting.", 0.6
        return "review", f"{detail}; floor/reserve not verified in excerpts.", 0.5
    if status == "pending":
        return "review", "Pending offer — confirm listing price and reserve before accept/counter.", 0.45
    return "review", "Status unclear in offer summary excerpt.", 0.35


def _auction_evidence(chunks: Sequence[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    signals: List[str] = []
    gaps: List[str] = []
    auction_chunks = [c for c in chunks if c.get("source_type") == "auction_bid_summary"]
    if not auction_chunks:
        gaps.append("No auction_bid_summary excerpts retrieved.")
        return signals, gaps
    for ch in auction_chunks[:3]:
        meta = _coerce_chunk_metadata(ch.get("metadata"))
        for sig in auction_risk_signals(ch.get("content") or "", meta):
            signals.append(f"{sig['code']} ({sig['severity']}): {sig['detail']}")
    if not signals:
        gaps.append("Auction excerpts present but no bid-count or ending-soon signals parsed.")
    return signals, gaps


def _format_collector_metadata_block(fields: Dict[str, str]) -> List[str]:
    missing = [k for k, v in fields.items() if v.startswith("missing")]
    rec: List[str] = []
    if "condition" in missing or "pressing" in missing:
        rec.append("add condition, pressing/version, and provenance notes before relying on collector demand")
    if "scarcity" in missing or "provenance" in missing:
        rec.append("document scarcity/provenance only when you can verify — do not invent rarity")
    if not rec:
        rec.append("metadata looks adequate in retrieved excerpts; still verify pressing/condition manually")
    lines = ["Collector metadata check:"]
    for key in ("title", "price", "condition", "pressing", "scarcity", "seller_notes", "provenance"):
        label = key.replace("_", " ").title()
        if key == "seller_notes":
            label = "Seller notes"
        lines.append(f"- {label}: {fields[key]}")
    lines.append(f"Recommended next step: {rec[0]}.")
    return lines


def _synthesize_collector_metadata_gaps(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    fields = _scan_collector_metadata(chunks)
    lines = _format_collector_metadata_block(fields)
    lines.extend(["", _grounding_footer(len(chunks), _refs_source_types(refs))])
    return "\n".join(lines)


def _synthesize_listing_advice(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    by_type = _chunks_by_type(chunks)
    listings = by_type.get("listing", [])
    revisions = by_type.get("listing_revision", [])
    obo = by_type.get("obo_offer_summary", [])
    listing_facts = [_parse_listing_facts(c.get("content") or "") for c in listings[:4]]
    obo_counts = _obo_status_counts(chunks)
    meta = _scan_collector_metadata(chunks)
    missing_meta = [k for k, v in meta.items() if v.startswith("missing")]

    weak: List[str] = []
    for f in listing_facts:
        issues: List[str] = []
        if f.get("price") is None:
            issues.append("price unclear")
        if f["status"] != "active":
            issues.append(f"status={f['status']}")
        if issues:
            weak.append(f"{f['title']} — {', '.join(issues)}")

    lines = [
        "Catalog health check (grounded excerpts only):",
        "",
        "1. Weak listings: "
        + ("; ".join(weak) if weak else "none flagged from price/status in retrieved excerpts"),
        "2. Buyer interest gap: "
        + (
            f"{obo_counts.get('pending', 0)} pending, {obo_counts.get('countered', 0)} countered offer summaries"
            if obo
            else "no offer summaries in retrieval set — buyer interest unclear"
        ),
        "3. Revision signals: "
        + (f"{len(revisions)} revision excerpt(s)" if revisions else "none in set"),
        "4. Recommended listing edits: "
        + (
            f"strengthen {', '.join(missing_meta[:3])} on active listings"
            if missing_meta
            else "review titles/prices against recent revisions"
        ),
        "5. Missing metadata: " + (", ".join(missing_meta) if missing_meta else "none detected in excerpts"),
        "",
        "Recommended next step: Revise listings with missing collector fields before discounting.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_negotiation_strategy(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    obo_chunks = [c for c in chunks if c.get("source_type") == "obo_offer_summary"]
    listing_chunks = [c for c in chunks if c.get("source_type") == "listing"]
    listing_prices = []
    for ch in listing_chunks:
        lf = _parse_listing_facts(ch.get("content") or "")
        if lf.get("price") is not None:
            listing_prices.append(lf["price"])
    listing_price = listing_prices[0] if listing_prices else None

    lines = [
        "Negotiation strategy (offer summaries only — private message bodies excluded):",
        "",
    ]
    if not obo_chunks:
        lines.extend([
            "1. Pending offers: none in retrieved excerpts",
            "2. Countered offers: none in retrieved excerpts",
            "3. Suggested action: review — open offers inbox for live threads",
            "",
            "Cannot recommend accept/counter without grounded offer amounts.",
            "",
            _grounding_footer(len(chunks), _refs_source_types(refs)),
        ])
        return "\n".join(lines)

    pending: List[str] = []
    countered: List[str] = []
    actions: List[str] = []
    amounts: List[float] = []
    for ch in obo_chunks[:5]:
        fact = _parse_obo_facts(ch.get("content") or "")
        if fact.get("amount") is not None:
            amounts.append(float(fact["amount"]))
        action, caveat, _conf = _negotiation_action_for(fact, listing_price)
        line = f"{_format_obo_line(fact)} → {action} ({caveat})"
        if fact["status"] == "pending":
            pending.append(line)
        elif fact["status"] == "countered":
            countered.append(line)
        actions.append(line)

    band = (
        f"${min(amounts):.0f}–${max(amounts):.0f}"
        if len(amounts) >= 2
        else (f"${amounts[0]:.0f}" if amounts else "n/a")
    )
    lines.extend([
        "1. Pending offers: " + ("; ".join(pending) if pending else "none"),
        "2. Countered offers: " + ("; ".join(countered) if countered else "none"),
        f"3. Amount ranges seen: {band} (grounded excerpts only)",
        "4. Suggested actions:",
    ])
    for idx, act in enumerate(actions[:4], 1):
        lines.append(f"   {idx}. {act}")
    lines.extend([
        "",
        "Conservative rule: prefer review when floor/reserve/listing value is missing in excerpts.",
        "Private message bodies were not ingested or included in this answer.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ])
    return "\n".join(lines)


def _synthesize_auction_pressure(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    signals, gaps = _auction_evidence(chunks)
    lines = ["Auction pressure assessment (bid summaries only):", ""]
    if not signals:
        lines.extend([
            "Not enough auction evidence in retrieved excerpts to assess urgency or bid risk.",
            "",
            "Gaps: " + ("; ".join(gaps) if gaps else "no auction_bid_summary chunks"),
            "",
            "Do not infer auction urgency, thin demand, or reserve status without bid-summary refs.",
            "",
            _grounding_footer(len(chunks), _refs_source_types(refs)),
        ])
        return "\n".join(lines)

    lines.extend([
        "1. Auction/bid signals: " + "; ".join(signals[:4]),
        "2. Urgency: review ending-soon signals above; do not extrapolate beyond excerpts",
        "3. Bid risk: treat low bid-count excerpts as thin demand until verified",
        "4. Watch items: listings with auction_bid_summary refs in this set",
        "",
        "Recommended next step: Monitor ending-soon auctions; adjust only with grounded bid summaries.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ])
    return "\n".join(lines)


def _synthesize_pricing_plan(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    listing_facts = [_parse_listing_facts(c.get("content") or "") for c in chunks if c.get("source_type") == "listing"]
    obo_facts = [_parse_obo_facts(c.get("content") or "") for c in chunks if c.get("source_type") == "obo_offer_summary"]
    prices = [f["price"] for f in listing_facts if f.get("price") is not None]
    offer_amounts = [f["amount"] for f in obo_facts if f.get("amount") is not None]

    raise_hold = "review"
    rationale = "Insufficient comparable offer/listing price alignment in excerpts."
    if prices and offer_amounts:
        lp = prices[0]
        top = max(offer_amounts)
        if top >= lp * 0.95:
            raise_hold = "hold"
            rationale = f"Top grounded offer ${top:.0f} near listing ${lp:.2f} — hold unless revision signals justify change."
        elif top < lp * 0.75:
            raise_hold = "review"
            rationale = f"Offers ${top:.0f} below listing ${lp:.2f} — review before lowering."
        else:
            raise_hold = "review"
            rationale = f"Offer band vs listing ${lp:.2f} needs manual review."

    lines = [
        "Raise / hold / review pricing plan (grounded excerpts):",
        "",
        f"1. Recommendation: {raise_hold.upper()}",
        f"2. Rationale: {rationale}",
        "3. Listing prices seen: "
        + (", ".join(f"${p:.2f}" for p in prices[:3]) if prices else "none in set"),
        "4. Offer amounts seen: "
        + (", ".join(f"${a:.0f}" for a in offer_amounts[:3]) if offer_amounts else "none in set"),
        "",
        "Recommended next step: Align listing price with latest revision and countered offer summaries.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_prioritized_action_plan(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    ranked = _rank_seller_actions(chunks)
    if not ranked:
        ranked = ["Review active listings and open offer summaries"]

    lines = [
        "Prioritized seller action list (~30 minutes, grounded records):",
        "",
    ]
    for idx, action in enumerate(ranked[:5], 1):
        lines.append(f"{idx}. {action}")
    lines.extend([
        "",
        "Focus: conversion-safe moves — respond to countered/pending offers before revising listings.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ])
    return "\n".join(lines)


def _synthesize_seller_tradeoff(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]], question: str = ""
) -> str:
    tradeoffs = _extract_seller_tradeoffs(question)
    ranked = _rank_seller_actions(chunks)
    meta = _scan_collector_metadata(chunks)
    jazz_rare_unknown = meta["scarcity"] == "missing" and meta["pressing"] == "missing"

    lines = [
        "Re-ranked seller advice with your tradeoff preferences:",
        "",
        "Seller tradeoff:",
    ]
    if tradeoffs["move_stale_inventory"]:
        lines.append(
            "- Move stale inventory: prioritize listings with revisions/no recent offers; "
            + ("; ".join(ranked[:2]) if ranked else "review oldest active listings")
        )
    if tradeoffs["avoid_underselling"] or tradeoffs["rare_jazz"]:
        lines.append(
            "- Avoid underselling rare jazz: do not discount without pressing/scarcity evidence in excerpts."
        )
    if jazz_rare_unknown:
        lines.append(
            "- Manual review needed because rarity/pressing evidence is missing from retrieved excerpts."
        )
    if tradeoffs["limited_time"]:
        lines.append("- Time box: focus on top 2–3 countered/pending offers first.")

    lines.extend(["", "Re-ranked actions:"])
    for idx, action in enumerate(ranked[:4], 1):
        lines.append(f"{idx}. {action}")
    lines.extend(["", _grounding_footer(len(chunks), _refs_source_types(refs))])
    return "\n".join(lines)


def _synthesize_listing_rewrite(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    listings = [c for c in chunks if c.get("source_type") == "listing"]
    if not listings:
        lines = [
            "No listing excerpts retrieved — cannot draft collector-facing copy without grounded fields.",
            "",
            _grounding_footer(len(chunks), _refs_source_types(refs)),
        ]
        return "\n".join(lines)
    fact = _parse_listing_facts(listings[0].get("content") or "")
    title = fact.get("title") or "Listing"
    price = f" — ${fact['price']:.2f}" if fact.get("price") is not None else ""
    lines = [
        f"Draft listing rewrite for grounded excerpt ({title}):",
        "",
        f"Title: {title}{price}",
        f"Description: {fact.get('snippet', 'See grounded excerpt')}. "
        "Condition/pressing not stated in excerpt — add only verified collector details.",
        "",
        "Do not add facts absent from retrieved records.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_buyer_psychology_cautious(chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]) -> str:
    obo_counts = _obo_status_counts(chunks)
    lines = [
        "Buyer intent / negotiation posture (cautious, excerpts only):",
        "",
        "1. Observable signals: "
        + (
            f"{obo_counts.get('pending', 0)} pending and {obo_counts.get('countered', 0)} countered offer summaries"
            if obo_counts
            else "no offer summaries in retrieval set"
        ),
        "2. What cannot be inferred: buyer psychology, seriousness, or floor-testing without message bodies.",
        "3. Conservative read: countered summaries suggest back-and-forth; pending may indicate interest pending review.",
        "",
        "Do not claim proven buyer intent or aggression beyond grounded offer statuses.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_final_action_plan(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]], question: str = ""
) -> str:
    ranked = _rank_seller_actions(chunks)
    meta = _scan_collector_metadata(chunks)
    missing_meta = [k for k, v in meta.items() if v.startswith("missing")]
    signals, auction_gaps = _auction_evidence(chunks)
    tradeoffs = _extract_seller_tradeoffs(question)

    lines = [
        "Final seller action plan for today (using session context + grounded excerpts):",
        "",
        "1. Urgent offer actions: " + ("; ".join(ranked[:2]) if ranked else "review offers inbox"),
        "2. Listings to revise: "
        + (f"address missing {', '.join(missing_meta[:3])}" if missing_meta else "none flagged"),
        "3. Pricing moves: see raise/hold/review against latest offer summaries",
        "4. Collector metadata improvements: " + (", ".join(missing_meta) if missing_meta else "adequate in excerpts"),
        "5. Auction/bid watch items: "
        + ("; ".join(signals[:2]) if signals else "not enough auction evidence in set"),
        "6. Missing evidence: "
        + (
            ", ".join(missing_meta + auction_gaps)
            if missing_meta or auction_gaps
            else "offer/listing excerpts present; pressing/scarcity may still be absent"
        ),
        "7. Not allowed to infer: private message content, buyer psychology, rarity, auction urgency without bid refs",
    ]
    if tradeoffs["move_stale_inventory"] or tradeoffs["rare_jazz"]:
        lines.extend([
            "",
            "Seller tradeoff:",
            "- Move stale inventory: prioritize low-activity listings first.",
            "- Avoid underselling rare jazz: verify pressing/scarcity before discounting.",
        ])
    lines.extend(["", _grounding_footer(len(chunks), _refs_source_types(refs))])
    return "\n".join(lines)


def _synthesize_self_review_overclaim(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]], question: str = ""
) -> str:
    meta = _scan_collector_metadata(chunks)
    _, auction_gaps = _auction_evidence(chunks)
    lines = [
        "Conservative self-review (prior advice may have overclaimed):",
        "",
        "1. Buyer psychology: cannot be inferred unless offer summary statuses are present — rewrite any intent claims cautiously.",
        "2. Rarity/scarcity: "
        + (
            "pressing/scarcity missing from excerpts — do not claim rare jazz or collector premium."
            if meta["scarcity"] == "missing"
            else "only cite scarcity language present in excerpts."
        ),
        "3. Auction urgency: "
        + (
            "not enough auction evidence — remove urgency claims."
            if auction_gaps
            else "limit urgency to parsed bid-summary signals only."
        ),
        "4. Condition claims: "
        + (
            "condition not in excerpts — do not assert grading."
            if meta["condition"].startswith("missing")
            else "tie condition statements to excerpt text only."
        ),
        "",
        "Rewrite guidance: prefer review/hold language; flag manual verification for jazz/rare inventory.",
        "",
        _grounding_footer(len(chunks), _refs_source_types(refs)),
    ]
    return "\n".join(lines)


def _synthesize_tagged_executive_summary(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]], question: str = ""
) -> str:
    ranked = _rank_seller_actions(chunks)
    obo_facts = [_parse_obo_facts(c.get("content") or "") for c in chunks if c.get("source_type") == "obo_offer_summary"]
    countered = [f for f in obo_facts if f["status"] == "countered"]
    meta = _scan_collector_metadata(chunks)
    signals, auction_gaps = _auction_evidence(chunks)
    tradeoffs = _extract_seller_tradeoffs(question)

    bullets: List[str] = []
    if countered:
        amts = [f["amount"] for f in countered if f.get("amount") is not None]
        band = f"${min(amts):.0f}–${max(amts):.0f}" if len(amts) >= 2 else (f"${amts[0]:.0f}" if amts else "amounts n/a")
        bullets.append(f"[grounded] Review countered offers around {band} where offer summaries are present.")
    elif obo_facts:
        bullets.append("[grounded] Review pending offer summaries in retrieved excerpts.")
    else:
        bullets.append("[missing evidence] No offer summaries retrieved — open offers inbox before negotiating.")

    if auction_gaps and not signals:
        bullets.append("[missing evidence] Auction urgency cannot be assessed unless auction_bid_summary refs are retrieved.")
    elif signals:
        bullets.append(f"[grounded] Watch auction signals: {signals[0][:80]}.")

    if meta["pressing"] == "missing" or meta["scarcity"] == "missing":
        bullets.append("[needs manual review] Verify pressing/scarcity before discounting jazz or rare inventory.")
    else:
        bullets.append("[grounded] Collector metadata fields present in excerpts — still verify manually.")

    if ranked:
        bullets.append(f"[grounded] Priority action: {ranked[0]}")
    missing_meta = [k for k, v in meta.items() if v.startswith("missing")]
    if missing_meta:
        bullets.append(f"[missing evidence] Listing metadata gaps: {', '.join(missing_meta[:4])}.")
    if tradeoffs["move_stale_inventory"]:
        bullets.append("[grounded] Re-rank: move stale inventory before maximizing top dollar on unverified rarities.")
    if tradeoffs["rare_jazz"]:
        bullets.append("[needs manual review] Avoid underselling rare jazz until pressing/scarcity is documented.")

    bullets.append("[grounded] Private message bodies were not used — negotiation stays on offer summaries.")
    bullets.append("[missing evidence] Floor/reserve/listing value may be absent — default to review not accept.")

    while len(bullets) < 10:
        bullets.append("[needs manual review] Confirm seller dashboard items not present in retrieval set.")

    lines = ["Final 10-bullet seller plan (tagged):", ""]
    for idx, b in enumerate(bullets[:10], 1):
        lines.append(f"{idx}. {b}")
    lines.extend(["", _grounding_footer(len(chunks), _refs_source_types(refs))])
    return "\n".join(lines)


def build_listing_advice(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    by_type = _chunks_by_type(chunks)
    listing_facts = [_parse_listing_facts(c.get("content") or "") for c in by_type.get("listing", [])]
    meta = _scan_collector_metadata(chunks)
    obo_counts = _obo_status_counts(chunks)
    weak = [
        {"title": f["title"], "issues": ["price unclear" if f.get("price") is None else f"status={f['status']}"]}
        for f in listing_facts
        if f.get("price") is None or f.get("status") != "active"
    ]
    missing = [k for k, v in meta.items() if v.startswith("missing")]
    summary = _synthesize_listing_advice(chunks, refs)
    return {
        "summary": summary,
        "weak_listings": weak,
        "buyer_interest_gap": obo_counts,
        "revision_count": len(by_type.get("listing_revision", [])),
        "recommended_edits": missing,
        "missing_metadata": missing,
        "evidence_basis": _refs_source_types(refs),
    }


def build_negotiation_strategy(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    obo_chunks = [c for c in chunks if c.get("source_type") == "obo_offer_summary"]
    listing_price = None
    for ch in chunks:
        if ch.get("source_type") == "listing":
            lf = _parse_listing_facts(ch.get("content") or "")
            if lf.get("price") is not None:
                listing_price = lf["price"]
                break
    offers: List[Dict[str, Any]] = []
    for ch in obo_chunks:
        fact = _parse_obo_facts(ch.get("content") or "")
        action, caveat, confidence = _negotiation_action_for(fact, listing_price)
        offers.append({
            "status": fact["status"],
            "amount": fact.get("amount"),
            "listing_ref": fact.get("listing_ref"),
            "suggested_action": action,
            "caveat": caveat,
            "confidence": confidence,
        })
    summary = _synthesize_negotiation_strategy(chunks, refs)
    return {
        "summary": summary,
        "offers": offers,
        "pending_count": sum(1 for o in offers if o["status"] == "pending"),
        "countered_count": sum(1 for o in offers if o["status"] == "countered"),
        "private_messages_excluded": True,
        "evidence_basis": _refs_source_types(refs),
    }


def build_auction_pressure(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    signals, gaps = _auction_evidence(chunks)
    summary = _synthesize_auction_pressure(chunks, refs)
    return {
        "summary": summary,
        "signals": signals,
        "urgency": "unknown" if not signals else "review_excerpts",
        "bid_risk": "thin_demand_possible" if gaps else "see_signals",
        "evidence_gaps": gaps,
        "watch_items": [r["source_id"] for r in refs if r.get("source_type") == "auction_bid_summary"],
        "evidence_basis": _refs_source_types(refs),
    }


def build_collector_metadata_gaps(
    chunks: Sequence[Dict[str, Any]], refs: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    fields = _scan_collector_metadata(chunks)
    missing = [k for k, v in fields.items() if v.startswith("missing")]
    summary = _synthesize_collector_metadata_gaps(chunks, refs)
    return {
        "summary": summary,
        "fields": fields,
        "missing_fields": missing,
        "recommended_edits": [
            "add condition and pressing/version notes",
            "document provenance only when verifiable",
        ]
        if missing
        else ["metadata adequate in excerpts"],
        "evidence_basis": _refs_source_types(refs),
    }


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

    def _tradeoff(ch: Sequence[Dict[str, Any]], rf: Sequence[Dict[str, Any]]) -> str:
        return _synthesize_seller_tradeoff(ch, rf, question)

    def _final(ch: Sequence[Dict[str, Any]], rf: Sequence[Dict[str, Any]]) -> str:
        return _synthesize_final_action_plan(ch, rf, question)

    def _self_review(ch: Sequence[Dict[str, Any]], rf: Sequence[Dict[str, Any]]) -> str:
        return _synthesize_self_review_overclaim(ch, rf, question)

    def _tagged(ch: Sequence[Dict[str, Any]], rf: Sequence[Dict[str, Any]]) -> str:
        return _synthesize_tagged_executive_summary(ch, rf, question)

    builders = {
        "catalog_activity": _synthesize_catalog,
        "seller_notifications": _synthesize_seller_notifications,
        "offer_bidding_activity": _synthesize_offer_bidding,
        "listing_revision_changes": _synthesize_listing_revision,
        "private_negotiation_no_messages": _synthesize_private_negotiation,
        "seller_attention_today": _synthesize_seller_attention,
        "marketplace_activity_summary": _synthesize_marketplace,
        "collector_metadata_gaps": _synthesize_collector_metadata_gaps,
        "listing_advice": _synthesize_listing_advice,
        "negotiation_strategy": _synthesize_negotiation_strategy,
        "auction_pressure": _synthesize_auction_pressure,
        "pricing_plan": _synthesize_pricing_plan,
        "prioritized_action_plan": _synthesize_prioritized_action_plan,
        "seller_tradeoff": _tradeoff,
        "listing_rewrite": _synthesize_listing_rewrite,
        "buyer_psychology_cautious": _synthesize_buyer_psychology_cautious,
        "final_action_plan": _final,
        "self_review_overclaim": _self_review,
        "tagged_executive_summary": _tagged,
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
