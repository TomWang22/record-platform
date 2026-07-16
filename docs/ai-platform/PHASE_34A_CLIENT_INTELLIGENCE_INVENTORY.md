# Phase 34A — Client intelligence inventory & UX contracts

```text
Status: PHASE 34A COMPLETE — PRODUCT ACCEPTANCE NOT READY
HEAD baseline at inventory: 52f56b07c9e713727e57881785d1e39572080911
Target root: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT / NOT LAUNCHED
Production: NOT APPROVED (keyword, PERCENT=0, ALLOW_PROD_PERCENT=0)
Automatic negotiation sending: DISABLED
Fine-tuning / weight updates: NOT STARTED (not claimed)
```

## Purpose

Phase 34 productizes the eight record-market intelligence capabilities into
**real buyer/seller client journeys**. Phase 33F target launcher readiness is
**infrastructure only** and does not authorize the live 17,280-probe target.

Working inventory (not committed):

- `/tmp/phase34-client-intelligence/inventory.json`
- `/tmp/phase34-client-intelligence/gap-matrix.md`

## Verified repository facts

1. Phase 33 intelligence routes exist under `services/python-ai-service/app/ai/routes.py`
   and are reachable as `/api/ai/intelligence/*` via the API gateway.
2. The only productized AI hub is `/insights`
   (`webapp/app/(dashboard)/insights/page.tsx` + `webapp/components/ai/*`).
3. Client calls today use **legacy** endpoints (`/api/ai/records/valuation`,
   `/api/ai/auctions/risk`, `/api/ai/seller/*`, `/api/ai/rag/*`) — **not**
   `/api/ai/intelligence/*`.
4. Pages `/watchlist`, `/messages`, `/offers/*`, `/market`, `/sell`,
   `/listings/[id]`, `/auctions`, collection/profile analytics exist but do not
   consume Phase 33 intelligence.
5. There is no central versioned prompt registry; prompts live in scattered
   `prompts.py` modules. Offline corpora exist under `scripts/ai-platform/`.
6. No Phase 34 docs existed before this file.

## Accepted UX contracts (34A)

These contracts bind Phase 34B+ implementation. They do not claim the UI exists.

### Shared chrome (every capability surface)

Every intelligence panel MUST provide:

- typed request/response against the capability schema;
- loading skeleton;
- timeout / retry control (no automatic HTTP 429 retry loops);
- 4xx / 5xx / rate-limit states;
- abstention / weak-data state;
- evidence expansion;
- confidence + limitations;
- stale/freshness warning when metadata provides it;
- accessible labels + keyboard focus;
- responsive desktop/mobile layout;
- telemetry without private payloads;
- **no** raw unvalidated model JSON render;
- **no** unsafe HTML;
- **no** silent semantic→keyword fallback.

Architecture rule: **deterministic core** for counts, ranges, filters,
authorization, and aggregates; **model layer** for explanation, drafts, and
synthesis. Material claims must cite deterministic values or authorized
evidence.

### A. Scarcity

**Surfaces:** record/pressing detail; seller listing/inventory; buyer watchlist.

**Must show:** exact-pressing scarcity vs release-level scarcity (separate);
evidence; comparable count; confidence; freshness; limitations; abstention when
weak. **Never** label “rare” solely because current inventory is zero.

**API:** `POST /api/ai/intelligence/scarcity`

### B. Valuation

**Surfaces:** listing create/edit; seller inventory; buyer item detail;
offer/negotiation context.

**Must show:** quick-sale / fair-market / patient-sale ranges; currency;
sold comparable count; asking-price count (separate); condition adjustment;
pressing-confidence; time range; freshness; evidence; weak-data warning.
**Never** present one invented exact price as certainty.

**API:** `POST /api/ai/intelligence/valuation` (migrate off legacy
`/api/ai/records/valuation` for product acceptance)

### C. Auction intelligence

**Surfaces:** buyer auction watchlist; seller auction dashboard; auction detail;
watchlist-batch report.

**Must show:** market-temperature; bidder-density proxy; bid velocity; late-bid
pressure; ending-time clustering; underpriced/overheated indicators;
comparable-auction context; confidence/limitations.
**Never** infer bidder identity, collusion, shill, or manipulation without
direct evidence.

**API:** `POST /api/ai/intelligence/auction`,
`POST /api/ai/intelligence/auction/watchlist-temperature`

### D. Embeddings & lineage

Primarily infrastructure. Product acceptance requires an **admin/dev**
observable surface for: embedding version; model/version id; content hash;
source lineage; owner scope; generated timestamp; deletion propagation; stale
detection; re-embed status. Embedding generation ≠ model training.
Production embedding writes remain disallowed until separate approval.

**API:** `POST /api/ai/intelligence/embeddings/metadata`

### E. Semantic / hybrid search

**Surfaces:** global/catalog/marketplace search; owner-scoped
collection/inventory search.

**Modes:** keyword | semantic | hybrid | owner-scoped (explicit).
Display/retain: matched pressing; why matched; mode used; confidence;
metadata contradictions; normalization; fallback status.
Keyword remains production default until separately approved.
**No** silent semantic→keyword fallback.

**API:** `POST /api/ai/intelligence/semantic-search` (+ existing RAG preview
only as opt-in experiment, not product acceptance)

### F. Negotiation assistance

**Surface:** buyer/seller message and offer threads (`/messages`, `/offers/*`).

**Provide separately:** thread summary; counterpart intent (labeled inference);
evidence-backed leverage; risks; strategy; suggested price range; **editable**
reply draft; evidence; limitations.

**Hard rules:** never auto-send; never impersonate; never fabricate leverage;
never expose counterpart private data; unauthorized threads → canonical
refusal; deleted messages have zero influence; corrections override; draft
clearly editable and unsubmitted; label “AI-generated draft”.

**API:** `POST /api/ai/intelligence/negotiation`

### G. Recommendations

**Surfaces:** home/feed; item detail; collection; watchlist; seller
opportunities.

**Reason codes:** similar pressing; artist/label affinity; collection gap;
watchlist relation; price/condition fit; market opportunity.
Enforce diversity, budget, negative preferences, availability, deleted-item
exclusion, pressing correctness, cold-start; no hidden pay-to-rank; no
unsupported appreciation claims.

**API:** `POST /api/ai/intelligence/recommendations`

### H. Market analytics

**Surfaces:** buyer/seller dashboards; collection analytics; auction-watchlist
report; category/artist/label reports.

**Every report must include:** time range; population; sample size; currency;
aggregation method; included/excluded states; freshness; missing-data behavior;
evidence links; confidence/limitations.
No causal/future-performance claims from correlation alone.

**API:** `POST /api/ai/intelligence/market-analytics`

### I. Multi-turn memory (cross-cutting)

Memory classes: current conversation; session; user-authorized durable;
derived market state; retrieved evidence.
Corrections override; deletes/expiry suppress; cross-thread/user isolation;
no false-memory claims; durable memory requires explicit authorization.

**API:** `POST /api/ai/intelligence/memory/resolve`,
`POST /api/ai/intelligence/memory/forget` (session routes are prototypes, not
acceptance substitutes)

## Terminology

Do **not** say the model was “trained” unless weights were updated with
reproducible artifacts. Report prompt/retrieval/reranker/calibration work
exactly. Fine-tuning remains separately approval-gated.

## Next (34B)

Implement shared intelligence hooks + evidence/confidence/abstention components,
then wire scarcity, valuation, and search onto the first real product surfaces
(record detail, listing edit, `/market` / `/watchlist`) without launching the
Phase 33F target.

## Non-goals for 34A

- No target launch
- No production enablement
- No weight updates
- No threshold reductions
- No temporary `/tmp` launchers
