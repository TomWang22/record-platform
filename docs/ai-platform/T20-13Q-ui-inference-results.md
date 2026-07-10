# T20.13Q — UI inference results

**Status:** Playwright UI acceptance results (read-only report)
**Generated:** 2026-06-27
**Baseline SHA:** `6423e6c`
**Run artifact:** `bench_logs/ai-platform/ui-inference/20260627-031631/`

## Executive result

```text
UI AI/RAG inference: PASS
Production keyword retrieval: PASS
Keyword synthesis visible in UI: PASS
Vector rollout: NOT APPROVED
Phase 21: not started
```

## Browser/session metadata

- base URL: https://record-platform.test
- browser: chromium
- viewport: 1280×720
- user: `e2e-contract@record-platform.local`
- run timestamp: `20260627-031631`
- command: `./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-inference.spec.ts --grep "AI RAG inference UI acceptance"`
- local artifacts:
  - `bench_logs/ai-platform/ui-inference/20260627-031631/20260627-031631.json`
  - `bench_logs/ai-platform/ui-inference/20260627-031631/20260627-031631.md`
  - `bench_logs/ai-platform/ui-inference/20260627-031631/raw-20260627-031631/`

## UI route

`/insights` — **AI Insights** dashboard, RAG query card (`data-testid=ai-insight-rag`).

Source evidence in UI: **yes** — `ai-source-ref-item` list shows `source_type:source_id` refs (not full excerpt text).

## Prompt transcript table

| Case | Prompt | UI answer chars | UI ms | API ms | model | retrieval | refs | source types | quality | leakage |
|------|--------|----------------:|------:|-------:|-------|-----------|-----:|--------------|--------:|---------|
| 1 catalog_activity | Summarize listing activity and buyer interest for … | 734 | 2398 | 1985 | rule-engine | keyword | 7 | listing_revision, listing | 3.5/5 | PASS |
| 2 seller_notifications | What notifications matter most for my selling acti… | 386 | 4057 | 3925 | rule-engine | keyword | 8 | obo_offer_summary | 3.5/5 | PASS |
| 3 offer_bidding_activity | Show a concise summary of bidding and offer activi… | 413 | 7187 | 7017 | rule-engine | keyword | 8 | obo_offer_summary | 3.5/5 | PASS |
| 4 listing_revision_changes | What changed recently on listing revisions that ma… | 496 | 7776 | 5313 | rule-engine | keyword | 8 | obo_offer_summary | 3.5/5 | PASS |
| 5 private_negotiation_no_messages | Summarize my private seller-side negotiation conte… | 335 | 2230 | 2024 | rule-engine | keyword | 8 | listing | 3.5/5 | PASS |
| 6 seller_attention_today | What should I pay attention to as a seller today? | 312 | 1386 | 1285 | rule-engine | keyword | 8 | listing | 4/5 | PASS |
| 7 marketplace_activity_summary | Give me a grounded summary of recent marketplace a… | 345 | 1550 | 1463 | rule-engine | keyword | 8 | obo_offer_summary | 3.5/5 | PASS |

## Aggregate timing

- UI p50/p95: **2398 / 7776 ms**
- API p50/p95: **2024 / 7017 ms**
- answer chars min/avg/max: **312 / 432 / 734**
- slowest case: **listing_revision_changes** (7776 ms UI)
- fastest case: **seller_attention_today** (1386 ms UI)
- avg quality: **3.6/5**

## Regression checks

- old boilerplate answer appeared? **no**
- missing refs? **no** (7/7 refs > 0)
- leakage? **PASS**
- UI route missing? **no** (`/insights` RAG card present)
- endpoint 404 in this run? **no** (RAG only; structured panels loaded separately)

## Full prompt transcript

### Case 1 — catalog_activity

Prompt:
Summarize listing activity and buyer interest for my catalog.

Rendered UI answer:
Your catalog shows 6 listing excerpt(s) and 2 revision excerpt(s) in grounded records. 1. Active listing activity: listing — unknown, $45.99; E2E Lean Listing 1781388696658 — active, $45.99; listing — unknown, $45.99 2. Buyer/offer interest: no offer summaries in this retrieval set 3. Revisions or price changes: E2E Lean Listing 1781388696658 — Listing revision for E2E Lean Listing 1781388696658 Editor: 2ed75568-7deb-4c29-9; E2E Lean Listing 1781385557571 — Listing revision for E2E Lean Listing 1781385557571 Editor: 2ed75568-7deb-4c29-9 Recommended next step: Review listings with pending offer summaries or recent revisions. Grounding: based on 8 excerpt(s) from listing, listing_revision. Private message bodies were not used.

Visible evidence/sources:
- listing_revision:bd70536d… | listing:6af8cd87… | listing:5677fa9c…
- Response excerpt: Listing revision for E2E Lean Listing 1781388696658
Editor: 2ed75568-7deb-4c29-91b0-6919f24a0c9f
Title: E2E Lean Listing 1781388696658
Description: Lean contract listing for A–D and detail proofs.…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: catalog_activity
- refs: 7
- source types: listing_revision, listing

Timing:
- UI total ms: 2398
- network ms: 1985

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 2 — seller_notifications

Prompt:
What notifications matter most for my selling activity right now?

Rendered UI answer:
Here are the main seller signals from your grounded records: 1. Offer activity: 8 offer summary excerpt(s) — e.g. countered $4136 on bf1360a1…; countered $4119 on cffbddc8… 2. Notifications: none in this retrieval set Recommended next step: Respond to countered/pending offers before expiry. Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

Visible evidence/sources:
- obo_offer_summary:9444bacb… | obo_offer_summary:778962dc… | obo_offer_summary:77f3f2db…
- Response excerpt: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: pending
Amount: 4436 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:38 GMT-0400 (Eastern Daylight Time)
Counter-chain parent: 7789…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: seller_notifications
- refs: 8
- source types: obo_offer_summary

Timing:
- UI total ms: 4057
- network ms: 3925

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 3 — offer_bidding_activity

Prompt:
Show a concise summary of bidding and offer activity tied to my recent listings.

Rendered UI answer:
Offer and bidding activity from your retrieved records: 1. Offers: 4 pending, 4 countered across 4 listing reference(s) 2. Amounts seen: $4085–$4436 USD (from grounded excerpts only) 3. Auction/bid signals: none in this set Recommended next step: Prioritize countered offers and listings with expiring pending amounts. Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

Visible evidence/sources:
- obo_offer_summary:778962dc… | obo_offer_summary:9444bacb… | obo_offer_summary:77f3f2db…
- Response excerpt: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: offer_bidding_activity
- refs: 8
- source types: obo_offer_summary

Timing:
- UI total ms: 7187
- network ms: 7017

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 4 — listing_revision_changes

Prompt:
What changed recently on listing revisions that may affect offers?

Rendered UI answer:
No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only. 1. Offer activity found instead: countered $4136 on bf1360a1…; pending $4436 on bf1360a1… 2. Revision changes: not available in retrieved excerpts — open listing revisions directly for field-level history. Recommended next step: Confirm offer amounts still match current listing price/terms. Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

Visible evidence/sources:
- obo_offer_summary:778962dc… | obo_offer_summary:9444bacb… | obo_offer_summary:3704a4c6…
- Response excerpt: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: listing_revision_changes
- refs: 8
- source types: obo_offer_summary

Timing:
- UI total ms: 7776
- network ms: 5313

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 5 — private_negotiation_no_messages

Prompt:
Summarize my private seller-side negotiation context without exposing message bodies.

Rendered UI answer:
Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries. Private message bodies were not ingested or included in this answer. Recommended next step: Query offer activity for listings with active OBO threads. Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.

Visible evidence/sources:
- listing:d583972e… | listing:f93d17aa… | listing:2e12ce43…
- Response excerpt: Seller listing: Kenny Dorham — Quiet Kenny [SOLD]
Status: active
Type: fixed_price
Price: 41.0000000000000000 USD
Description: Outbox audit patch 1781390023…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: private_negotiation_no_messages
- refs: 8
- source types: listing

Timing:
- UI total ms: 2230
- network ms: 2024

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 6 — seller_attention_today

Prompt:
What should I pay attention to as a seller today?

Rendered UI answer:
Top seller actions from grounded records today: 1. Refresh active listing Kenny Dorham — Quiet Kenny [SOLD] 2. Refresh active listing E2E UI Listing 1781389086102 (revised) 3. Refresh active listing E2E UI Listing 1781389086102 Grounding: based on 8 excerpt(s) from listing. Private message bodies were not used.

Visible evidence/sources:
- listing:d583972e… | listing:f93d17aa… | listing:2e12ce43…
- Response excerpt: Seller listing: Kenny Dorham — Quiet Kenny [SOLD]
Status: active
Type: fixed_price
Price: 41.0000000000000000 USD
Description: Outbox audit patch 1781390023…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: seller_attention_today
- refs: 8
- source types: listing

Timing:
- UI total ms: 1386
- network ms: 1285

Evaluator judgment:
- Score: 4/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

### Case 7 — marketplace_activity_summary

Prompt:
Give me a grounded summary of recent marketplace activity relevant to me.

Rendered UI answer:
Recent marketplace activity relevant to you (seller-scoped): 1. Listings: none in set 2. Offers: 8 excerpt(s) — 4 pending, 4 countered 3. Revisions/notifications/auctions: Recommended next step: Respond to countered offer countered $4136 on bf1360a1… Grounding: based on 8 excerpt(s) from obo_offer_summary. Private message bodies were not used.

Visible evidence/sources:
- obo_offer_summary:778962dc… | obo_offer_summary:9444bacb… | obo_offer_summary:77f3f2db…
- Response excerpt: Offer summary for listing bf1360a1-5b82-4305-9091-d543eeb440bf
Status: countered
Amount: 4136 USD
Attempt: 1
Expires: Wed Jun 24 2026 15:19:37 GMT-0400 (Eastern Daylight Time)…

Network response:
- HTTP: 200
- model_used: rule-engine
- retrieval_mode: keyword
- synthesis template: marketplace_activity_summary
- refs: 8
- source types: obo_offer_summary

Timing:
- UI total ms: 1550
- network ms: 1463

Evaluator judgment:
- Score: 3.5/5
- Useful? partial
- What worked: Synthesized keyword summary visible in DOM; source ref list rendered
- What failed: UI shows ref IDs only, not full excerpt text; slowest prompts >7s UI

---

## Best / worst rendered answers

- **Best:** `seller_attention_today` (4/5) — ranked seller actions
- **Worst:** `catalog_activity` (3.5/5) — still structured, not boilerplate

## Final decision

```text
Production UI keyword RAG: ACCEPTED
Vector rollout: NOT APPROVED
Phase 21: not started
```

**Note:** UI proof confirms T20.13I synthesis renders in browser. Shadow vector rollout remains blocked on latency/overlap (see T20.13O-E2E API acceptance). Fresh edge login required — stale `.contract-auth-cache.json` causes 401 in browser fetches.