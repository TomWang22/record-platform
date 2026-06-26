# T20.13G — Shadow fetch latency and overlap triage

**Status:** READ-ONLY triage (no code changes)  
**Generated:** 2026-06-26  
**Baseline SHA:** `cbb4bdd`  
**Embedded:** 10,065 (~13.8% of non-message chunks)

## Context

T20.13E/F embed warmup eliminated harness cold-start noise (`embed_timeout_before_fetch` 7/7 → 0/7; `shadow_fetch_attempted` 0/7 → 7/7). Shadow diagnostics are now measuring **real** latency and overlap behavior. This doc triages remaining rollout blockers.

## Artifacts analyzed (local, not committed)

| Artifact | Path |
|----------|------|
| Live inference summary | `bench_logs/ai-platform/live-inference/20260626-190817.summary.json` |
| Live inference raw JSON | `bench_logs/ai-platform/live-inference/raw-20260626-190817/` |
| Canonical shadow timing | `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-191256.jsonl` |
| Canonical timing report | `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-191256.md` |
| Route shadow quality | `bench_logs/ai-platform/t19-6-route-shadow-quality.md` |
| RAG contract audit | `bench_logs/ai-platform/rag-ingestion-contract.md` — **PASS** |
| Quality smoke | `bench_logs/ai-platform/phase-17-rag-quality-smoke.md` — **PASS** |
| Provider readiness | `bench_logs/ai-platform/phase-17-provider-readiness.md` — **PASS** |
| pgvector readiness | `bench_logs/ai-platform/phase-18-pgvector-readiness.md` — **PASS** |
| OCH decontaminate | **PASS** (590 files scanned) |

**Harness commands (T20.13G run):**

```bash
bash scripts/rp-ai-live-inference-transcript.sh \
  --embed-warmup-runs 3 --embed-warmup-threshold-ms 2000 --embed-retry-on-timeout 1

BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh
```

Warmup gate passed (3/3). One embed retry attempted/succeeded during flagged mode (`offer_bidding_activity`).

---

## Latency

### Aggregate p50 / p95 (ms)

| Phase | Source | total p50/p95 | embed p50/p95 | candidate_fetch p50/p95 | rerank p50/p95 |
|-------|--------|--------------:|--------------:|------------------------:|---------------:|
| Keyword production | live inference | **1,454 / 3,391** | n/a | n/a | n/a |
| Shadow flags **off** | live inference | **1,143 / 6,276** | **500 / 2,094** | **627 / 3,927** | **2 / 5** |
| Shadow flags **on** | live inference | **4,279 / 8,449** | **1,674 / 4,712** | **1,913 / 3,590** | **3 / 7** |
| Shadow (canonical) | t20-10 timing | **2,395 / 7,580** | **774 / 5,156** | **993 / 2,457** | **3 / 16** |

**Rollout SLO reference (T20.13):** shadow p95 ≤ **3,000 ms** → **FAIL** on all warmed runs (6,276–8,449 ms live inference; 7,580 ms canonical).

Rerank/select is negligible (<20 ms p95 everywhere). Privacy/rerank is not a bottleneck.

### Top 5 slow shadow cases (live inference, combined modes)

| Rank | case | mode | total_ms | embed_ms | cf_ms | rerank_ms | classification |
|-----:|------|------|--------:|---------:|------:|----------:|----------------|
| 1 | catalog_activity | flagged on | 8,449 | 4,712 | 3,590 | 7 | **embed_bound** |
| 2 | seller_attention_today | flagged on | 6,582 | 3,067 | 3,293 | 3 | **candidate_fetch_bound** |
| 3 | catalog_activity | flags off | 6,276 | 2,094 | 3,927 | 5 | **candidate_fetch_bound** |
| 4 | listing_revision_changes | flagged on | 4,419 | 1,148 | 3,184 | 2 | **candidate_fetch_bound** |
| 5 | marketplace_activity_summary | flagged on | 4,279 | 2,200 | 1,515 | 4 | **embed_bound** |

### Canonical timing — top total_ms (t20-10, warmed)

| profile | total_ms | embed_ms | cf_ms | query (truncated) |
|---------|--------:|---------:|------:|-------------------|
| obo_helper | 7,911 | 6,045 | 1,202 | What notifications matter most for my selling activity… |
| (default) | 7,469 | 4,859 | 2,259 | Summarize listing activity and buyer interest for my catalog… |
| obo_helper | 5,313 | 1,861 | 2,322 | Summarize listing activity and buyer interest for my catalog… |
| obo_helper | 4,449 | 2,715 | 1,555 | What are the most recent pricing or revision changes… |
| (default) | 4,171 | 3,068 | 915 | Show a concise summary of bidding and offer activity… |

One embed outlier ≥5s (`seller_notifications` / obo_helper: 6,045 ms embed, no timeout). Zero embed timeouts across 16 canonical shadow runs.

### p95 root-cause classification

| Scope | Verdict | Rationale |
|-------|---------|-----------|
| Shadow flags **off** p95 | **`mixed`** | cf p95 (3,927 ms) ≈ embed p95 (2,094 ms); top slow case cf-dominant (`catalog_activity` cf=3,927) |
| Shadow flags **on** p95 | **`mixed`** | embed p95 (4,712 ms) > cf p95 (3,590 ms); flagged mode adds entity-hint work increasing both phases |
| Canonical shadow p95 | **`mixed`** | embed p95 5,156 ms + cf p95 2,457 ms; top runs split embed-heavy vs fetch-heavy |
| Rerank | **negligible** | p95 ≤16 ms |
| Request errors | **0** | No `request_error` class in warmed runs |

**Summary:** Shadow p95 exceeds rollout target because **both Ollama embed variance and pgvector candidate_fetch cost** contribute. Neither phase alone explains all slow cases. Warmup removed timeout noise but **did not** bring p95 under 3s.

---

## Candidate fetch

### Slow-case profile

All live-inference shadow cases routed to profile **`seller_sales_summary`** with **`selected_count=8`** on every successful run. Keyword production source types per case:

| case | keyword source_types | zero_overlap_reason (flags off) | cf_ms (off/on) |
|------|---------------------|--------------------------------|---------------:|
| catalog_activity | listing, listing_revision | same_source_type_different_chunks | 3,927 / 3,590 |
| seller_notifications | obo_offer_summary | same_source_type_different_chunks | 1,825 / 711 |
| offer_bidding_activity | obo_offer_summary | (overlap 1/1/3) | 605 / 1,265 |
| listing_revision_changes | obo_offer_summary | same_source_type_different_chunks | 627 / 3,184 |
| private_negotiation_no_messages | listing | same_source_type_different_chunks | 524 / 1,913 |
| seller_attention_today | listing | same_source_type_different_chunks | 423 / 3,293 |
| marketplace_activity_summary | obo_offer_summary | source_type_mismatch | 667 / 1,515 |

### Fetch dominance hypothesis

| Pattern | Evidence |
|---------|----------|
| **Typed/route-weighted fetch** likely dominates slow cases | `catalog_activity` and `listing_revision_changes` hit listing + revision types; cf 3.2–3.9s with embed already warm |
| **Global/untyped fetch** on broad seller prompts | Canonical default mode: cf up to 2,861 ms with embed cache hit (embed=0, cache_hit=True) on notifications query |
| **Profile-specific fetch expansion** | obo_helper profile runs show cf 1.2–2.3s alongside high embed on same queries |
| **Corpus growth effect** | At 10,065 embedded rows, exact pgvector sort cost remains visible; T20.13A noted cf p95 2.4–2.8s pre-warmup — still present post-warmup at 2.5–3.9s p95 |
| **Source mix post-10k** | Unchanged vs T19.6: listing, listing_revision, obo_offer_summary, notification, auction_bid_summary dominate; record appears in route-weighted profiles only |

### T19.6 route diagnostic (hinted phase p95)

| prompt | profile | embed ms | fetch ms | overlap |
|--------|---------|--------:|---------:|--------:|
| notifications | generic_rag | 3,054 | 1,611 | 0 |
| listing_quality | pricing_recommendation | 5,533 | 0 | 0 (timeout/zero-result) |
| auction_risk | auction_risk | 2,372 | 1,704 | 0 |
| obo_counter | obo_helper | 2,455 | 1,383 | 0 |

Fetch ms typically 764–1,704 ms on successful hinted runs; embed often larger than fetch on slow prompts.

---

## Overlap

### Default (flags off) vs flagged (on)

| Metric | flags **off** | flags **on** | Δ |
|--------|-------------:|-------------:|---|
| cases with chunk overlap >0 | **1 / 7** | **3 / 7** | +2 |
| document overlap >0 | **1 / 7** | **3 / 7** | +2 |
| entity overlap >0 | **1 / 7** | **3 / 7** | +2 |
| entity_boosted rows >0 | 0 | **4 / 7** | +4 |
| neighbor rows added >0 | 0 | **0 / 7** | 0 |

### Overlap by case (chunk / doc / entity)

| case | off | on | entity_boosted (on) | zero_overlap_reason (off) |
|------|----:|---:|--------------------:|---------------------------|
| catalog_activity | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| seller_notifications | 0/0/0 | **3/3/9** | 8 | same_source_type_different_chunks |
| offer_bidding_activity | **1/1/3** | **2/2/5** | 2 | — |
| listing_revision_changes | 0/0/0 | **3/3/8** | 8 | same_source_type_different_chunks |
| private_negotiation_no_messages | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| seller_attention_today | 0/0/0 | 0/0/0 | 0 | same_source_type_different_chunks |
| marketplace_activity_summary | 0/0/0 | 0/0/0 | 1 | source_type_mismatch |

### Canonical timing overlap (16 shadow runs)

| Metric | Value |
|--------|------:|
| zero-overlap runs | **11 / 16** |
| document overlap >0 | 5 / 16 |
| entity overlap >0 | 5 / 16 |
| zero-result runs | **0 / 16** |
| same_source_type_different_chunks | **10** |
| source_type_mismatch | 1 |

### Overlap interpretation

1. **Default overlap is weak:** 6/7 live-inference cases and 11/16 canonical runs show zero chunk overlap despite `selected_count=8`. Primary reason: **`same_source_type_different_chunks`** — keyword and shadow agree on source types but select different chunk IDs.
2. **Flagged mode helps selectively:** entity hints lift overlap on OBO/revision-heavy prompts (`seller_notifications`, `listing_revision_changes`, `offer_bidding_activity`) but **not** on catalog, private negotiation, seller attention, or marketplace summaries.
3. **Neighbor expansion unused:** `neighbor_rows_added=0` on all cases — flag has no effect in current corpus/routes.
4. **Not a zero-result problem:** true zero-results remain **0** post-warmup; overlap weakness is **parity/measurement**, not empty fetch.
5. **Diagnostic-only value:** flagged overlap improvement (1/7 → 3/7 cases with chunk overlap >0) justifies **continued diagnostic tuning** but is **insufficient for rollout** — default-off overlap still fails the T20.13 gate.

---

## Product inference

Production keyword path unchanged and healthy.

| Check | Result |
|-------|--------|
| Keyword cases non-empty | **7 / 7** |
| model_used | **`rule-engine`** (all keyword + shadow cases) |
| Leakage | **PASS** |
| Structured endpoints | **4 / 5** non-empty (`buyer_collection_summary` 404 pre-existing) |
| Flags after run | `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0` |

### Sanitized real outputs

| use case | model | excerpt | source_types |
|----------|-------|---------|--------------|
| **catalog / listing** | rule-engine | Retrieved 8 grounded excerpts for your question. | listing, listing_revision |
| **seller notifications / offers** | rule-engine | Retrieved 8 grounded excerpts for your question. | obo_offer_summary |
| **private negotiation** | rule-engine | Retrieved 8 grounded excerpts for your question. | listing (no message bodies) |
| **pricing recommendation** | rule-engine | Suggested price near $55.0 based on listing, revisions, and offer/auction summaries. | listing, obo_offer_summary |

Contract audits, quality smoke, provider readiness, and pgvector readiness all **PASS**. Ollama embed warmup p95 still spiked to **24,916 ms** on one probe this run — runtime variance remains a operational risk even when gate passes.

---

## Recommendation

**Selected: A + C first; B later**

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **A. T20.13H typed-fetch / candidate-fetch trim proposal** | **YES — first** | cf p95 2.5–3.9s on slow cases; cache-hit run shows fetch alone can exceed 2.8s; C-lite shadow-profile fetch caps align with T20.13B |
| **B. T20.13H overlap refinement proposal** | **YES — later** | Flagged hints help 3/7 cases; default 6/7 still zero overlap via same-source-different-chunks; not rollout-blocking until latency stable |
| **C. T20.13H Ollama/runtime stabilization proposal** | **YES — parallel first** | embed p95 2.1–5.2s; canonical outlier 6,045 ms; warmup p95 spike 24,916 ms; embed-bound top cases remain |
| **D. Stop; rollout blocked** | **Implicit** | Rollout stays blocked regardless; triage continues via T20.13H proposals |

### Proposed T20.13H sequence

1. **T20.13H-A:** Read-only proposal for shadow-profile typed-fetch caps and candidate pool trimming (diagnostic/benchmark scope first; no production default change).
2. **T20.13H-C:** Read-only proposal for Ollama embed SLO hardening (warmup policy, timeout classification, optional keep-alive) — build on T20.13E harness, no product default change.
3. **T20.13H-B:** Overlap refinement (entity-hint routing, chunk-ID parity analysis) **after** A+C show stable p95 under repeated warmed runs.

**Do not start:** vector rollout, overlap flags default-on, index creation, embedding tranches, Phase 21, T20.14/T20.15.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Phase 21 is not started
Production retrieval remains keyword
```
