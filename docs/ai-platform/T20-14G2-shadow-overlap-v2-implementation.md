# T20.14G2 — Shadow overlap v2 implementation

**Status:** Implemented  
**Generated:** 2026-06-28  
**Baseline SHA:** `e6bcd23` (T20.14G design)  
**Scope:** Shadow/canary diagnostic path only — keyword production unchanged

---

## Summary

Implemented T20.14G2 shadow-only overlap v2:

1. **Zero-result fallback** — global untyped vector retry, then keyword-anchor top-up (K≤2)
2. **Source-type floor** — `seller_sales_summary` typed pool recovery; OBO permitted as notification evidence
3. **Overlap telemetry v2** — fallback/anchor fields in shadow diagnostics + timing harness aggregates

---

## Changed files

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/rag_retrieval.py` | Fallback sequence, keyword anchors, floor integration in route fetch |
| `services/python-ai-service/app/ai/shadow_profiles.py` | `SHADOW_KEYWORD_ANCHOR_MAX`, `resolve_source_type_floor_plan` |
| `services/python-ai-service/tests/test_t20_14g2_shadow_overlap_v2.py` | G2 unit tests (8 cases) |
| `scripts/rp-ai-shadow-real-query-timing.sh` | v2 overlap/fallback aggregates |

---

## Fallback behavior

Triggered when `shadow_fetch_attempted=true`, embed did not timeout, and (`candidate_pool_before_rerank=0` OR `selected_count=0`):

1. **Global untyped retry** — `shadow_global_fetch_limit(max_chunks)` if pool empty
2. **Keyword anchor top-up** — up to 2 chunks from `keyword_chunks_for_overlap` when exposed (`shadow_debug=1`)
3. Classification:
   - `zero_result_after_fetch` — before fallback
   - `zero_result_fallback_applied` — fallback produced selections
   - `zero_result_after_fallback` — still empty after fallback
   - `not_exposed` — no keyword chunks available for anchor stage

Vector-selected and keyword-anchor refs are tracked separately (`vector_selected_chunk_ids`, `keyword_anchor_ids`).

---

## Telemetry fields (shadow diagnostics debug)

```text
zero_result_fallback_attempted
zero_result_fallback_stage
zero_result_fallback_succeeded
keyword_anchor_added
keyword_anchor_count
keyword_anchor_ids
vector_selected_chunk_ids
shadow_selected_count_before_fallback
shadow_selected_count_after_fallback
true_zero_result_after_fallback
fallback_reason
source_type_floor_applied
source_type_floor_types
source_type_floor_satisfied
typed_pool_empty
obo_as_notification_evidence
```

Harness aggregates: `fallback_applied_n/16`, `keyword_anchor_added_n/16`, `true_zero_after_fallback_n/16`.

---

## Tests

```bash
cd services/python-ai-service
source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/ -q
```

**235 passed** including `test_t20_14g2_shadow_overlap_v2.py`:

1. Global retry success
2. Keyword anchor success
3. Fallback still empty → true zero remains
4. Anchor cap at 2
5. Anchor privacy (no message / forbidden)
6. Source-type floor OBO-as-notification evidence
7. Keyword retrieval unchanged

Contracts: `audit-rp-ai-rag-contract.sh`, `rp-ai-rag-quality-smoke.sh`, `audit-rp-ai-endpoints-contract.sh`, OCH scan — **PASS**.

---

## Non-goals

- No production vector default
- No hybrid default
- No keyword production retrieval changes
- No default-on `AI_RAG_SHADOW_ENTITY_HINTS` / `AI_RAG_SHADOW_NEIGHBOR_EXPANSION`
- No DB/index changes
- No embedding tranches
- No T20.15

---

## Verdict

```text
T20.14G2 shadow overlap v2: IMPLEMENTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G2-EVAL (3-run overlap v2 eval)
```
