# T20.13D — Real use-case inference telemetry report

**Status:** READ-ONLY report from T20.13C harness run  
**Generated:** 2026-06-26  
**Baseline SHA:** `bf27414` (harness run); docs commit SHA verify at push time

## Artifacts (local, not committed)

| Artifact | Path |
|----------|------|
| Report MD | `bench_logs/ai-platform/live-inference/20260626-171529.md` |
| Summary JSON | `bench_logs/ai-platform/live-inference/20260626-171529.summary.json` |
| Raw JSON dir | `bench_logs/ai-platform/live-inference/raw-20260626-171529/` |

## Production keyword

| case_id | HTTP | latency_ms | model_used | refs | source_types | leakage |
|---------|-----:|-----------:|------------|-----:|--------------|---------|
| catalog_activity | 200 | ~1990 | rule-engine | 7 | listing, listing_revision | PASS |
| seller_notifications | 200 | ~4440 | rule-engine | 8 | obo_offer_summary | PASS |
| offer_bidding_activity | 200 | ~6603 | rule-engine | 8 | obo_offer_summary | PASS |
| listing_revision_changes | 200 | ~3218 | rule-engine | 8 | obo_offer_summary | PASS |
| private_negotiation_no_messages | 200 | ~1510 | rule-engine | 8 | listing | PASS |
| seller_attention_today | 200 | ~1299 | rule-engine | 8 | listing | PASS |
| marketplace_activity_summary | 200 | ~1979 | rule-engine | 8 | obo_offer_summary | PASS |

**Aggregate:** 7/7 non-empty, `rule-engine`, leakage **PASS**, latency p50/p95 **1,248 / 3,866 ms**.

Production keyword inference is **healthy**.

## Structured endpoints

| endpoint | HTTP | model_used | summary (excerpt) | refs | leakage |
|----------|-----:|------------|-------------------|-----:|---------|
| seller_sales_summary | 200 | rule-engine | Seller activity across 10 grounded sources. | 10 | PASS |
| buyer_collection_summary | 0 | — | (missing/404 pre-existing) | 0 | PASS |
| pricing_recommendation | 200 | rule-engine | Suggested price near $55.0… | 5 | PASS |
| record_valuation | 200 | rule-engine | Record located; insufficient comparable pricing… | 5 | PASS |
| auction_risk | 200 | rule-engine | 2 auction risk signal(s)… | 1 | PASS |

**Aggregate:** 4/5 non-empty, 1 degraded/missing (`buyer_collection_summary`).

## Shadow flags off

| Metric | Value |
|--------|------:|
| cases | 7 |
| request_errors | **0** |
| embed_timeouts | **7** |
| true zero-results (retrieval) | **0** |
| chunk/doc/entity overlap >0 | **0 / 0 / 0** |
| shadow p50/p95 | **5,743 / 7,185 ms** |
| candidate_fetch p50/p95 | **0 / 0 ms** (fetch skipped after embed timeout) |

All shadow-off failures classified **`embed_timeout_before_fetch`** — Ollama embed exceeded 5s timeout (`timed_out: true`, `selected_count: 0`, `candidate_fetch_ms: 0`). This is **not** harness `request_error` and **not** pgvector empty fetch.

Example (`catalog_activity`): embed **6,788 ms**, total shadow **7,185 ms**, status `embed_timed_out`.

## Shadow flags on

| Metric | Value |
|--------|------:|
| cases | 7 |
| request_errors | **0** |
| embed_timeouts | **7** |
| true zero-results | **0** |
| chunk/doc/entity overlap >0 | **0 / 0 / 0** |
| shadow p50/p95 | **5,684 / 6,464 ms** |
| entity_boosted rows >0 | **0** |
| neighbor rows added >0 | **0** |

Flagged mode could not improve overlap in this run because **every shadow path hit embed timeout before fetch**.

## Sanitized answer excerpts

1. **catalog_activity:** Retrieved 8 grounded excerpts for your question. (listing, listing_revision)
2. **seller_notifications:** Retrieved 8 grounded excerpts for your question. (obo_offer_summary — offer status/amount)
3. **private_negotiation_no_messages:** Retrieved 8 grounded excerpts for your question. (listing — seller listing, no message bodies)
4. **pricing_recommendation:** Suggested price near $55.0 based on listing, revisions, and offer/auction summaries.

## Leakage and flags

- Leakage: **PASS** (all keyword + endpoint cases)
- Flags after run: `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`

## Interpretation

| Question | Answer |
|----------|--------|
| Harness noise vs real failure? | **0 request_errors** — telemetry separates harness failures from embed timeouts |
| Production keyword healthy? | **Yes** — 7/7 grounded, rule-engine, leakage PASS |
| Shadow rollout-ready? | **No** — 7/7 embed timeouts, 0 overlap measurable |
| Did 10k embeddings fix shadow? | **No** — embed-bound failures dominate this run |
| Vector rollout blocked? | **Yes** |

## T20.13C implementation note

The new harness correctly:

- Normalizes path inputs (`str` / `Path`)
- Classifies `embed_timeout_before_fetch` separately from `request_error`
- Writes `.summary.json` for machine-readable aggregation
- Runs full use-case suite in three modes

Recommended next (requires explicit approval): **T20.13C implementation phase 2** per T20.13B — embed warmup/retry in diagnostic scripts (Options A+B).

## Required verdict

```text
Vector rollout: NOT APPROVED
Phase 21 is not started
Production retrieval remains keyword
```
