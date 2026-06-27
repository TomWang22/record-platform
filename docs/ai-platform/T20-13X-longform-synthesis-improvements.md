# T20.13X — Longform synthesis improvements

**Baseline:** `f249d6e`  
**Status:** Implemented (rule-engine, keyword retrieval unchanged)

## Problem

Longform gauntlet (T20.13W) showed stable keyword RAG but per-turn collapse into `private_negotiation_no_messages` for turns 10–12, missing tagged bullets, shallow collector metadata, and ignored stale-inventory / rare-jazz tradeoffs.

## Changes (`rag_synthesis.py`)

### X1 — Long prompt intent handling

`classify_rag_intent()` now prioritizes domain intents **before** generic `_INTENT_RULES` (especially `private_negotiation_no_messages`):

| Intent | Triggers |
|--------|----------|
| `tagged_executive_summary` | Accumulated context + 10-bullet / tag request |
| `self_review_overclaim` | Review own advice / overclaim |
| `final_action_plan` | Using everything above / seller action plan for today |
| `seller_tradeoff` | Re-rank + stale inventory / rare jazz |
| `collector_metadata_gaps` | Collector + pressing/condition/scarcity |
| `listing_advice` | Health check / weak listings + buyer interest |
| `negotiation_strategy` | Accept, counter, or review |
| `auction_pressure` | Focus on auction + urgency / thin demand / bid risk |
| `pricing_plan` | Raise / hold / review |
| `prioritized_action_plan` | 30 minutes + prioritized action list |
| `listing_rewrite` | Draft collector-facing title/description |
| `buyer_psychology_cautious` | Buyer intent / negotiation posture |

### X2 — Tagged final plan

`tagged_executive_summary` emits bullets with `[grounded]`, `[missing evidence]`, `[needs manual review]` based on offer summaries, auction refs, and metadata gaps.

### X3 — Tradeoff retention

`seller_tradeoff` and longform final plans include a **Seller tradeoff** section when prompt or accumulated prefs mention stale inventory, rare jazz, or underselling.

### X4 — Conservative self-review

`self_review_overclaim` flags overclaims on buyer psychology, rarity, auction urgency, and condition; rewrites with cautious language.

### X5 — Collector metadata gaps

`_scan_collector_metadata()` reports present/missing for title, price, condition, pressing, scarcity, seller notes, provenance — no invention.

### X6 — Tests

`tests/test_rag_synthesis.py` — `TestT2013XLongformSynthesis` (tagged plan, self-review, tradeoff, collector gaps, no leakage, no hallucinated urgency/rarity).

## Non-goals (unchanged)

- No vector default, no Phase 21, no generative Ollama for RAG synthesis, no message bodies.
