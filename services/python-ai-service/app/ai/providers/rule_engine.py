"""Deterministic rule-engine provider — pricing bands, risk signals, quality checklist."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from app.ai.providers.base import ModelProvider


def _parse_cents(text: str) -> List[int]:
    return [int(m) for m in re.findall(r"(\d{3,7})\s*cents", text, re.I)]


def auction_risk_signals(chunk_text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    signals: List[Dict[str, Any]] = []
    meta = metadata or {}
    bid_count = int(meta.get("bid_count") or 0)
    cents = _parse_cents(chunk_text)
    if bid_count >= 5:
        signals.append({"code": "bid_spike", "severity": "medium", "detail": f"{bid_count} bids recorded"})
    if "active" in chunk_text.lower() and "ends:" in chunk_text.lower():
        signals.append({"code": "ending_soon", "severity": "high", "detail": "Auction end time present in summary"})
    if "proxy" in chunk_text.lower():
        signals.append({"code": "proxy_bid_pressure", "severity": "low", "detail": "Proxy bidding activity noted"})
    if meta.get("reserve_met") is False:
        signals.append({"code": "reserve_not_met", "severity": "medium", "detail": "Reserve not met"})
    if cents and max(cents) < 2000 and bid_count > 0:
        signals.append({"code": "likely_underpriced", "severity": "low", "detail": "Current bid below typical band"})
    if bid_count == 0:
        signals.append({"code": "stale_listing", "severity": "low", "detail": "No bids in summary"})
    return signals


def pricing_band_from_chunks(chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    prices: List[float] = []
    for ch in chunks:
        for m in re.findall(r"Price:\s*([0-9.]+)", ch.get("content") or ""):
            prices.append(float(m))
        for m in re.findall(r"(\d+)\s*cents", ch.get("content") or "", re.I):
            prices.append(int(m) / 100.0)
    if not prices:
        return {"low": None, "mid": None, "high": None}
    prices.sort()
    mid = prices[len(prices) // 2]
    return {"low": round(prices[0], 2), "mid": round(mid, 2), "high": round(prices[-1], 2)}


def listing_quality_checklist(content: str) -> List[Dict[str, str]]:
    tips: List[Dict[str, str]] = []
    if len(content) < 120:
        tips.append({"area": "description", "suggestion": "Expand description with format, condition, and shipping details"})
    if "shipping" not in content.lower():
        tips.append({"area": "shipping", "suggestion": "Add domestic/international shipping terms"})
    if "condition" not in content.lower():
        tips.append({"area": "condition", "suggestion": "State media/sleeve condition explicitly"})
    if "photo" not in content.lower() and "image" not in content.lower():
        tips.append({"area": "photos", "suggestion": "Add primary listing photos"})
    return tips


class RuleEngineProvider(ModelProvider):
    name = "rule"

    async def status(self) -> Dict[str, Any]:
        return {"available": True, "reason": "deterministic_rules"}

    async def explain(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Rule engine does not generate free-form prose; structured insights only.
        return {
            "ok": True,
            "text": "",
            "model_used": "rule-engine",
            "degraded_reason": "rule_engine_structured_only",
        }
