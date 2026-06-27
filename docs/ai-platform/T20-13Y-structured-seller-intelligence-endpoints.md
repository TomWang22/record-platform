# T20.13Y — Structured seller intelligence endpoints

**Status:** Implemented (additive routes + rule-engine builders)

## Endpoints

All return standard insight envelopes (`insight_id`, `contract_id`, `source_status`, `model_used`, `summary`, `source_refs`).

| Contract ID | Method | Path | Builder |
|-------------|--------|------|---------|
| `listing_advice` | POST | `/api/ai/seller/listing-advice` | `build_listing_advice()` |
| `negotiation_strategy` | POST | `/api/ai/seller/negotiation-strategy` | `build_negotiation_strategy()` |
| `auction_pressure` | POST | `/api/ai/seller/auction-pressure` | `build_auction_pressure()` |
| `collector_metadata_gaps` | POST | `/api/ai/seller/collector-metadata-gaps` | `build_collector_metadata_gaps()` |

Gateway proxies `/api/ai/*` → python-ai `/ai/*` (same pattern as `/api/ai/seller/summary`).

## Behavior

### listing_advice

- Weak listings (price/status flags)
- Buyer interest gap from OBO counts
- Revision signals
- Recommended listing edits from metadata scan
- Missing metadata list

### negotiation_strategy

- Pending / countered offers with amount ranges
- Suggested action: **review** (default conservative; never accept without floor/reserve grounding)
- Confidence + caveats per offer
- `private_messages_excluded: true` in details

### auction_pressure

- Parses `auction_bid_summary` via `auction_risk_signals()`
- If no auction evidence: explicit “not enough auction evidence” — no hallucinated urgency

### collector_metadata_gaps

- Field-level present/missing map
- Recommended edits (condition, pressing, provenance)

## Implementation files

- `services/python-ai-service/app/ai/rag_synthesis.py` — builders + synthesis
- `services/python-ai-service/app/ai/insights.py` — async insight functions
- `services/python-ai-service/app/ai/routes.py` — POST routes
- `tests/test_ai_routes_insights.py` — route + insight unit tests

## Retrieval

Keyword retrieval only; `model_used=rule-engine`. Vector shadow not enabled by default.
