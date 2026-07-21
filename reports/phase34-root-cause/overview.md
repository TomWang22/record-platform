# Phase 34 data-to-answer root-cause overview

**Status:** COMPLETE — dossier only. Attempt 7 not launched. No UI remediation claimed.

Attempt 6 remains mechanical PASS / product-semantic REJECTED. Frozen evidence must not be mutated.

## What attempt 6 actually proved

- 24/24 schedule, 27/27 turns, 81/81 protocol rows, exporter, 20 PNGs.
- It did **not** prove real market ingestion, shared evidence snapshots, conversational authority, or collector-grade grounded answers.

## Primary root cause

The platform still manufactures successful intelligence from **capability-local deterministic engines** plus **owner-proof synthetic floors** (COMPLETED_SALE seed JSON, static semantic cards, recommendation/analytics auto-floors, prompt-parsed negotiation facts). Frontend polish and PNG distinctness cannot repair that.

## Sold-event model (most important)

| Path | Status |
|------|--------|
| Archive listing → treat as sold (`owner_listing_archived_as_sold_floor`) | Removed from live seed / asserted absent in tests |
| Create listings → emit `COMPLETED_SALE` seed JSON → sync to pods → merge into scarcity/valuation | **Current acceptance path (still synthetic)** |
| Real checkout/settlement → `SALE_COMPLETED` → snapshot → calculate → synthesize | **Required; not proven** |

An archived listing must never equal SOLD. Seed `COMPLETED_SALE` rows linked to freshly created listings without a settlement event are not production-grade completed sales.

## Capability summary (attempt 6)

| Capability | Where answers came from | Synthetic? |
|------------|-------------------------|------------|
| Scarcity | Seed COMPLETED_SALE merge + live asking/supply; score formula → Common at ~0.00 with high supply | Yes (seed sales) |
| Valuation | Same seed merge; median × condition multipliers → quick/fair/patient | Yes (seed sales) |
| Auction | Watchlist listings (many leftover IDs); bid metrics zero without bid-event density | Partially (lots real-ish; analysis empty) |
| Embeddings | Deterministic metadata fixture; embedding write disabled | Diagnostic only |
| Search | Hard-coded `_catalog_cards`; embedding/retrieval NOT_INVOKED | Yes |
| Negotiation | Prompt regex facts + template drafts + optional market floor | Yes / weak |
| Recommendations | Auto seed candidates when floor triggers | Yes |
| Analytics | Auto 20+ event array when empty + owner_proof_prompt | Yes |

Pipeline observation on scarcity success: `embedding` / `retrieval` / `reranker` / `model` = `NOT_INVOKED_BY_POLICY`. Only assembler + deterministic engine ran.

## Evaluation gap

Exported dossiers are protocol ledgers (H1/H2/H3, hashes). They do not contain eligible-row IDs, removal reasons, or claim↔evidence support. Different screenshots are not semantic truth.

## Stop line

No attempt 7, no screenshot pack, no smoke-v6/canary/gauntlet/33F/production, no owner-proof PASS claim. Next decision is based on this dossier and the remediation plan — not screenshots.

See:

- `reports/phase34-root-cause/runtime-fallback-inventory.json`
- `reports/phase34-root-cause/data-lineage.json`
- `reports/phase34-root-cause/capability-traces/`
- `reports/phase34-root-cause/evaluation-gaps.md`
- `reports/phase34-root-cause/remediation-plan.md`
- `scripts/ai-platform/phase34-root-cause-dossier.json`


## Supplement (merged agent traces)

From [Trace sold/scarcity/valuation path](01dfea52-273c-44e3-b7b6-b0752921be03) and [Inventory synthetic fallbacks](14486d09-57bd-47a8-a4c9-df3ae6189525):

- Attempt-6 scarcity **Common / score 0.00 / sold 3 / supply 65** matches the scarcity formula under high asking supply — not a UI bug.
- Sold evidence = three Miles + three Kenny **`COMPLETED_SALE` seed events**; sale-source listings are **paused** afterward and are **not** counted as sold.
- `force_sold_floor` still exists in engines but was **not** used on attempt-6 live recapture bodies (v5 contract gate).
- Highest remaining live synthetic risks: negotiation panel hard-coded `completed-sale-comp-*`, JP-pressing invented comps, recs/analytics auto-floors, semantic `_catalog_cards`, seed-file merge in cluster.
