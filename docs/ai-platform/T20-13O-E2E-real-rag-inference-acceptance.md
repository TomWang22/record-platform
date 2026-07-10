# T20.13O-E2E — Real RAG inference acceptance

**Status:** End-to-end acceptance test transcript (read-only)
**Generated:** 2026-06-27
**Baseline SHA:** `8c1ab32`
**Embedded:** 10,065

## Harness

```bash
bash scripts/rp-ai-live-inference-transcript.sh \
  --embed-warmup-runs 3 --embed-warmup-threshold-ms 2000 --embed-retry-on-timeout 1

BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh

bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-och-decontaminate-scan.sh
```

**Local artifacts (not committed):**
- `bench_logs/ai-platform/e2e-rag-inference/20260626-224733.md`
- `bench_logs/ai-platform/e2e-rag-inference/20260626-224733.summary.json`
- `bench_logs/ai-platform/e2e-rag-inference/raw-20260626-224733/`

**Canonical timing:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-224736.jsonl`

---

## RAG prompt transcript

## Case 1 — catalog_activity

### User prompt
Summarize listing activity and buyer interest for my catalog.

### Production RAG answer
Your catalog shows 6 listing excerpt(s) and 2 revision excerpt(s) in grounded records.

1. Active listing activity: E2E Lean Listing 1781388696658 — active, $45.99; listing — unknown, $45.99; listing — unknown, $45.99
2. Buyer/offer interest: no offer summaries in this retrieval set
3. Revisions or price changes: E2E Lean Listing 1781388696658 — Listing revision for E2E Lean Listing 1781388696658 Editor: 2ed75568-7deb-4c29-9; E2E Lean Listing 1781385557571 — Listing revision for E2E Lean Listing 1781385557571 Editor: 2ed75568-7deb-4c29-9

Recommended next step: Review listings with pending offer summaries or recent revisions.

Grounding: based on 8 excerpt(s) from listing, listing_revision. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 6964.5
- source types: listing_revision, listing
- refs count: 7
- leakage: PASS

### Retrieved evidence
- Evidence 1: Listing revision for E2E Lean Listing 1781388696658
Editor: 2ed75568-7deb-4c29-91b0-6919f24a0c9f
Title: E2E Lean Listing 1781388696658
Description: Lean contract listing for A–D and detail proofs.
- Evidence 2: Seller listing: E2E Lean Listing 1781388696658
Status: active
Type: fixed_price
Price: 45.9900000000000000 USD
Description: Lean contract listing for A–D and detail proofs.
- Evidence 3: Listing: E2E Lean Listing 1781388696658
Type: fixed_price
Price: 45.9900000000000000 USD
Location: Brooklyn, NY
Description: Lean contract listing for A–D and detail proofs.

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? partial
- What worked: Structured catalog breakdown with listing/revision counts
- What was missing: No offer interest in set; some titles parse as unknown
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: listing, listing_revision
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 1017
- candidate_fetch_ms: 3540
- rerank_ms: 5
- shadow_total_ms: 4752
- latency_bound: candidate_fetch_bound
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: listing, listing_revision
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- entity_boosted_rows: 0
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 10006
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Blocks vector rollout: shadow p95-equivalent 4.8–10s and zero chunk overlap with flags off. Keyword production is useful and accepted.

---

## Case 2 — seller_notifications

### User prompt
What notifications matter most for my selling activity right now?

### Production RAG answer
Here are the main seller signals from your grounded records:

1. Offer activity: 8 offer summary excerpt(s) — e.g. countered $4136 on bf1360a1…; countered $4119 on cffbddc8…
2. Notifications: none in this retrieval set

Recommended next step: Respond to countered/pending offers before expiry.

Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 2499.8
- source types: obo_offer_summary
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: pending
Amount: 4436 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:38 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 778962dc-f619-4b55-81dd-
- Evidence 2: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)
- Evidence 3: Offer summary for listing cffbddc8-9620-46fd-803a-7486c86af284
Status: countered
Amount: 4119 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:36 GMT-0400 (Eastern Daylight Time)

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? yes
- What worked: Concrete offer amounts and statuses
- What was missing: No notification source_type in retrieval set
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 1025
- candidate_fetch_ms: 1797
- rerank_ms: 5
- shadow_total_ms: 3072
- latency_bound: mixed
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 3
- doc_overlap: 3
- entity_overlap: 9
- entity_boosted_rows: 8
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 4360
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Flagged mode improves overlap (3/3/9) but shadow p95 3–4.4s fails ≤3s SLO. Keyword answer is actionable; vector rollout not supported.

---

## Case 3 — offer_bidding_activity

### User prompt
Show a concise summary of bidding and offer activity tied to my recent listings.

### Production RAG answer
Offer and bidding activity from your retrieved records:

1. Offers: 4 pending, 4 countered across 4 listing reference(s)
2. Amounts seen: $4085–$4436 USD (from grounded excerpts only)
3. Auction/bid signals: none in this set

Recommended next step: Prioritize countered offers and listings with expiring pending amounts.

Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 2074.4
- source types: obo_offer_summary
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)
- Evidence 2: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: pending
Amount: 4436 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:38 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 778962dc-f619-4b55-81dd-
- Evidence 3: Offer summary for listing cffbddc8-9620-46fd-803a-7486c86af284
Status: countered
Amount: 4119 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:36 GMT-0400 (Eastern Daylight Time)

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? yes
- What worked: Pending/countered counts and USD range
- What was missing: No auction signals
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 1
- doc_overlap: 1
- entity_overlap: 3
- embed_ms: 7839
- candidate_fetch_ms: 3965
- rerank_ms: 5
- shadow_total_ms: 12128
- latency_bound: embed_bound
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 2
- doc_overlap: 2
- entity_overlap: 5
- entity_boosted_rows: 2
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 1971
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Dominant rollout blocker in this session: 12.1s shadow off with 7.8s embed. Only case with default chunk overlap — vector candidates exist but too slow for production.

---

## Case 4 — listing_revision_changes

### User prompt
What changed recently on listing revisions that may affect offers?

### Production RAG answer
No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only.

1. Offer activity found instead: pending $4436 on bf1360a1…; countered $4136 on bf1360a1…
2. Revision changes: not available in retrieved excerpts — open listing revisions directly for field-level history.

Recommended next step: Confirm offer amounts still match current listing price/terms.

Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 8400.5
- source types: obo_offer_summary
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: pending
Amount: 4436 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:38 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 778962dc-f619-4b55-81dd-
- Evidence 2: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)
- Evidence 3: Offer summary for listing cffbddc8-9620-46fd-803a-7486c86af284
Status: countered
Amount: 4119 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:36 GMT-0400 (Eastern Daylight Time)

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? partial
- What worked: Honest caveat when revisions missing; offer fallback
- What was missing: Revision chunks not retrieved for this prompt
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 752
- candidate_fetch_ms: 623
- rerank_ms: 2
- shadow_total_ms: 2049
- latency_bound: mixed
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 3
- doc_overlap: 3
- entity_overlap: 8
- entity_boosted_rows: 8
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 1446
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Keyword synthesis correctly caveats missing revisions. Shadow returns OBO chunks, not revisions — overlap gate fails. Keyword production accepted.

---

## Case 5 — private_negotiation_no_messages

### User prompt
Summarize my private seller-side negotiation context without exposing message bodies.

### Production RAG answer
Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries.

Private message bodies were not ingested or included in this answer.

Recommended next step: Query offer activity for listings with active OBO threads.

Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 3375.5
- source types: listing
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Seller listing: Kenny Dorham — Quiet Kenny [SOLD]
Status: active
Type: fixed_price
Price: 41.0000000000000000 USD
Description: Outbox audit patch 1781390023
- Evidence 2: Seller listing: E2E UI Listing 1781389086102 (revised)
Status: active
Type: fixed_price
Price: 55.0000000000000000 USD
Description: Paragraph one: quiet vinyl. Paragraph two: plays clean. Paragraph three: ships insured.
- Evidence 3: Seller listing: E2E UI Listing 1781389086102
Status: active
Type: fixed_price
Price: 55.0000000000000000 USD
Description: Paragraph one: quiet vinyl. Paragraph two: plays clean. Paragraph three: ships insured.

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? partial
- What worked: Explicit message-body exclusion
- What was missing: Listing-only refs limit negotiation depth
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: listing
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 410
- candidate_fetch_ms: 580
- rerank_ms: 2
- shadow_total_ms: 1078
- latency_bound: mixed
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: listing
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- entity_boosted_rows: 0
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 1847
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Safety PASS with explicit message-body exclusion. Shadow retrieves listing chunks only; zero overlap. Supports keyword-only production.

---

## Case 6 — seller_attention_today

### User prompt
What should I pay attention to as a seller today?

### Production RAG answer
Top seller actions from grounded records today:

1. Refresh active listing Kenny Dorham — Quiet Kenny [SOLD]
2. Refresh active listing E2E UI Listing 1781389086102 (revised)
3. Refresh active listing E2E UI Listing 1781389086102

Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 2844.1
- source types: listing
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Seller listing: Kenny Dorham — Quiet Kenny [SOLD]
Status: active
Type: fixed_price
Price: 41.0000000000000000 USD
Description: Outbox audit patch 1781390023
- Evidence 2: Seller listing: E2E UI Listing 1781389086102 (revised)
Status: active
Type: fixed_price
Price: 55.0000000000000000 USD
Description: Paragraph one: quiet vinyl. Paragraph two: plays clean. Paragraph three: ships insured.
- Evidence 3: Seller listing: E2E UI Listing 1781389086102
Status: active
Type: fixed_price
Price: 55.0000000000000000 USD
Description: Paragraph one: quiet vinyl. Paragraph two: plays clean. Paragraph three: ships insured.

### Answer quality judgment
- Score: 4.0/5
- Useful to seller/buyer? partial
- What worked: Ranked top-3 actions
- What was missing: OBO-ranked actions absent; listing refresh only
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: listing
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 550
- candidate_fetch_ms: 1034
- rerank_ms: 2
- shadow_total_ms: 1780
- latency_bound: mixed
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: listing
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- entity_boosted_rows: 0
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 1086
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Best keyword score (4/5) with ranked actions. Shadow adds latency without overlap benefit. Keyword production only.

---

## Case 7 — marketplace_activity_summary

### User prompt
Give me a grounded summary of recent marketplace activity relevant to me.

### Production RAG answer
Recent marketplace activity relevant to you (seller-scoped):

1. Listings: none in set
2. Offers: 8 excerpt(s) — 4 pending, 4 countered
3. Revisions/notifications/auctions: 

Recommended next step: Respond to countered offer countered $4136 on bf1360a1…

Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

### Production path
- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- latency_ms: 4310.6
- source types: obo_offer_summary
- refs count: 8
- leakage: PASS

### Retrieved evidence
- Evidence 1: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: pending
Amount: 4436 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:38 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 778962dc-f619-4b55-81dd-
- Evidence 2: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)
- Evidence 3: Offer summary for listing cffbddc8-9620-46fd-803a-7486c86af284
Status: pending
Amount: 4419 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:36 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 77f3f2db-be1e-42a5-a189-

### Answer quality judgment
- Score: 3.5/5
- Useful to seller/buyer? yes
- What worked: Offer counts and next-step recommendation
- What was missing: Listings/revisions/notifications empty in template section
- Safety: PASS

### Shadow telemetry, flags off
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- embed_ms: 576
- candidate_fetch_ms: 1780
- rerank_ms: 2
- shadow_total_ms: 2615
- latency_bound: candidate_fetch_bound
- failure_class: not_zero_result

### Shadow telemetry, flags on
- selected_count: 8
- source types: obo_offer_summary
- chunk_overlap: 0
- doc_overlap: 0
- entity_overlap: 0
- entity_boosted_rows: 1
- neighbor_rows_added: 0
- embed_ms: n/a
- candidate_fetch_ms: n/a
- rerank_ms: n/a
- shadow_total_ms: 3035
- latency_bound: mixed
- failure_class: not_zero_result

### Rollout implication
Keyword summary useful (offer counts + next step). Shadow cf-bound (~1.8s) but aggregate gates still fail. Keyword accepted.

---

## Structured endpoints

### Endpoint — seller_sales_summary

### Output
Seller activity across 10 grounded sources.

### Telemetry
- HTTP: 200
- model_used: rule-engine
- latency_ms: 1874.6
- source types: obo_offer_summary, listing
- refs count: 10
- leakage: PASS

### Quality judgment
- Score: 3/5
- Useful? partial
- What worked: Returns grounded source count
- What was missing: Summary still generic one-liner

---

### Endpoint — pricing_recommendation

### Output
Suggested price near $55.0 based on listing, revisions, and offer/auction summaries.

### Telemetry
- HTTP: 200
- model_used: rule-engine
- latency_ms: 154.8
- source types: obo_offer_summary, listing
- refs count: 5
- leakage: PASS

### Quality judgment
- Score: 4/5
- Useful? yes
- What worked: Concrete price suggestion
- What was missing: Could cite specific listing

---

### Endpoint — record_valuation

### Output
Record located; insufficient comparable pricing in corpus.

### Telemetry
- HTTP: 200
- model_used: rule-engine
- latency_ms: 75.8
- source types: obo_offer_summary
- refs count: 5
- leakage: PASS

### Quality judgment
- Score: 3/5
- Useful? partial
- What worked: Honest insufficient-data message
- What was missing: Limited comparables

---

### Endpoint — auction_risk

### Output
2 auction risk signal(s) from bid summaries.

### Telemetry
- HTTP: 200
- model_used: rule-engine
- latency_ms: 52.5
- source types: auction_bid_summary
- refs count: 1
- leakage: PASS

### Quality judgment
- Score: 4/5
- Useful? yes
- What worked: Counts risk signals
- What was missing: Single ref only

---

### Endpoint — buyer_collection_summary

### Output
HTTP 404 — endpoint not exposed (pre-existing gap)

### Telemetry
- HTTP: 0
- model_used: None
- latency_ms: 83.6
- source types: 
- refs count: 0
- leakage: PASS

### Quality judgment
- Score: 0/5
- Useful? no
- What worked: n/a
- What was missing: Pre-existing 404 route gap

---

## Production keyword telemetry

| Metric | Value |
|--------|------:|
| cases | 7 |
| non-empty | 7 |
| p50 latency | 3,376 ms |
| p95 latency | 8,401 ms |
| model_used | rule-engine |
| retrieval_mode | keyword |
| leakage | PASS |

## Shadow flags-off telemetry

| Metric | Value |
|--------|------:|
| cases | 7 |
| fetch attempted | 7/7 |
| embed timeouts | 0 |
| true zero-results | 0 |
| chunk overlap >0 | 1/7 |
| doc overlap >0 | 1/7 |
| entity overlap >0 | 1/7 |
| p50 total | 2,615 ms |
| p95 total | 12,128 ms |
| p50 candidate_fetch | 1,163 ms |
| p95 candidate_fetch | 3,965 ms |

## Shadow flags-on telemetry

| Metric | Value |
|--------|------:|
| cases | 7 |
| fetch attempted | 7/7 |
| embed timeouts | 0 |
| true zero-results | 0 |
| chunk overlap >0 | 3/7 |
| doc overlap >0 | 3/7 |
| entity overlap >0 | 3/7 |
| entity_boosted rows >0 | 4/7 |
| neighbor rows added >0 | 0/7 |
| p50 total | 1,971 ms |
| p95 total | 10,006 ms |
| p50 candidate_fetch | 802 ms |
| p95 candidate_fetch | 4,763 ms |

## Canonical shadow timing (t20-10 warmed)

| Metric | p50 | p95 |
|--------|----:|----:|
| shadow total | 2,921 ms | 8,416 ms |
| embed | 1,421 ms | 3,331 ms |
| candidate_fetch | 979 ms | 1,591 ms |
| rerank_select | 3 ms | 5 ms |

## Top 10 slow shadow cases (live inference session)

| Case | Mode | total_ms | embed_ms | candidate_fetch_ms | rerank_ms | bound |
|------|------|--------:|---------:|-------------------:|----------:|-------|
| offer_bidding_activity | off | 12,128 | 7,839 | 3,965 | 5 | embed_bound |
| catalog_activity | on | 10,006 | n/a | n/a | n/a | mixed |
| catalog_activity | off | 4,752 | 1,017 | 3,540 | 5 | candidate_fetch_bound |
| seller_notifications | on | 4,360 | n/a | n/a | n/a | mixed |
| marketplace_activity_summary | on | 3,035 | n/a | n/a | n/a | mixed |
| seller_notifications | off | 3,072 | 1,025 | 1,797 | 5 | mixed |
| marketplace_activity_summary | off | 2,615 | 576 | 1,780 | 2 | candidate_fetch_bound |
| seller_attention_today | off | 1,780 | 550 | 1,034 | 2 | mixed |
| private_negotiation_no_messages | on | 1,847 | n/a | n/a | n/a | mixed |
| listing_revision_changes | off | 2,049 | 752 | 623 | 2 | mixed |

## Contracts and readiness

| Check | Result |
|-------|--------|
| audit-rp-ai-rag-contract | PASS |
| rp-ai-rag-quality-smoke | PASS |
| audit-rp-ai-runtime-contract | PASS |
| audit-rp-ai-endpoints-contract | PASS |
| rp-ai-provider-readiness | PASS |
| rp-ai-pgvector-readiness | PASS |
| rp-och-decontaminate-scan | PASS (589 files) |

## Acceptance criteria

```text
Production keyword answers non-empty: PASS
Production keyword answer quality ≥3.5 avg: PASS (3.6/5)
No leakage/message bodies: PASS
Contracts/smokes: PASS
Shadow fetch attempted: PASS (7/7)
Shadow p95 ≤3s: FAIL (10,006–12,128 ms live; 8,416 ms canonical)
Shadow overlap adequate: FAIL (1/7 off chunk; 3/7 flagged)
Flagged mode improves overlap: PASS (1/7 → 3/7 chunk overlap)
Vector rollout: NOT APPROVED
Phase 21: NOT STARTED
```

## Final decision

```text
Production keyword RAG: ACCEPTED
Keyword synthesis: ACCEPTED
Shadow vector rollout: NOT APPROVED
Phase 21: NOT STARTED

Reason:
- keyword answers are useful and grounded after synthesis
- shadow vector still misses latency/overlap gates
- flagged mode is diagnostic-only
```

**Next recommended engineering ticket:** T20.13O latency stabilization implementation (not started by this E2E run).