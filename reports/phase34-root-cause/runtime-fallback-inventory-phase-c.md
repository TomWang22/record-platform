# Phase C runtime fallback inventory

**Generated:** 2026-07-21 (Phase C closeout)
**Policy:** No success scenario may clear floors by injecting evidence inside the capability request/engine for live acceptance. Unit-test-only injectors must be gated behind `PHASE34_UNIT_TEST_HOOKS=1` or `PHASE34_ALLOW_SYNTHETIC_SALES=1`.

## Counts

| Metric | Value |
|--------|------:|
| Total inventory entries reviewed | 21 |
| Live executable (`can_execute_outside_unit_tests: true`) | **0** |
| Customer-visible live synthetic paths | **0** |

## Highest-risk live paths

_None remaining._ All former live injectors are either removed from product surfaces or gated so they cannot execute outside unit-test hooks.

## Entries (all gated / non-live)

| id | file | can_execute_outside_unit_tests | notes |
|----|------|-------------------------------:|-------|
| FB-SOLD-SEED-JSON | `scripts/lib/phase34-owner-proof-market-seed.mjs` | false | Seed write path requires synthetic hook (Phase A) |
| FB-SOLD-SEED-MERGE | `scripts/lib/phase34-owner-proof-completed-sale-candidates.mjs` | false | Live merge blocked; settlement SALE_COMPLETED only |
| FB-COMPLETED-SALES-API | `webapp/app/api/marketplace/completed-sales/route.ts` | false | Seed served only with hooks |
| FB-FORCE-SOLD-FLOOR-SCARCITY | `scripts/lib/phase33c-scarcity.mjs` | false | `assertSyntheticSalesAllowed` |
| FB-FORCE-SOLD-FLOOR-VALUATION | `scripts/lib/phase33c-valuation.mjs` | false | `assertSyntheticSalesAllowed` |
| FB-FORCE-WATCHLIST-FLOOR | `scripts/lib/phase33c-auction.mjs` | false | `assertUnitTestHooksAllowed` |
| FB-FORCE-NEARLY-EMPTY-AUCTION | `scripts/lib/phase33c-auction.mjs` | false | No intent-wipe injector; honest empty watchlist |
| FB-FORCE-RECOMMENDATION-FLOOR | `scripts/lib/phase33d-recommendations.mjs` | false | Explicit + auto-floor require hooks |
| FB-FORCE-ANALYTICS-FLOOR | `scripts/lib/phase33e-analytics.mjs` | false | Explicit + auto-floor require hooks |
| FB-FORCE-NEGOTIATION-MARKET-FLOOR | `scripts/lib/phase33d-negotiation.mjs` | false | `assertUnitTestHooksAllowed`; empty → honest limit |
| FB-SEMANTIC-CATALOG-CARDS | `embedding_semantic_fixtures.py` | false | `_catalog_cards` blocked without hooks |
| FB-EMBEDDING-METADATA-FIXTURE | `embedding_semantic_fixtures.py` | false | Lineage diagnostic; no invented sold comps |
| FB-API-FORCE-FLAGS | `services/python-ai-service/app/ai/routes.py` | false | 422 `FORCE_FLOOR_FIELDS_REJECTED` without hooks |
| FB-ARCHIVE-AS-SOLD-HISTORICAL | (absent) | false | Regression-asserted absent |
| FB-SEED-BID-HISTORIES | market-seed | false | Not used as sold evidence |
| FB-JP-PRESSING-SYNTHETIC-COMPS | `phase33c-scarcity.mjs` | false | Invented JP comps only when hooks enabled |
| FB-NEGOTIATION-PANEL-HARDCODED-COMPS | `negotiation-intelligence-panel.tsx` | false | Hard-coded comps removed; `market_candidates: []` |
| FB-NEGOTIATION-ADAPTER-COMP-INJECTION | `adapters.mjs` | false | `completed-sale-comp-*` seed removed |
| FB-FORCE-SUCCESS-FLOOR-ASKING-ONLY | `phase33c-scarcity.mjs` | false | `force_success_floor: false` requires hooks |
| FB-VALUATION-WEAK-SOLD-STRIP | `phase33c-valuation.mjs` | false | Honesty guard only (strips; does not invent) |
| FB-RECAPTURE-V5-FORCE-FLOOR-GATE | product-contracts | false | All `force_*` always blocked in captured bodies |

## Phase C controls

- Gate module: `scripts/lib/phase34-synthetic-sales-gate.mjs` (`assertUnitTestHooksAllowed`, production boot guard)
- Repo scanner: `scripts/lib/phase34-synthetic-fallback-verifier.mjs`
- Regression test: `tests/phase34-no-live-synthetic-fallbacks.test.mjs`
- Python guard: `services/python-ai-service/app/ai/phase34_hooks_guard.py` (startup + API)
- Webapp guard module: `webapp/lib/phase34-production-hooks-guard.ts`
