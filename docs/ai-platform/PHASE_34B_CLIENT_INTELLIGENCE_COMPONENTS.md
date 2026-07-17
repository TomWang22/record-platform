# Phase 34B — Client intelligence components

```text
Canonical status: PHASE 34B PARTIAL —
PRODUCTIZATION AND MODEL OPTIMIZATION INCOMPLETE —
TARGET NOT LAUNCHED

Target: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT
Production: NOT APPROVED (keyword default; PERCENT=0; ALLOW_PROD_PERCENT=0)
Fine-tuning / model-weight updates: NO
No PRODUCT_SLICE_ACCEPTED rows
```

## Matrix

`scripts/ai-platform/phase34-client-surface-matrix.json` (v2)

Allowed: `MISSING` → `PLUMBING_ONLY` → `LIVE_EVIDENCE_CONNECTED` → `UNIT_TESTED` → `INTEGRATION_TESTED` → `PLAYWRIGHT_TESTED` → `HUMAN_REVIEWED` → `PRODUCT_SLICE_ACCEPTED`

Current highest honest status for landed surfaces: **INTEGRATION_TESTED** (not accepted).

## Eight capabilities — client surfaces present

| Capability | Primary routes |
|---|---|
| Scarcity | `/records/[id]`, `/listings/[id]` |
| Valuation | `/records/[id]`, `/listings/[id]`, `/listings/[id]/edit`, `/sell`, `/market` |
| Auction | `/listings/[id]` (auction), `/watchlist`, seller analytics |
| Search | `/listings`, `/market`/`/sell` (keyword default; no silent fallback) |
| Negotiation | `/messages`, `/offers/*` (draft only; no auto-send) |
| Recommendations | `/dashboard`, `/records/[id]` |
| Market analytics | `/insights` |
| Embedding lineage | `/insights` (diagnostic; no prod writes) |
| Memory | `/messages` thread controls |

## Phase 34C–34E scaffolding

- Prompt registry: 96 material configs (`scripts/ai-platform/phase34-prompt-registry/`)
- Eval policy floors: `scripts/ai-platform/phase34-eval-policy.json` (not lowered)
- Corpus / selection / retrieval / multiturn / human-review generators under `scripts/ai-platform/` writing **only** to `/tmp/phase34-eval/`
- Playwright inventory: `webapp/e2e/phase34-intelligence-acceptance.spec.ts` (`PHASE34_E2E=1`)

## Remaining before product acceptance

Full 20k unique-session holdout, ≥800 human reviews, complete Playwright journeys with live stack, PLAYWRIGHT_TESTED → HUMAN_REVIEWED → PRODUCT_SLICE_ACCEPTED per surface, then Phase 33F target regeneration (not launch).
