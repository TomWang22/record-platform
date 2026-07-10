# T20.13S — Record intelligence UI acceptance results

**Generated:** 2026-06-27  
**Run timestamp:** `20260627-032710`  
**Baseline SHA:** `b3664fd`  
**Harness:** T20.13R Playwright domain acceptance  
**Artifacts (local):** `bench_logs/ai-platform/ui-record-intelligence/20260627-032710/`

---

## Executive result

```text
Record intelligence UI acceptance: FAIL
Average domain score: 2.93/5
Production retrieval: keyword
model_used: rule-engine
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Summary:** 6/7 scenarios returned grounded keyword answers through the UI. Scenario 4 (auction psychology) **hard-failed** with HTTP 500 (`AttributeError: 'str' object has no attribute 'get'` in `auction_risk_signals` when `auction_bid_summary` metadata is a JSON string). Average domain score **2.93** missed the 3.5 soft target. No leakage, no old boilerplate, no major overclaiming. Latency acceptable (UI p50 3,137 ms / p95 3,785 ms).

**Playwright command:**

```bash
./scripts/webapp-playwright-strict-edge.sh \
  e2e/ai-rag-record-intelligence.spec.ts \
  --grep "AI record intelligence UI acceptance"
```

---

## Scenario scorecard

| Scenario | Score | Usefulness | Grounding | Domain depth | Actionability | Overclaiming | UI ms | API ms | Sources |
| -------- | ----: | ---------- | --------- | ------------ | ------------- | ------------ | ----: | -----: | ------- |
| Listing advice | 4.0 | high | partial | strong | strong | none | 2,065 | 1,609 | listing_revision, listing, record (7 refs) |
| Negotiation price advice | 4.0 | high | partial | strong | strong | none | 3,322 | 3,233 | listing (8 refs) |
| Buyer psychology | 3.0 | medium | partial | medium | medium | none | 3,543 | 3,476 | listing, obo_offer_summary (8 refs) |
| Auction psychology | 0.0 | low | none | shallow | weak | none | 2,062 | 1,991 | **HTTP 500 — no refs** |
| Pricing strategy | 3.5 | medium | partial | medium | strong | none | 3,785 | 3,699 | obo_offer_summary (8 refs) |
| Collector listing quality | 2.0 | low | partial | shallow | medium | none | 3,137 | 3,027 | listing, listing_revision (6 refs) |
| Daily seller action plan | 2.0 | low | partial | shallow | medium | none | 2,996 | 2,887 | listing (8 refs) |

**Best scenario:** Listing advice (4.0) — revision + listing evidence, ranked next step, buyer-interest gap noted.  
**Worst scenario:** Auction psychology (0.0) — synthesis crash before answer render.

---

## Full scenario transcripts

### Scenario 1 — Listing advice

**Prompt:**

```text
I'm selling records from my catalog. Which listings look weakest right now and what should I change first? Consider price, title clarity, revision history, and buyer interest. Do not invent data.
```

**Rendered UI answer:**

```text
Recent listing revision signals: 1. Revision: Listed from record 1781388860548 — Listing revision for Listed from record 1781388860548 Editor: 2ed75568-7deb-4c29 2. Related listings: 3 listing excerpt(s) 3. Offer impact: no offer summaries linked in this set Recommended next step: Confirm offer amounts still match revised listing price/terms. Grounding: based on 8 excerpt(s) from listing, listing_revision, record. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `listing_revision:7b2fb0c0…`
- Excerpt: Listing revision for Listed from record 1781388860548 — Editor, Title, Description: Contract listing with full shipping.
- Source type/ref: `listing:66a83502…`
- Excerpt: Seller listing — Status active, fixed_price, Price 45.99 USD.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: listing_revision_changes
- UI ms: 2,065
- API ms: 1,609
- answer chars: 455
- refs count: 7
- source types: listing_revision, listing, record
- leakage: PASS

**Evaluator judgment:**

- Score: 4.0
- Usefulness: high
- Grounding: partial
- Domain depth: strong
- Actionability: strong
- Overclaiming: none
- Safety: pass
- What worked: Revision history cited; buyer-interest gap explicitly stated; concrete next step.
- What failed: Did not rank “weakest” listings explicitly; leaned on revision template not listing-quality rubric.
- Product implication: Acceptable for keyword path; structured `listing_advice` endpoint would rank weak listings directly.

---

### Scenario 2 — Negotiation price advice

**Prompt:**

```text
For my active OBO listings, how should I respond to current offers? Summarize the offer amounts, countered or pending status, and suggest seller actions without exposing private messages.
```

**Rendered UI answer:**

```text
Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries. Private message bodies were not ingested or included in this answer. Recommended next step: Query offer activity for listings with active OBO threads. Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `listing:a1ffc604…`
- Excerpt: Listing descriptions including OBO lean listings at 45.99 USD — no offer summaries retrieved for this intent routing.
- Source type/ref: `listing:97eca3e6…`
- Excerpt: E2E Lean Listing OBO, active, 45.99 USD.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: private_negotiation_no_messages
- UI ms: 3,322
- API ms: 3,233
- answer chars: 335
- refs count: 8
- source types: listing
- leakage: PASS

**Evaluator judgment:**

- Score: 4.0
- Usefulness: high
- Grounding: partial
- Domain depth: strong
- Actionability: strong
- Overclaiming: none
- Safety: pass
- What worked: Correctly refused to invent offer amounts; message-body exclusion stated; safe fallback action.
- What failed: Keyword retrieval missed `obo_offer_summary` chunks despite OBO-focused prompt — intent routing gap.
- Product implication: Needs structured `negotiation_strategy` endpoint with guaranteed offer-summary retrieval.

---

### Scenario 3 — Buyer psychology / negotiation posture

**Prompt:**

```text
Based only on offer summaries and listing context, what can I infer about buyer negotiation posture? Are buyers testing the floor, responding to counters, or showing serious intent? Be conservative and cite evidence.
```

**Rendered UI answer:**

```text
Private negotiation context (offer summaries only — message bodies excluded): 1. Offer status: 4 pending, 3 countered 2. Top offer lines: countered $4136 on bf1360a1…; pending $4436 on bf1360a1…; pending $4419 on cffbddc8… 3. Listings referenced: 1 listing excerpt(s) in set Private message bodies were not ingested or included in this answer. Recommended next step: Review countered/pending offers in your offers inbox. Grounding: based on 8 excerpt(s) from listing, obo_offer_summary. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `obo_offer_summary:778962dc…`
- Excerpt: Status countered, Amount 4136 USD, Attempt 1.
- Source type/ref: `obo_offer_summary:9444bacb…`
- Excerpt: Status pending, Amount 4436 USD, counter-chain parent present.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: private_negotiation_no_messages
- UI ms: 3,543
- API ms: 3,476
- answer chars: 524
- refs count: 8
- source types: listing, obo_offer_summary
- leakage: PASS

**Evaluator judgment:**

- Score: 3.0
- Usefulness: medium
- Grounding: partial
- Domain depth: medium
- Actionability: medium
- Overclaiming: none
- Safety: pass
- What worked: Amounts and pending/countered counts grounded; message-body exclusion; no psychology overclaim.
- What failed: Did not infer posture (testing floor vs serious intent) — stayed at offer summary level.
- Product implication: Safe but shallow; psychology language needs explicit conservative inference layer.

---

### Scenario 4 — Auction psychology / bidding pressure

**Prompt:**

```text
What auction or bidding signals should I watch right now? Look for bid activity, urgency, risk, and whether I should adjust listing strategy. If there is not enough auction evidence, say so.
```

**Rendered UI answer:**

```text
API POST /api/ai/rag/query → 500:
```

**Evidence used:**

- None — synthesis crashed before response envelope.

**Telemetry:**

- HTTP: 500
- retrieval_mode: unknown
- model_used: unknown
- synthesis template: null
- UI ms: 2,062
- API ms: 1,991
- answer chars: 33
- refs count: 0
- source types: (none)
- leakage: PASS

**Root cause (python-ai logs):** `auction_risk_signals()` receives string metadata from `auction_bid_summary` chunks; `meta.get("bid_count")` raises `AttributeError`.

**Evaluator judgment:**

- Score: 0.0
- Usefulness: low
- Grounding: none
- Domain depth: shallow
- Actionability: weak
- Overclaiming: none
- Safety: pass
- What worked: N/A — no answer.
- What failed: Production crash on auction-intent prompts that retrieve bid summaries.
- Product implication: **Blocker** — fix metadata coercion in `auction_risk_signals` and add structured `auction_pressure` endpoint.

---

### Scenario 5 — Pricing strategy

**Prompt:**

```text
Give me a pricing strategy for records I'm selling. Use listing prices, offer summaries, revision context, and any valuation signals. What should I raise, hold, or review?
```

**Rendered UI answer:**

```text
No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only. 1. Offer activity found instead: pending $4436 on bf1360a1…; countered $4136 on bf1360a1… 2. Revision changes: not available in retrieved excerpts — open listing revisions directly for field-level history. Recommended next step: Confirm offer amounts still match current listing price/terms. Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `obo_offer_summary:9444bacb…`
- Excerpt: pending $4436 USD.
- Source type/ref: `obo_offer_summary:778962dc…`
- Excerpt: countered $4136 USD.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: listing_revision_changes
- UI ms: 3,785
- API ms: 3,699
- answer chars: 496
- refs count: 8
- source types: obo_offer_summary
- leakage: PASS

**Evaluator judgment:**

- Score: 3.5
- Usefulness: medium
- Grounding: partial
- Domain depth: medium
- Actionability: strong
- Overclaiming: none
- Safety: pass
- What worked: Offer amounts cited; revision gap caveated; next step given.
- What failed: No explicit raise/hold/review recommendations — template mismatch for pricing strategy intent.
- Product implication: Structured pricing endpoint needed for raise/hold/review taxonomy.

---

### Scenario 6 — Collector-facing listing quality

**Prompt:**

```text
Which listing details would matter most to a serious vinyl collector here — pressing, condition, title, price, scarcity, or seller notes? Tell me what is present and what is missing from retrieved records.
```

**Rendered UI answer:**

```text
Here are the main seller signals from your grounded records: 1. Offer activity: none in this retrieval set 2. Notifications: none in this retrieval set Recommended next step: Respond to countered/pending offers before expiry. Grounding: based on 8 excerpt(s) from listing, listing_revision. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `listing:afc89b89…`
- Excerpt: **Blue Note stereo pressing** — quiet vinyl, plays clean (present in API excerpt, absent from UI answer).
- Source type/ref: `listing_revision:53379657…`
- Excerpt: Revision with pressing/condition paragraphs.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: seller_notifications
- UI ms: 3,137
- API ms: 3,027
- answer chars: 328
- refs count: 6
- source types: listing, listing_revision
- leakage: PASS

**Evaluator judgment:**

- Score: 2.0
- Usefulness: low
- Grounding: partial
- Domain depth: shallow
- Actionability: medium
- Overclaiming: none
- Safety: pass
- What worked: Retrieved listings include collector-relevant text in excerpts.
- What failed: Wrong template (`seller_notifications`); answer ignores pressing/condition/scarcity question entirely; contradictory “no offers” + “respond to offers”.
- Product implication: Needs collector metadata extraction and dedicated listing-quality synthesis.

---

### Scenario 7 — Daily seller action plan

**Prompt:**

```text
Create a prioritized seller action plan for today from my grounded marketplace data: offers to answer, listings to revise, auctions to watch, and records needing better metadata.
```

**Rendered UI answer:**

```text
Grounded records summary across 8 excerpt(s): listing=8. Review attached source excerpts for listing, offer, and revision details. Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.
```

**Evidence used:**

- Source type/ref: `listing:19b54e53…`
- Excerpt: Kenny Dorham — Quiet Kenny [SOLD], 41.00 USD.
- Source type/ref: `listing:cf97da67…`
- Excerpt: Duplicate sold listing excerpts — no offer/auction/metadata grouping.

**Telemetry:**

- HTTP: 200
- retrieval_mode: keyword
- model_used: rule-engine
- synthesis template: generic_grounded
- UI ms: 2,996
- API ms: 2,887
- answer chars: 215
- refs count: 8
- source types: listing
- leakage: PASS

**Evaluator judgment:**

- Score: 2.0
- Usefulness: low
- Grounding: partial
- Domain depth: shallow
- Actionability: medium
- Overclaiming: none
- Safety: pass
- What worked: Grounded source count honest; no hallucination.
- What failed: No prioritized plan; no grouping by offers/listings/auctions/metadata; generic fallback template.
- Product implication: Needs `seller_attention_today`-style structured endpoint with ranked action buckets.

---

## Domain findings

| # | Question | Verdict |
|---|----------|---------|
| 1 | Can the AI give listing advice? | **Partial yes** — revision/listing evidence with next step, but weak-listlisting ranking missing. |
| 2 | Can it give negotiation price advice? | **Partial** — safe when offer summaries missing, but retrieval often misses OBO offers for OBO-focused prompts. |
| 3 | Can it discuss buyer psychology safely? | **Yes, shallow** — amounts/status grounded; no overclaim; no posture inference. |
| 4 | Can it discuss auction psychology safely? | **No — blocked** — HTTP 500 crash on auction-intent prompts. |
| 5 | Can it give collector-specific listing quality advice? | **No** — wrong template; ignores pressing/condition despite excerpts containing them. |
| 6 | Does it know when evidence is missing? | **Yes** — consistently caveats missing revisions, offers, auction data (when not crashing). |
| 7 | Does it provide useful seller actions? | **Mixed** — 6/7 include a next-step phrase; only 2–3 are domain-specific enough to act on. |

---

## Failure/gap list

### Retrieval gaps

- OBO negotiation prompt retrieved **listing-only** chunks (no `obo_offer_summary`) while buyer-psychology prompt retrieved offers — **inconsistent intent routing**.
- Pricing strategy missed `listing_revision` despite explicit ask.
- Daily action plan retrieved duplicate sold listings, no offers/auctions/notifications.

### UI evidence gaps

- UI shows truncated `source_type:source_id` refs only — collector metadata visible in API excerpts but not surfaced in answer text.
- HTTP 500 renders error string, not structured degradation.

### Synthesis gaps

- Intent misclassification: collector quality → `seller_notifications`; daily plan → `generic_grounded`.
- No raise/hold/review taxonomy for pricing.
- No conservative buyer-posture inference language.
- **Crash:** `auction_risk_signals` string metadata bug on `auction_bid_summary`.

### Domain-depth gaps

- Listing advice lacks weak-listing ranking.
- Negotiation advice cannot summarize amounts when retrieval misses offers.
- Action plans are generic “review excerpts” not prioritized seller workflows.

### Latency gaps

- UI p50 **3,137 ms**, p95 **3,785 ms** — within T20.13P band, not a blocker.
- API p50 **3,027 ms**, p95 **3,699 ms**.

---

## Final decision

```text
Production UI record intelligence: PARTIAL
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Rationale:** Browser flow works for 6/7 domain scenarios with keyword/rule-engine and zero leakage. One production crash (auction), average domain score below target (2.93 < 3.5), and three scenarios score ≤2 for shallow/generic synthesis. Safe enough to continue Phase 20 hardening; **not** accepted for seller-facing record-intelligence product claims.

**Recommendation:**

Add structured endpoints for **`listing_advice`**, **`negotiation_strategy`**, and **`auction_pressure`** before Phase 21. Fix `auction_risk_signals` metadata coercion as a prerequisite. Add collector metadata extraction for listing-quality scenarios. Keep vector rollout blocked.

---

## Run metadata

| Field | Value |
|-------|-------|
| Login user | e2e-contract@record-platform.local |
| Route | `/insights` → RAG card |
| Browser | chromium 1280×720 |
| Cases hard-pass | 6/7 |
| Avg answer chars | 341 |
| Leakage | PASS |
| Old boilerplate | absent |
| Scenarios with next action | 6/7 |
| Major overclaiming | 0 |
