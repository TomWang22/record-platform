# T20.13G-R — Real prompt telemetry transcript

**Status:** READ-ONLY transcript report (no code changes)  
**Generated:** 2026-06-26  
**Baseline SHA:** `a2399ce`  
**Source run:** T20.13G warmed harness (`20260626-190817`)  
**Artifacts (local, not committed):** `bench_logs/ai-platform/live-inference/20260626-190817.{md,summary.json}`, `raw-20260626-190817/`

---

## Executive summary

- **Production keyword path is healthy:** 7/7 prompts returned HTTP 200, non-empty grounded answers, `model_used=rule-engine`, leakage PASS.
- **Ollama embed + pgvector shadow diagnostics work after warmup:** embed warmup 3/3 passed; 0 embed timeouts; `shadow_fetch_attempted` 7/7 in both flag modes; `selected_count=8` on every shadow case.
- **Real blockers are latency and weak default overlap:** shadow p95 **6,276 ms** (flags off) / **8,449 ms** (flags on) vs rollout target ≤3,000 ms; default chunk overlap >0 on only **1/7** cases.
- **Vector rollout: NOT APPROVED**
- **Phase 21: not started**

---

## Prompting session

Each subsection is one live prompt → production answer → shadow telemetry for the same text.

---

### 1. Catalog / listing activity

**Prompt:** Summarize listing activity and buyer interest for my catalog.

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | Summarize listing activity and buyer interest for my catalog. |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | listing, listing_revision |
| refs count | 7 |
| sanitized source excerpt | Listing revision for E2E Lean Listing 1781388696658… · Listing: E2E Lean Listing 1781388696658 Type: fixed_price Price: 45.99 USD… |
| keyword latency ms | 3,288.8 |
| leakage | PASS |

#### Shadow telemetry (same prompt)

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | listing, listing_revision | listing, listing_revision |
| chunk overlap | 0 | 0 |
| doc overlap | 0 | 0 |
| entity overlap | 0 | 0 |
| zero_overlap_reason | same_source_type_different_chunks | same_source_type_different_chunks |
| embed_ms | 2,094 | 4,712 |
| candidate_fetch_ms | 3,927 | 3,590 |
| rerank_ms | 5 | 7 |
| shadow_total_ms | 6,276 | 8,449 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | embed_bound |

---

### 2. Seller notifications / offers

**Prompt:** What notifications matter most for my selling activity right now?

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | What notifications matter most for my selling activity right now? |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | obo_offer_summary |
| refs count | 8 |
| sanitized source excerpt | Offer summary for listing bf1360a1… Status: pending Amount: 4436 USD… · Offer summary… Status: countered Amount: 4136 USD… |
| keyword latency ms | 1,238.3 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | obo_offer_summary | obo_offer_summary |
| chunk overlap | 0 | **3** |
| doc overlap | 0 | **3** |
| entity overlap | 0 | **9** |
| zero_overlap_reason | same_source_type_different_chunks | — |
| entity_boosted rows | — | 8 |
| embed_ms | 1,821 | 873 |
| candidate_fetch_ms | 1,825 | 711 |
| rerank_ms | 2 | 6 |
| shadow_total_ms | 3,771 | 1,792 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | embed_bound |

---

### 3. Bidding / offer activity

**Prompt:** Show a concise summary of bidding and offer activity tied to my recent listings.

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | Show a concise summary of bidding and offer activity tied to my recent listings. |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | obo_offer_summary |
| refs count | 8 |
| sanitized source excerpt | Offer summary… Status: pending Amount: 4436 USD… · Offer summary… Status: countered Amount: 4136 USD… |
| keyword latency ms | 1,572.5 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | obo_offer_summary | obo_offer_summary |
| chunk overlap | **1** | **2** |
| doc overlap | **1** | **2** |
| entity overlap | **3** | **5** |
| entity_boosted rows | — | 2 |
| embed_ms | 382 | 1,674 |
| candidate_fetch_ms | 605 | 1,265 |
| rerank_ms | 2 | 1 |
| shadow_total_ms | 1,143 | 3,325 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | embed_bound |

*Flagged mode required 2 attempts (1 embed retry after warmup probe).*

---

### 4. Listing revision changes

**Prompt:** What changed recently on listing revisions that may affect offers?

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | What changed recently on listing revisions that may affect offers? |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | obo_offer_summary |
| refs count | 8 |
| sanitized source excerpt | Offer summary… Status: pending Amount: 4436 USD… · Offer summary… Status: countered Amount: 4136 USD… |
| keyword latency ms | 3,390.7 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | obo_offer_summary | obo_offer_summary |
| chunk overlap | 0 | **3** |
| doc overlap | 0 | **3** |
| entity overlap | 0 | **8** |
| zero_overlap_reason | same_source_type_different_chunks | — |
| entity_boosted rows | — | 8 |
| embed_ms | 356 | 1,148 |
| candidate_fetch_ms | 627 | 3,184 |
| rerank_ms | 2 | 2 |
| shadow_total_ms | 1,104 | 4,419 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | candidate_fetch_bound |

---

### 5. Private negotiation (no message bodies)

**Prompt:** Summarize my private seller-side negotiation context without exposing message bodies.

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | Summarize my private seller-side negotiation context without exposing message bodies. |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | listing |
| refs count | 8 |
| sanitized source excerpt | Seller listing: Kenny Dorham — Quiet Kenny [SOLD] Status: active… · Seller listing: E2E UI Listing 1781389086102 (revised) Status: active… |
| keyword latency ms | 1,043.6 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | listing | listing |
| chunk overlap | 0 | 0 |
| doc overlap | 0 | 0 |
| entity overlap | 0 | 0 |
| zero_overlap_reason | same_source_type_different_chunks | same_source_type_different_chunks |
| embed_ms | 500 | 1,590 |
| candidate_fetch_ms | 524 | 1,913 |
| rerank_ms | 4 | 1 |
| shadow_total_ms | 1,093 | 3,832 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | candidate_fetch_bound |

---

### 6. Seller attention today

**Prompt:** What should I pay attention to as a seller today?

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | What should I pay attention to as a seller today? |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | listing |
| refs count | 8 |
| sanitized source excerpt | Seller listing: Kenny Dorham — Quiet Kenny [SOLD]… · Seller listing: E2E UI Listing 1781389086102 (revised)… |
| keyword latency ms | 1,058.8 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | listing | listing |
| chunk overlap | 0 | 0 |
| doc overlap | 0 | 0 |
| entity overlap | 0 | 0 |
| zero_overlap_reason | same_source_type_different_chunks | same_source_type_different_chunks |
| embed_ms | 322 | 3,067 |
| candidate_fetch_ms | 423 | 3,293 |
| rerank_ms | 1 | 3 |
| shadow_total_ms | 845 | 6,582 |
| failure class | not_zero_result | not_zero_result |
| latency bound | candidate_fetch_bound | candidate_fetch_bound |

---

### 7. Marketplace activity summary

**Prompt:** Give me a grounded summary of recent marketplace activity relevant to me.

#### Production (keyword)

| Field | Value |
|-------|-------|
| prompt | Give me a grounded summary of recent marketplace activity relevant to me. |
| HTTP status | 200 |
| retrieval_mode | keyword |
| model_used | rule-engine |
| actual answer | Retrieved 8 grounded excerpts for your question. |
| source types | obo_offer_summary |
| refs count | 8 |
| sanitized source excerpt | Offer summary… Status: countered Amount: 4136 USD… · Offer summary… Status: pending Amount: 4436 USD… |
| keyword latency ms | 1,454.1 |
| leakage | PASS |

#### Shadow telemetry

| Field | Shadow off | Shadow flagged |
|-------|------------|----------------|
| profile | seller_sales_summary | seller_sales_summary |
| selected count | 8 | 8 |
| source types | obo_offer_summary | obo_offer_summary |
| chunk overlap | 0 | 0 |
| doc overlap | 0 | 0 |
| entity overlap | 0 | 0 |
| zero_overlap_reason | source_type_mismatch | source_type_mismatch |
| entity_boosted rows | — | 1 |
| embed_ms | 677 | 2,200 |
| candidate_fetch_ms | 667 | 1,515 |
| rerank_ms | 3 | 4 |
| shadow_total_ms | 1,478 | 4,279 |
| failure class | not_zero_result | not_zero_result |
| latency bound | embed_bound | embed_bound |

---

## Structured endpoint transcript

| endpoint | HTTP | model_used | actual output excerpt | refs | source types | latency ms | leakage |
|----------|-----:|------------|----------------------|-----:|--------------|----------:|---------|
| seller_sales_summary | 200 | rule-engine | Seller activity across 10 grounded sources. | 10 | listing, obo_offer_summary | 2,809.7 | PASS |
| buyer_collection_summary | 0 | — | *(pre-existing 404 — endpoint not available)* | 0 | — | 96.8 | PASS |
| pricing_recommendation | 200 | rule-engine | Suggested price near $55.0 based on listing, revisions, and offer/auction summaries. | 5 | listing, obo_offer_summary | 288.9 | PASS |
| record_valuation | 200 | rule-engine | Record located; insufficient comparable pricing in corpus. | 5 | obo_offer_summary | 136.5 | PASS |
| auction_risk | 200 | rule-engine | 2 auction risk signal(s) from bid summaries. | 1 | auction_bid_summary | 57.6 | PASS |

---

## Latency summary

| Phase | p50 ms | p95 ms |
|-------|-------:|-------:|
| Keyword production | 1,454.1 | 3,390.7 |
| Shadow flags **off** (total) | 1,143.0 | **6,276.0** |
| Shadow flags **on** (total) | 4,279.0 | **8,449.0** |
| Embed (shadow off) | 500.0 | 2,094.0 |
| Embed (shadow flagged) | 1,674.0 | 4,712.0 |
| candidate_fetch (shadow off) | 627.0 | 3,927.0 |
| candidate_fetch (shadow flagged) | 1,913.0 | 3,590.0 |
| rerank (both modes) | 2–3 | 5–7 |

**Rollout SLO:** shadow p95 ≤ 3,000 ms → **FAIL** (6,276 off / 8,449 flagged).

### Top 5 slow shadow cases

| rank | prompt (truncated) | mode | embed_ms | candidate_fetch_ms | total_ms | latency_bound |
|-----:|--------------------|------|--------:|-------------------:|---------:|---------------|
| 1 | Summarize listing activity and buyer interest for my catalog. | flagged | 4,712 | 3,590 | 8,449 | embed_bound |
| 2 | What should I pay attention to as a seller today? | flagged | 3,067 | 3,293 | 6,582 | candidate_fetch_bound |
| 3 | Summarize listing activity and buyer interest for my catalog. | off | 2,094 | 3,927 | 6,276 | candidate_fetch_bound |
| 4 | What changed recently on listing revisions that may affect offers? | flagged | 1,148 | 3,184 | 4,419 | candidate_fetch_bound |
| 5 | Give me a grounded summary of recent marketplace activity… | flagged | 2,200 | 1,515 | 4,279 | embed_bound |

---

## Overlap summary

| Metric | flags off | flags on |
|--------|----------:|---------:|
| cases with chunk overlap >0 | **1 / 7** | **3 / 7** |
| document overlap >0 | **1 / 7** | **3 / 7** |
| entity overlap >0 | **1 / 7** | **3 / 7** |
| entity_boosted rows >0 | 0 | **4 / 7** |
| neighbor rows added >0 | 0 | 0 |
| true zero-results | 0 | 0 |

### Cases improved by overlap flags

| case | off (chunk/doc/entity) | on (chunk/doc/entity) |
|------|------------------------|----------------------|
| seller_notifications | 0/0/0 | **3/3/9** |
| offer_bidding_activity | 1/1/3 | **2/2/5** |
| listing_revision_changes | 0/0/0 | **3/3/8** |

### Cases not improved by flags

| case | off | on | reason |
|------|-----|-----|--------|
| catalog_activity | 0/0/0 | 0/0/0 | same_source_type_different_chunks |
| private_negotiation_no_messages | 0/0/0 | 0/0/0 | same_source_type_different_chunks |
| seller_attention_today | 0/0/0 | 0/0/0 | same_source_type_different_chunks |
| marketplace_activity_summary | 0/0/0 | 0/0/0 | source_type_mismatch |

**Interpretation:** Overlap weakness is **`same_source_type_different_chunks`** — keyword and shadow agree on source types but select different chunk IDs. This is not leakage, not empty retrieval, and not a zero-result failure. Flagged entity hints help OBO/revision-heavy prompts only.

---

## Product-readiness interpretation

1. **Production keyword answers are grounded and safe.** Every RAG prompt returned `rule-engine` summaries with real listing/OBO/revision excerpts; no message bodies; leakage PASS on all 7 prompts and 4/5 structured endpoints.
2. **Shadow vector diagnostics are observable after warmup.** Embed gate 3/3; fetch runs on all cases; timings and overlap fields populated; 0 embed timeouts.
3. **Shadow is not production-ready** because p95 latency (6.3–8.4s) exceeds the 3s rollout target and default overlap fails (1/7 chunk overlap >0).
4. **Count gate has passed** (10,065 embedded), but **rollout remains blocked** by latency SLO and overlap parity gates.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```
