# T20.13H — Keyword answer synthesis proposal

**Status:** Design / doc only — no implementation  
**Generated:** 2026-06-26  
**Baseline SHA:** `4658022`  
**Predecessor:** [T20.13G-S real use-case answer quality report](./T20-13G-S-real-use-case-answer-quality-report.md)

---

## Problem

T20.13G-S established product-level truth on the warmed inference run (`raw-20260626-190817`):

| Finding | Evidence |
|---------|----------|
| Generic RAG average | **2.6/5** |
| All 7 RAG prompts | Safe, grounded, **shallow** |
| Dominant answer text | *"Retrieved 8 grounded excerpts for your question."* |
| Structured endpoints average | **3.4/5** — pricing, auction risk synthesize evidence |
| Shadow vector | Does not change user-visible `summary`; adds latency |

**Root cause in code:** `rag_query()` in `insights.py` sets:

```python
summary = f"Retrieved {len(chunks)} grounded excerpts for your question."
```

Structured endpoints (`listing_pricing_advice`, `auction_risk`, `record_valuation`) already use deterministic rule-engine helpers in `providers/rule_engine.py` (`pricing_band_from_chunks`, `auction_risk_signals`, `listing_quality_checklist`) to produce actionable summaries. Generic RAG does not.

**What works today:**

- Keyword retrieval returns owner-scoped, useful excerpts (listings, OBO summaries, revisions).
- Privacy filters hold — no message bodies.
- `source_refs`, `details.excerpts`, and envelope shape are stable.

**What fails product intent:**

- The `summary` field does not answer the user's question.
- `listing_revision_changes` retrieved OBO-only refs while the question asked for revisions (score 2/5).
- `private_negotiation_no_messages` returned listing inventory, not negotiation context.
- `seller_attention_today` returned no ranked actions.

The **data pipeline works**. The **answer layer** does not.

---

## Goal

Improve the production **keyword / rule-engine** answer layer so RAG responses read like structured endpoints — specific, grounded, seller/buyer-facing — while preserving:

| Constraint | Must remain |
|------------|-------------|
| Retrieval mode | **keyword** (default) |
| Model | **rule-engine** (`model_used=rule-engine`) |
| Vector default | **off** — no shadow/vector in production path |
| Generative Ollama | **not** used for production `summary` |
| API response shape | Same envelope: `summary`, `details`, `source_refs`, `citations`, `confidence` |
| Privacy | No message bodies; existing opt-in / forbidden filters |
| Leakage guarantees | Existing contract audit rules |

No API contract breaking changes. No new required fields. Optional additive fields inside `details` (e.g. `synthesis_template`, `synthesis_caveats`) are acceptable if documented.

---

## Architecture (T20.13I target)

```text
POST /api/ai/rag/query
        │
        ▼
  retrieve_chunks (keyword)     ← unchanged
        │
        ▼
  classify_rag_intent(question) ← new: deterministic keyword/heuristic
        │
        ▼
  synthesize_rag_summary(       ← new: template + chunk parsers
    intent, chunks, refs, question
  )
        │
        ▼
  build_envelope (summary = synthesized text)  ← insights.rag_query only
```

**Intent classification** (no API change): map normalized question text to one of seven templates using the same phrases as the live-inference harness / contract prompts. Fallback: `generic_grounded` (improved boilerplate with source-type counts, not raw "Retrieved N excerpts").

**Reuse:** extend `providers/rule_engine.py` or add `providers/rag_synthesis.py` with chunk parsers shared by structured endpoints where possible (price regex, OBO status lines, revision markers).

---

## Proposed rule-engine synthesis templates

Each template consumes **only** retrieved `chunks` and `source_refs`. No inference beyond parsed fields present in chunk `content` and ref `source_type`.

### 1. `catalog_activity`

**Trigger:** question mentions catalog, listing activity, buyer interest.

**Parse from chunks:**

- Count distinct listings (by `source_id` where `source_type=listing`).
- Count revisions (`listing_revision`).
- Extract up to 3 listing titles, statuses (`active`/`sold`), prices (`Price: X USD`).
- Note if multiple fixed_price vs auction types appear.

**Target summary shape:**

```text
Your catalog shows {N} active listing(s) and {R} recent revision(s) in grounded records.

1. Active listing activity: {title A} — {status}, ${price}; {title B} — …
2. Buyer/offer interest: {pending/countered OBO count if obo_offer_summary refs present, else "no offer summaries in this retrieval set"}
3. Revisions or price changes: {revision one-liner or "none in retrieved excerpts"}

Recommended next step: Review listings with pending offer summaries or recent revisions.

Grounding: based on {chunk_count} excerpts from {source_types}. Private message bodies were not used.
```

---

### 2. `seller_notifications`

**Trigger:** notifications, selling activity, what matters right now.

**Parse:**

- Filter `obo_offer_summary` and `notification` chunks.
- Per offer: status (`pending`, `countered`, `accepted`), amount (`Amount: N USD`), expiry if present.
- Sort by urgency: countered > pending > other; cap at 3 lines.

**Target summary shape:**

```text
Here are the main seller signals from your grounded records:

1. Offer activity: {N} offer summary excerpt(s) — e.g. pending ${X}, countered ${Y} on listing …
2. Notifications: {M} notification excerpt(s) or "none in this retrieval set"
3. Recommended next step: Respond to countered/pending offers before expiry.

Grounding: based on {chunk_count} excerpts from {source_types}. Private message bodies were not used.
```

---

### 3. `offer_bidding_activity`

**Trigger:** bidding, offer activity, recent listings.

**Parse:**

- Group OBO summaries by listing id (from content or metadata).
- Status counts: pending / countered / accepted.
- Include `auction_bid_summary` bid counts if present (`auction_risk_signals` helper).

**Target summary shape:**

```text
Offer and bidding activity from your retrieved records:

1. Offers: {pending_count} pending, {countered_count} countered across {listing_count} listing(s)
2. Amounts seen: ${low}–${high} USD (from grounded excerpts only)
3. Auction/bid signals: {signal summary or "none in this set"}

Recommended next step: Prioritize countered offers and listings with expiring pending amounts.

Grounding: based on {chunk_count} excerpts from {source_types}. Private message bodies were not used.
```

---

### 4. `listing_revision_changes`

**Trigger:** listing revision, what changed, may affect offers.

**Parse:**

- **Prefer** `listing_revision` chunks: editor, title, revision timestamp if in content.
- If **zero** revision chunks but OBO/listing present → explicit caveat (T20.13G-S failure mode).

**Target summary shape (revision chunks found):**

```text
Recent listing revision signals:

1. Revision: {title} — {field change snippet from excerpt}
2. Related listings: {N} listing excerpt(s)
3. Offer impact: {OBO status lines if obo_offer_summary refs exist, else "no offer summaries linked in this set"}

Recommended next step: Confirm offer amounts still match revised listing price/terms.

Grounding: based on {chunk_count} excerpts ({revision_count} revision, {other types}). Private message bodies were not used.
```

**Target summary shape (no revision chunks — caveat required):**

```text
No listing_revision excerpts were retrieved for this question; grounded records contain offer summaries only.

1. Offer activity found instead: {top 2 OBO status/amount lines}
2. Revision changes: not available in retrieved excerpts — try a listing-specific query or revision panel

Recommended next step: Open listing revisions directly; this answer used {source_types} only.

Grounding: based on {chunk_count} excerpts. Private message bodies were not used.
```

This directly fixes the T20.13G-S score-2 case.

---

### 5. `private_negotiation_no_messages`

**Trigger:** private negotiation, without message bodies, seller-side context.

**Parse:**

- **Only** `obo_offer_summary` (status, amount, attempt, floor/counter chain markers in content).
- Exclude `message` source types (already filtered at ingestion).
- Do **not** treat generic `listing` inventory as negotiation context unless no OBO refs.

**Target summary shape:**

```text
Private negotiation context (offer summaries only — message bodies excluded):

1. Offer status: {pending/countered counts and top 2 amount lines}
2. Counter-chain signals: {parent/attempt markers if present in excerpts}
3. Listings referenced: {N} listing id(s) from offer summaries

Private message bodies were not ingested or included in this answer.

Recommended next step: Review countered/pending offers in your offers inbox.

Grounding: based on {chunk_count} excerpts from {source_types}.
```

If only `listing` chunks retrieved (T20.13G-S case):

```text
Negotiation context limited: retrieved excerpts are listing descriptions only, not offer summaries.

Private message bodies were not ingested or included.

Recommended next step: Query offer activity for listings with active OBO threads.

Grounding: based on {chunk_count} excerpts from listing records only.
```

---

### 6. `seller_attention_today`

**Trigger:** pay attention, seller today, what should I.

**Parse:**

- Build ranked action list (max 3) from refs:
  1. Countered OBO (highest priority)
  2. Pending OBO with expiry
  3. `auction_bid_summary` ending_soon signal
  4. `listing_revision` in last N excerpts
  5. Stale active listing (no offers, from listing content)

**Target summary shape:**

```text
Top seller actions from grounded records today:

1. {Action 1 — e.g. "Respond to countered offer $4136 on listing …"}
2. {Action 2 — e.g. "Review pending offer $4436 expiring …"}
3. {Action 3 — e.g. "Check revision on …" or "Refresh listing …"}

Grounding: based on {chunk_count} excerpts from {source_types}. Private message bodies were not used.
```

---

### 7. `marketplace_activity_summary`

**Trigger:** marketplace activity, recent activity relevant.

**Parse:**

- Aggregate counts by `source_type` across refs: listing, listing_revision, obo_offer_summary, notification, auction_bid_summary.
- One line per type with highest-signal parsed fact (not raw dump).

**Target summary shape:**

```text
Recent marketplace activity relevant to you (seller-scoped):

1. Listings: {N} excerpt(s) — {one active title/price}
2. Offers: {OBO counts and status mix}
3. Revisions/notifications/auctions: {per-type one-liner or "none in set"}

Recommended next step: {single highest-priority action from ranked rules}

Grounding: based on {chunk_count} excerpts from {source_types}. Private message bodies were not used.
```

---

## Output shape

**Preserve existing fields.** Only replace `summary` string and optionally enrich `details`:

```json
{
  "summary": "<multi-line synthesized text>",
  "model_used": "rule-engine",
  "source_refs": [ "... unchanged ..." ],
  "details": {
    "retrieval_mode": "keyword",
    "chunk_count": 8,
    "excerpts": [ "... unchanged ..." ],
    "synthesis": {
      "template": "seller_notifications",
      "intent_confidence": "high",
      "caveats": [],
      "parsed_signals": { "pending_offers": 2, "countered_offers": 1 }
    }
  }
}
```

`details.synthesis` is **additive** — clients that ignore it keep working.

**Example target answer** (seller_notifications):

```text
Here are the main seller signals from your grounded records:

1. Offer activity: 3 offer summaries — pending $4436, countered $4136, pending $4419 on active listings
2. Notifications: none in this retrieval set
3. Recommended next step: Respond to countered offers before expiry

Grounding: based on 8 excerpts from obo_offer_summary. Private message bodies were not used.
```

---

## Safety rules

| Rule | Implementation |
|------|----------------|
| Never include message bodies | Continue ingestion opt-in; synthesis reads only allowed source types |
| Never infer beyond refs | Every dollar amount, status, title must match a regex parse of chunk `content` or ref metadata |
| Weak/mismatched refs | Emit caveat block (revision template, negotiation template) |
| Amounts/statuses | Only when parsed from excerpt text |
| Leakage filters | Unchanged; run existing contract audit + quality smoke |
| Source refs attached | Unchanged list from `retrieve_chunks` |
| No LLM prose | `RuleEngineProvider.explain` stays structured-only; synthesis is template + regex |
| Generative Ollama | Remains optional `details.explanation` only when provider is ollama — **not** default production path |

---

## Expected quality lift

| Metric | Current (T20.13G-S) | Target (post T20.13I + rubric rerun) |
|--------|--------------------:|---------------------------------------:|
| RAG keyword avg score | 2.6/5 | **≥ 3.5/5** |
| `listing_revision_changes` | 2/5 (misleading OBO-only) | **≥ 3/5** with explicit caveat or revision lines |
| `private_negotiation_no_messages` | 2/5 | **≥ 3/5** with message-body exclusion stated |
| `seller_attention_today` | 2/5 | **≥ 3.5/5** with ranked actions |
| Safety/leakage | pass | pass |
| Structured endpoints | unchanged | unchanged (optional later: apply same synthesis to `seller_sales_summary`) |

Scores measured by rerunning the T20.13G-S rubric against live inference raw JSON — not by changing the rubric.

---

## Implementation scope for future T20.13I

### Allowed future files

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/insights.py` | Call synthesis after `retrieve_chunks` in `rag_query()` |
| `services/python-ai-service/app/ai/providers/rag_synthesis.py` | **New** — intent map, templates, chunk parsers |
| `services/python-ai-service/app/ai/providers/rule_engine.py` | Shared parsers (OBO status, price, revision lines) |
| `services/python-ai-service/tests/test_rag_synthesis.py` | **New** — unit tests per template + caveat paths |
| `services/python-ai-service/tests/test_rag_retrieval.py` | No retrieval behavior changes; optional integration assert on summary shape |
| `docs/ai-platform/T20-13I-*.md` | Eval report after implementation |

### Not allowed in T20.13I

- Retrieval ranking / source-type weight changes in `rag_retrieval.py`
- Vector default on; shadow path changes for production
- API contract breaking changes (required fields, route removal)
- Generative model as default for `summary`
- Message ingestion or body fields
- Phase 21, T20.14/T20.15 rollout, index creation, embedding tranches

### Suggested T20.13I sequence

1. Add parsers + unit tests (pure functions, fixture chunks from T20.13G-S excerpts).
2. Wire `rag_query()` summary replacement only.
3. Rerun validation bundle (below).
4. T20.13G-S-style evaluator doc with before/after scores.

---

## Validation plan

Future T20.13I implementation must run:

| Gate | Script / artifact |
|------|-------------------|
| RAG contract | `bash scripts/audit-rp-ai-rag-contract.sh` |
| Quality smoke | `bash scripts/rp-ai-rag-quality-smoke.sh` |
| Endpoints contract | existing endpoint tests / smoke |
| Live inference | `bash scripts/rp-ai-live-inference-transcript.sh --embed-warmup-runs 3 …` |
| Evaluator rubric | Manual or scripted rerun of T20.13G-S scoring on new raw JSON |
| RP scan | `bash scripts/rp-rp-decontaminate-scan.sh` |
| Unit tests | `pytest services/python-ai-service/tests/test_rag_synthesis.py` |

**Pass criteria:**

- All audits PASS; leakage PASS.
- RAG keyword avg ≥ 3.5/5 on same 7 prompts.
- No regression in `source_refs` count/types vs T20.13G-S baseline (retrieval unchanged).
- `model_used` remains `rule-engine`; `retrieval_mode` remains `keyword`.

---

## Non-goals (explicit)

- Vector rollout or overlap flag default-on
- Shadow-only generative answer experiments (separate ticket if ever needed)
- Fixing `buyer_collection_summary` 404 (pre-existing route gap)
- Replacing structured endpoints — they remain the gold standard for typed insights

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

**Recommended next ticket:** T20.13I — implement keyword/rule-engine synthesis templates (this proposal).
