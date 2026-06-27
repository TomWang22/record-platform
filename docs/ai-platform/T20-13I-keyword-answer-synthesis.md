# T20.13I — Keyword answer synthesis implementation

**Status:** Implemented  
**Baseline SHA:** `286904a`  
**Branch main after commit:** verify at push

## Summary

Implemented deterministic keyword RAG answer synthesis in `app/ai/rag_synthesis.py` and wired it into `rag_query()` in `insights.py`. Production `summary` text is no longer the shallow boilerplate *"Retrieved N grounded excerpts..."* for matched intents.

## Templates

| Template | Trigger (question heuristics) |
|----------|------------------------------|
| `catalog_activity` | catalog, listing activity, buyer interest |
| `seller_notifications` | notifications, selling activity right now |
| `offer_bidding_activity` | bidding, offer activity |
| `listing_revision_changes` | listing revision, what changed |
| `private_negotiation_no_messages` | private negotiation, message bodies |
| `seller_attention_today` | pay attention, seller today |
| `marketplace_activity_summary` | marketplace activity |
| `generic_grounded` | fallback with source-type counts |

## Behavior preserved

| Constraint | Status |
|------------|--------|
| `retrieval_mode` | **keyword** (unchanged) |
| `model_used` | **rule-engine** (unchanged) |
| Vector default | **off** |
| Generative Ollama for `summary` | **not used** |
| API envelope | Same fields; additive `details.synthesis` |
| Message bodies | Never emitted; forbidden-pattern guard |
| Retrieval code | **unchanged** |

## Key caveats implemented

- **`listing_revision_changes`:** explicit message when only OBO summaries retrieved (no revision chunks).
- **`private_negotiation_no_messages`:** states message bodies excluded; warns when only listing chunks found.
- **`seller_attention_today`:** ranked top-3 actions from OBO/auction/revision/listing signals.

## Tests

- `tests/test_rag_synthesis.py` — 20 unit tests (intent, templates, caveats, safety).
- `tests/test_ai_routes_insights.py` — synthesis wired in `rag_query` mock-DB test.

## Verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```
