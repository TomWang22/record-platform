# T20.13J — Keyword synthesis quality eval

**Status:** Post-implementation evaluator report  
**Generated:** 2026-06-26  
**Implementation SHA:** `8698db3`  
**Live inference run:** `20260626-213134`  
**Artifacts (local):** `bench_logs/ai-platform/live-inference/raw-20260626-213134/`

---

## Score summary

| Area | Before (T20.13G-S) | After (T20.13J) | Target |
|------|-------------------:|----------------:|-------:|
| RAG keyword avg | **2.6/5** | **3.6/5** | ≥ 3.5/5 **MET** |
| Structured endpoints avg | 3.4/5 | **3.4/5** | unchanged (expected) |
| Safety/leakage | PASS | **PASS** | pass |
| `model_used` | rule-engine | **rule-engine** | unchanged |
| `retrieval_mode` | keyword | **keyword** | unchanged |

---

## Per-prompt results

| case | old | new | template | excerpt of actual answer |
|------|----:|----:|----------|--------------------------|
| catalog_activity | 3 | **3.5** | catalog_activity | Your catalog shows 6 listing excerpt(s) and 2 revision excerpt(s)… Active listing activity… |
| seller_notifications | 3 | **3.5** | seller_notifications | Here are the main seller signals… 8 offer summary excerpt(s) — countered $4136… |
| offer_bidding_activity | 3 | **3.5** | offer_bidding_activity | Offers: 4 pending, 4 countered… Amounts seen: $4085–$4436 USD |
| listing_revision_changes | 2 | **3.5** | listing_revision_changes | **No listing_revision excerpts were retrieved**… Offer activity found instead… |
| private_negotiation_no_messages | 2 | **3.5** | private_negotiation_no_messages | **Private message bodies were not ingested or included**… listing-only caveat |
| seller_attention_today | 2 | **4.0** | seller_attention_today | Top seller actions… 1. Refresh active listing… (ranked list) |
| marketplace_activity_summary | 3 | **3.5** | marketplace_activity_summary | Offers: 8 excerpt(s) — 4 pending, 4 countered… Recommended next step… |

**Key improvement:** No keyword case returned the shallow boilerplate *"Retrieved 8 grounded excerpts for your question."* All summaries use deterministic templates with grounding footers.

---

## Actual answer excerpts (keyword)

### catalog_activity

```text
Your catalog shows 6 listing excerpt(s) and 2 revision excerpt(s) in grounded records.

1. Active listing activity: listing — unknown, $45.99; E2E Lean Listing … — active, $45.99
2. Buyer/offer interest: no offer summaries in this retrieval set
3. Revisions or price changes: E2E Lean Listing … — Listing revision for …

Grounding: based on 8 excerpt(s) from listing, listing_revision. Private message bodies were not used.
```

### seller_notifications

```text
Here are the main seller signals from your grounded records:

1. Offer activity: 8 offer summary excerpt(s) — e.g. countered $4136 on bf1360a1…
2. Notifications: none in this retrieval set

Recommended next step: Respond to countered/pending offers before expiry.
```

### listing_revision_changes (caveat path)

```text
No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only.

1. Offer activity found instead: countered $4136…; pending $4436…
2. Revision changes: not available in retrieved excerpts — open listing revisions directly…
```

### private_negotiation_no_messages

```text
Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries.

Private message bodies were not ingested or included in this answer.
```

---

## Structured endpoints (unchanged)

| endpoint | HTTP | model | excerpt | score |
|----------|-----:|-------|---------|------:|
| seller_sales_summary | 200 | rule-engine | Seller activity across 10 grounded sources. | 3 |
| pricing_recommendation | 200 | rule-engine | Suggested price near $55.0 based on listing, revisions, and offer/auction summaries. | 4 |
| record_valuation | 200 | rule-engine | Record located; insufficient comparable pricing in corpus. | 3 |
| auction_risk | 200 | rule-engine | 2 auction risk signal(s) from bid summaries. | 4 |
| buyer_collection_summary | 404 | — | pre-existing route gap | 0 |

Structured endpoint avg (4 live): **3.4/5** — synthesis change did not affect typed endpoints (expected).

---

## Telemetry

| Metric | Value |
|--------|------:|
| keyword latency p50 / p95 | 1,655 / 2,687 ms |
| shadow off p50 / p95 | 6,163 / 8,093 ms |
| shadow flagged p50 / p95 | 5,803 / 10,618 ms |
| candidate_fetch p95 (off / flagged) | 4,233 / 6,522 ms |
| embed timeout count (keyword) | **0** |
| embed timeout count (shadow flagged) | **1** (diagnostic only) |
| request errors | **0** |
| true zero-results | **0** |
| overlap off / flagged | 1/7 / 3/7 chunk >0 |
| leakage | **PASS** |
| `details.synthesis.template` | populated on all 7 keyword cases |

---

## Regressions / gaps

| Item | Severity | Notes |
|------|----------|-------|
| `seller_attention_today` ranked listing refresh only | low | Retrieval returned listing-only refs; template works but OBO-ranked actions would score higher if OBO chunks retrieved |
| `catalog_activity` listing title parse | low | Some titles show as "listing — unknown" when excerpt format differs; parser refinement optional in follow-up |
| Shadow flagged 1 embed timeout | diagnostic | Does not affect production keyword path |
| Vector latency p95 still >3s | rollout blocker | unchanged — synthesis does not address shadow latency |

No leakage, no API envelope breakage, no retrieval_mode regression.

---

## Target assessment

| Gate | Result |
|------|--------|
| RAG avg ≥ 3.5/5 | **PASS** (3.6/5) |
| listing_revision caveat | **PASS** |
| private negotiation message-body exclusion | **PASS** |
| seller_attention ranked actions | **PASS** (structure; content limited by refs) |
| Vector rollout | **NOT APPROVED** (latency/overlap unchanged) |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

**Interpretation:** T20.13I synthesis materially improves user-visible RAG answers without vector rollout. Next useful work remains shadow latency/overlap (T20.13H-B track) and optional parser polish for listing titles / seller_attention when OBO refs are present — not production vector default.
