# T20.13G-S — Real use-case answer quality report

**Status:** READ-ONLY evaluator report (no code changes)  
**Generated:** 2026-06-26  
**Baseline SHA:** `a3130c8`  
**Evidence source:** `bench_logs/ai-platform/live-inference/raw-20260626-190817/` (T20.13G warmed run)

---

## Executive decision

- **Production keyword path is safe and grounded.** All 7 RAG prompts returned HTTP 200, real corpus excerpts, no message bodies, leakage PASS.
- **Production answers are mostly extractive/rule-engine, not generative reasoning.** The API `summary` field is almost always the generic string *"Retrieved 8 grounded excerpts for your question."* — the product does not synthesize a seller-facing narrative from retrieved evidence.
- **Current answer quality is acceptable for grounded evidence retrieval but not for rich AI insight.** A seller must infer meaning from raw excerpts (or UI that renders them). Structured endpoints (`pricing_recommendation`, `auction_risk`) deliver more product value than generic RAG.
- **Shadow vector is not rollout-ready.** p95 latency 6.3–8.4s, weak default overlap, and shadow does not improve the user-visible answer text anyway (same rule-engine summary).
- **Vector rollout: NOT APPROVED**
- **Phase 21: not started**

---

## Scoring rubric

| Score | Meaning |
|------:|---------|
| 5 | Strong product answer: specific, grounded, useful, cites relevant evidence, no leakage |
| 4 | Good grounded answer, minor missing synthesis |
| 3 | Safe but shallow/extractive; useful only as evidence retrieval |
| 2 | Weak answer; technically grounded but not very useful |
| 1 | Bad answer, wrong/empty/unsafe |
| 0 | Error/no response/leakage |

**Classifications used per case:**

- `answer_type`: extractive, summary, recommendation, degraded, error  
- `user_value`: high, medium, low  
- `grounding`: strong, partial, weak, none  
- `safety`: pass/fail  

---

## RAG prompt cases

---

### 1. Catalog / listing activity

```text
Prompt:
Summarize listing activity and buyer interest for my catalog.

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
3,288.8 ms

Source types:
listing, listing_revision

Refs count:
7

Top retrieved evidence:
- Evidence 1: Listing revision for E2E Lean Listing … Title: E2E Lean Listing … Description: Lean contract listing for A–D and detail proofs.
- Evidence 2: Listing: E2E Lean Listing … Type: fixed_price Price: 45.99 USD Location: Brooklyn, NY …
- Evidence 3: Seller listing: E2E Lean Listing … Status: active Type: fixed_price Price: 45.99 USD …

Evaluator judgment:
- Score: 3/5
- Answer type: extractive
- User value: low (answer text); medium (if user reads excerpts in UI)
- Grounding: strong — listings and revisions match the catalog question
- Safety: pass
- What worked: Correct source types; revision + active listing with price/location; no leakage
- What was missing: No synthesized summary of activity or buyer interest; user gets a retrieval stub, not "your catalog has X active listings, Y revisions, highest interest on …"
- Product interpretation: Acceptable as an evidence panel backend; poor as "AI summary" in product copy

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: listing, listing_revision
- flags off chunk/doc/entity overlap: 0 / 0 / 0 (same_source_type_different_chunks)
- flags off latency breakdown: embed 2,094 / candidate_fetch 3,927 / rerank 5 / total 6,276 ms
- flags on selected_count: 8
- flags on source types: listing, listing_revision
- flags on chunk/doc/entity overlap: 0 / 0 / 0
- flags on latency breakdown: embed 4,712 / candidate_fetch 3,590 / rerank 7 / total 8,449 ms
- Did flags improve this case? No — overlap still zero; latency worse
- Why this matters for rollout: Shadow finds similar types but different chunks; vector path adds 3–5s+ with no answer-quality gain
```

---

### 2. Seller notifications / offers

```text
Prompt:
What notifications matter most for my selling activity right now?

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
1,238.3 ms

Source types:
obo_offer_summary

Refs count:
8

Top retrieved evidence:
- Evidence 1: Offer summary … Status: pending Amount: 4436 USD Attempt: 1 Expires: Wed Jun 24 2026 …
- Evidence 2: Offer summary … Status: countered Amount: 4136 USD Attempt: 1 Expires: …
- Evidence 3: Offer summary … Status: pending Amount: 4419 USD Attempt: 1 Expires: …

Evaluator judgment:
- Score: 3/5
- Answer type: extractive
- User value: low (answer text); medium-high (evidence is actionable — pending/countered offers with dollar amounts)
- Grounding: strong — OBO summaries are the right signal for seller notifications
- Safety: pass — offer summaries only, no message bodies
- What worked: Rich offer state in excerpts (pending vs countered, amounts, expiry)
- What was missing: No ranking of "what matters most"; no "you have 3 pending offers totaling …"; answer text is generic
- Product interpretation: Evidence would help a seller in a drill-down UI; the headline AI answer does not

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: obo_offer_summary
- flags off chunk/doc/entity overlap: 0 / 0 / 0
- flags off latency breakdown: embed 1,821 / candidate_fetch 1,825 / rerank 2 / total 3,771 ms
- flags on selected_count: 8
- flags on source types: obo_offer_summary
- flags on chunk/doc/entity overlap: 3 / 3 / 9
- flags on latency breakdown: embed 873 / candidate_fetch 711 / rerank 6 / total 1,792 ms
- Did flags improve this case? Yes for overlap diagnostics; no change to user-visible answer
- Why this matters for rollout: Flagged mode aligns shadow chunks with keyword on OBO-heavy prompts — useful for parity testing, not product answers
```

---

### 3. Offer / bidding activity

```text
Prompt:
Show a concise summary of bidding and offer activity tied to my recent listings.

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
1,572.5 ms

Source types:
obo_offer_summary

Refs count:
8

Top retrieved evidence:
- Evidence 1: Offer summary … Status: countered Amount: 4136 USD …
- Evidence 2: Offer summary … Status: pending Amount: 4436 USD …
- Evidence 3: Offer summary … Status: pending Amount: 4419 USD …

Evaluator judgment:
- Score: 3/5
- Answer type: extractive
- User value: low (answer text); medium (evidence shows multi-listing offer activity)
- Grounding: strong — OBO summaries match bidding/offer intent
- Safety: pass
- What worked: Multiple listings represented; status and amounts present
- What was missing: No concise summary — user asked for one; system returns retrieval boilerplate
- Product interpretation: Same pattern as notifications — good corpus, weak synthesis

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: obo_offer_summary
- flags off chunk/doc/entity overlap: 1 / 1 / 3
- flags off latency breakdown: embed 382 / candidate_fetch 605 / rerank 2 / total 1,143 ms
- flags on selected_count: 8
- flags on source types: obo_offer_summary
- flags on chunk/doc/entity overlap: 2 / 2 / 5
- flags on latency breakdown: embed 1,674 / candidate_fetch 1,265 / rerank 1 / total 3,325 ms
- Did flags improve this case? Slightly — overlap 1→2 chunks; answer unchanged
- Why this matters for rollout: Best overlap case off-mode; still not production-ready latency on flagged path
```

---

### 4. Listing revision changes

```text
Prompt:
What changed recently on listing revisions that may affect offers?

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
3,390.7 ms

Source types:
obo_offer_summary

Refs count:
8

Top retrieved evidence:
- Evidence 1: Offer summary … Status: pending Amount: 4436 USD …
- Evidence 2: Offer summary … Status: countered Amount: 4136 USD …
- Evidence 3: Offer summary … Status: countered Amount: 4119 USD …

Evaluator judgment:
- Score: 2/5
- Answer type: extractive
- User value: low
- Grounding: partial — retrieved OBO offers, not listing_revision documents; does not answer "what changed on revisions"
- Safety: pass
- What worked: Offer context is related to "may affect offers" secondarily
- What was missing: No revision diffs, editor, or field-level changes; wrong primary source type for the question
- Product interpretation: Retrieval miss for intent — seller asking about revision history gets offer inbox data

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: obo_offer_summary
- flags off chunk/doc/entity overlap: 0 / 0 / 0
- flags off latency breakdown: embed 356 / candidate_fetch 627 / rerank 2 / total 1,104 ms
- flags on selected_count: 8
- flags on source types: obo_offer_summary
- flags on chunk/doc/entity overlap: 3 / 3 / 8
- flags on latency breakdown: embed 1,148 / candidate_fetch 3,184 / rerank 2 / total 4,419 ms
- Did flags improve this case? Overlap yes; relevance to question still poor on keyword path
- Why this matters for rollout: Vector shadow can overlap with keyword on wrong-but-same-type chunks — parity metric ≠ answer correctness
```

---

### 5. Private negotiation (no message bodies)

```text
Prompt:
Summarize my private seller-side negotiation context without exposing message bodies.

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
1,043.6 ms

Source types:
listing

Refs count:
8

Top retrieved evidence:
- Evidence 1: Seller listing: Kenny Dorham — Quiet Kenny [SOLD] Status: active … Price: 41.00 USD …
- Evidence 2: Seller listing: E2E UI Listing … (revised) Status: active … Price: 55.00 USD …
- Evidence 3: Seller listing: E2E UI Listing … Status: active … Price: 55.00 USD …

Evaluator judgment:
- Score: 2/5
- Answer type: extractive
- User value: low
- Grounding: weak — listings only; no OBO negotiation summaries despite being the privacy-safe negotiation signal
- Safety: pass — no message bodies (requirement met)
- What worked: Privacy constraint honored
- What was missing: No negotiation context (offer states, counters); generic inventory dump
- Product interpretation: Safety goal met; product value for "negotiation summary" not delivered

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: listing
- flags off chunk/doc/entity overlap: 0 / 0 / 0
- flags off latency breakdown: embed 500 / candidate_fetch 524 / rerank 4 / total 1,093 ms
- flags on selected_count: 8
- flags on source types: listing
- flags on chunk/doc/entity overlap: 0 / 0 / 0
- flags on latency breakdown: embed 1,590 / candidate_fetch 1,913 / rerank 1 / total 3,832 ms
- Did flags improve this case? No
- Why this matters for rollout: Shadow cannot fix keyword routing that skips OBO summaries for negotiation prompts
```

---

### 6. Seller attention today

```text
Prompt:
What should I pay attention to as a seller today?

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
1,058.8 ms

Source types:
listing

Refs count:
8

Top retrieved evidence:
- Evidence 1: Seller listing: Kenny Dorham — Quiet Kenny [SOLD] … Price: 41.00 USD …
- Evidence 2: Seller listing: E2E UI Listing … (revised) … Price: 55.00 USD …
- Evidence 3: Seller listing: E2E UI Listing … Price: 55.00 USD …

Evaluator judgment:
- Score: 2/5
- Answer type: extractive
- User value: low
- Grounding: partial — seller listings present but no prioritization signal (offers, expiring auctions, unread notifications)
- Safety: pass
- What worked: Owner-scoped listing data
- What was missing: No "attention" ranking — expiring offers, countered deals, stale listings absent from answer
- Product interpretation: Reads as catalog browse, not a daily briefing

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: listing
- flags off chunk/doc/entity overlap: 0 / 0 / 0
- flags off latency breakdown: embed 322 / candidate_fetch 423 / rerank 1 / total 845 ms
- flags on selected_count: 8
- flags on source types: listing
- flags on chunk/doc/entity overlap: 0 / 0 / 0
- flags on latency breakdown: embed 3,067 / candidate_fetch 3,293 / rerank 3 / total 6,582 ms
- Did flags improve this case? No — flagged path slowest case tier
- Why this matters for rollout: High latency without overlap or answer improvement
```

---

### 7. Marketplace activity summary

```text
Prompt:
Give me a grounded summary of recent marketplace activity relevant to me.

Actual answer:
Retrieved 8 grounded excerpts for your question.

Model used:
rule-engine

Retrieval mode:
keyword

HTTP status:
200

Latency:
1,454.1 ms

Source types:
obo_offer_summary

Refs count:
8

Top retrieved evidence:
- Evidence 1: Offer summary … Status: countered Amount: 4136 USD …
- Evidence 2: Offer summary … Status: pending Amount: 4436 USD …
- Evidence 3: Offer summary … Status: pending Amount: 4419 USD …

Evaluator judgment:
- Score: 3/5
- Answer type: extractive
- User value: low (answer text); medium (offer activity is relevant marketplace signal for this seller)
- Grounding: strong for seller-centric "my activity"; weak for broader marketplace trends
- Safety: pass
- What worked: Recent offer states with amounts
- What was missing: No cross-listing synthesis; "marketplace" reads as "my offers" only
- Product interpretation: Acceptable for seller-scoped activity feed evidence; not a marketplace analyst answer

Shadow telemetry:
- flags off selected_count: 8
- flags off source types: obo_offer_summary
- flags off chunk/doc/entity overlap: 0 / 0 / 0 (source_type_mismatch)
- flags off latency breakdown: embed 677 / candidate_fetch 667 / rerank 3 / total 1,478 ms
- flags on selected_count: 8
- flags on source types: obo_offer_summary
- flags on chunk/doc/entity overlap: 0 / 0 / 0
- flags on latency breakdown: embed 2,200 / candidate_fetch 1,515 / rerank 4 / total 4,279 ms
- Did flags improve this case? No
- Why this matters for rollout: source_type_mismatch flag — keyword vs shadow type sets differ in diagnostics even when both return 8 refs
```

---

## Structured endpoint cases

### seller_sales_summary

```text
Endpoint:
POST /api/ai/seller/summary

Actual output:
Seller activity across 10 grounded sources.

HTTP status:
200

Model used:
rule-engine

Latency:
2,809.7 ms

Refs/source types:
10 refs — listing (1), obo_offer_summary (9)

Structured details:
counts_by_source_type: listing 1, obo_offer_summary 9

Evaluator judgment:
- Score: 3/5
- Answer type: summary
- User value: medium — confirms offer-heavy activity mix but no narrative
- Grounding: strong
- Safety: pass
- What worked: Typed endpoint; source mix visible in details
- What was missing: Same shallow headline as RAG; seller cannot see "9 open offers across 1 listing" without parsing details JSON
```

### buyer_collection_summary

```text
Endpoint:
POST /api/ai/buyer/summary

Actual output:
(error — HTTP 404, route not available)

HTTP status:
0 / 404

Model used:
(none)

Latency:
96.8 ms

Refs/source types:
0

Evaluator judgment:
- Score: 0/5
- Answer type: error
- User value: none
- Grounding: none
- Safety: pass (no content leaked)
- What worked: n/a
- What was missing: Pre-existing route gap — buyer insight endpoint not wired
```

### pricing_recommendation

```text
Endpoint:
POST /api/ai/listings/pricing-advice

Actual output:
Suggested price near $55.0 based on listing, revisions, and offer/auction summaries.

HTTP status:
200

Model used:
rule-engine

Latency:
288.9 ms

Refs/source types:
5 refs — listing, obo_offer_summary

Structured details:
suggested_fixed_price: 55.0 | obo_floor: 41.0 | auction_starting_bid: 41.0 | auction_reserve_hint: 55.0
quality_signals: description, shipping, condition, photos improvements listed
negotiation_guidance: review_offer_summaries (no message bodies)

Evaluator judgment:
- Score: 4/5
- Answer type: recommendation
- User value: high — actionable price band + listing quality tips
- Grounding: strong
- Safety: pass
- What worked: Specific dollar amounts; structured guidance; fast latency
- What was missing: Minor — could tie suggested price to named comparable listings in prose
```

### record_valuation

```text
Endpoint:
POST /api/ai/records/valuation

Actual output:
Record located; insufficient comparable pricing in corpus.

HTTP status:
200

Model used:
rule-engine

Latency:
136.5 ms

Refs/source types:
5 refs — obo_offer_summary (comparable_chunks: 5, valuation_band all null)

Evaluator judgment:
- Score: 3/5
- Answer type: degraded
- User value: low-medium — honest limitation message beats hallucination
- Grounding: partial — record found, comps insufficient
- Safety: pass
- What worked: Transparent degraded response
- What was missing: No valuation band; user gets status not value
```

### auction_risk

```text
Endpoint:
POST /api/ai/auctions/risk

Actual output:
2 auction risk signal(s) from bid summaries.

HTTP status:
200

Model used:
rule-engine

Latency:
57.6 ms

Refs/source types:
1 ref — auction_bid_summary

Structured signals:
- ending_soon (high): Auction end time present in summary
- likely_underpriced (low): Current bid below typical band

Evaluator judgment:
- Score: 4/5
- Answer type: recommendation
- User value: high — specific risk codes with severity
- Grounding: strong
- Safety: pass
- What worked: Structured signals; fast; masked bidder context
- What was missing: Could name which auction/listing in summary line
```

---

## Aggregate scorecard

| Area | Avg score | Notes |
|------|----------:|-------|
| RAG keyword answers | **2.6/5** | All 7 shallow boilerplate summaries; evidence often useful, answer text rarely is |
| Structured insight endpoints | **3.4/5** | Excluding 404 buyer endpoint; pricing + auction_risk strong; seller summary shallow |
| Structured (incl. buyer 404) | **2.8/5** | Buyer route gap pulls average down |
| Safety/leakage | **pass** | No message bodies; no forbidden tokens across all cases |
| Grounding | **partial** | Strong on OBO/listing prompts; weak on revision-change and negotiation intent |
| AI reasoning depth | **low** | Rule-engine extractive retrieval; no generative synthesis on RAG path |
| Shadow readiness | **not ready** | p95 6.3–8.4s; overlap 1/7 default; does not improve user-visible answers |

**Shallow/extractive cases (score ≤3 on answer text):** All 7 RAG prompts; `seller_sales_summary`; `record_valuation` (degraded honesty).

**Best actual answer:** `pricing_recommendation` — *"Suggested price near $55.0…"* with structured floor/reserve/quality signals.

**Worst actual answer (RAG):** `listing_revision_changes` — question asks for revision changes; retrieval returns OBO offer summaries only (grounding partial).

**Worst overall:** `buyer_collection_summary` — pre-existing 404.

**Most useful endpoint:** `pricing_recommendation` (actionable dollars + guidance, 289 ms).

---

## Key product findings

1. **Keyword path is safe and grounded** — real owner-scoped corpus excerpts; no message leakage.
2. **RAG answers are too extractive/shallow for "AI insight" positioning** — every RAG `summary` is the same retrieval stub; product value lives in excerpts/details, not the answer string.
3. **Structured endpoints provide better product value** — pricing and auction risk return specific, actionable outputs; generic RAG does not.
4. **Shadow vector improves some diagnostic overlap but does not solve answer quality** — user-visible text identical; shadow adds seconds of latency.
5. **Latency remains too high for vector rollout** — shadow p95 6,276 ms (off) / 8,449 ms (flagged) vs 3,000 ms target.
6. **No message body leakage observed.**

---

## Telemetry summary

| Metric | Value |
|--------|------:|
| keyword latency p50 / p95 | 1,454 / 3,391 ms |
| shadow off p50 / p95 | 1,143 / **6,276** ms |
| shadow flagged p50 / p95 | 4,279 / **8,449** ms |
| embed p95 (shadow off / flagged) | 2,094 / 4,712 ms |
| candidate_fetch p95 (shadow off / flagged) | 3,927 / 3,590 ms |
| overlap chunk >0 (off / flagged) | **1 / 7** / **3 / 7** |
| embed timeout count | **0** |
| request error count | **0** |
| true zero-result count | **0** |

---

## Recommendation

**Selected: A first, B second, C shadow-only experiment (not production default)**

| Option | Verdict |
|--------|---------|
| **A. Improve rule-engine answer synthesis over keyword refs** | **First** — highest product ROI without vector rollout; turn excerpts into seller-readable summaries per route |
| **B. Continue shadow vector latency/overlap work** | **Second** — blocked until p95 ≤3s and overlap gates pass; parallel track, not user-facing |
| **C. Generative Ollama answer mode as shadow-only experiment** | **Optional later** — could test synthesis quality in shadow; must not become production default until safety/latency proven |
| **D. Stop and keep keyword evidence retrieval** | **Partial** — acceptable interim UX if UI renders excerpts; insufficient for "AI insights" marketing |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```
