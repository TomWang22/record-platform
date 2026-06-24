# T20.10W — Shadow-only fetch strategy refinement implementation

**Generated:** 2026-06-24  
**Baseline SHA:** `ad0cd22` (T20.10V shadow profile refinement proposal)  
**Implementation SHA:** `b7e17b6`  
**Mode:** shadow-only — keyword retrieval unchanged  
**Vector rollout:** NOT APPROVED

## Executive summary

Implemented T20.10V Options **A + B** in the shadow vector candidate-fetch path only:

| Option | Implementation |
|--------|----------------|
| **A — Scoped-fetch preference** | Strong route profiles fetch primary `source_type` first; skip global when pool is sufficient; global fallback on underfill |
| **B — Dedupe multi-fetch** | Skip redundant per-type fetches when type already fetched, pool ≥ `max_chunks`, or profile quota satisfied |

No Option C (global fanout cap), no ANN index, no keyword/API/env/default changes.

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/shadow_profiles.py` | `ShadowFetchStrategy`, primary type resolution, sufficiency/quota helpers |
| `services/python-ai-service/app/ai/rag_retrieval.py` | `_collect_route_mode_shadow_rows()` replaces global-first multi-fetch loop; fetch diagnostics |
| `services/python-ai-service/tests/test_shadow_fetch_strategy.py` | Unit tests for A+B strategy behavior |
| `docs/ai-platform/T20-10W-shadow-profile-refinement.md` | This document |

## Implementation details

### Option A — scoped-first profiles

| Profile / condition | Primary `source_type` |
|---------------------|----------------------|
| `obo_helper` (OBO-focused) | `obo_offer_summary` |
| `record_valuation` | `record` |
| `auction_risk` | `auction_bid_summary` |
| `seller_sales_summary` + notification terms | `notification` |
| `seller_sales_summary` + revision terms | `listing_revision` |
| `seller_sales_summary` + OBO terms | `obo_offer_summary` |
| `seller_sales_summary` (default) | `listing` |
| `generic_rag` / weak classification | global-first (unchanged) |

### Option B — dedupe rules

After primary and/or global fetch, skip per-type fetch when:

1. Source type already fetched in this request
2. Merged pool size ≥ `max_chunks`
3. Profile `preferred_type_quotas` already satisfied for that type

### Shadow-only diagnostics (new fields in `shadow_diagnostics.debug`)

- `fetch_strategy`
- `primary_source_type`
- `global_fetch_skipped`
- `typed_fetches_skipped`
- `typed_fetches_run`
- `candidate_pool_before_rerank`
- `candidate_fetch_ms`

## Before / after benchmark (T20.10T harness)

Comparison uses **T20.10O post-metadata baseline** (pre-T20.10W, same corpus/config) vs **post-deploy T20.10W run** (`t20-10-shadow-real-query-20260624-193743`).

| Metric | Before (T20.10O) | After (T20.10W) | Delta |
|--------|-----------------:|----------------:|------:|
| candidate_fetch p50 ms | 867 | **351.5** | −59% |
| candidate_fetch p95 ms | 3,434 | **801.8** | −77% |
| shadow total p50 ms | 1,433 | 1,643 | +15%† |
| shadow total p95 ms | 7,422 | **3,095.5** | −58% |
| embed p50 ms | 0‡ | 1,072.5 | embed variance |
| embed p95 ms | 5,000‡ | 2,232.5 | embed variance |
| embed timeouts | **2** | **0** | improved |
| rerank_select p95 ms | ≤59 | 33.0 | unchanged (not blocker) |

† p50 shadow total still embed-dominated run-to-run; candidate_fetch no longer the top contributor on OBO route runs.  
‡ T20.10O embed p50 distorted by timeout floor.

### Top candidate_fetch contributors (after, embed cache hit)

| Query | cf_ms (after) | Notes |
|-------|-------------:|-------|
| Notifications | 861 | `shadow_default` — still global-only path |
| Listing revisions | 782 | global fallback after scoped underfill |
| Catalog / buyer interest | 731 | listing scoped-first + fallback |
| OBO owner summary | **331** | scoped-first; global skipped |

T20.10U pre-change cache-hit contributors were **1,394–2,684 ms** on comparable queries.

## Gate results

| Gate | Result |
|------|--------|
| pytest (python-ai-service, in container build) | **132 passed** |
| Coverage (`run-service-coverage.sh` + enforce) | **PASS** — lines 90.89% |
| RAG contract (`audit-rp-ai-rag-contract.sh`) | **PASS** |
| RAG quality smoke | **PASS** |
| Runtime contract | **PASS** |
| Endpoints contract | **PASS** |
| Provider readiness | **PASS** |
| pgvector readiness | **PASS** |
| OCH decontaminate scan | **PASS** |
| Source diagnostic | **FAIL** (1 issue — see below) |
| Keyword stability (source diagnostic) | **PASS** — all 7 prompts unchanged |
| Leakage (forbidden prose / private leak scan) | **0** |
| OBO owner-visible embedded | **18** (gate ≥10) |
| Source diversity (hinted union types) | **4** (gate ≥5) — pre-existing; not a regression target for T20.10W |
| Embed timeouts | **0** |
| Zero-overlap shadow runs | 11/16 (unchanged band) |

### Source diagnostic issue

```
hinted_union_types: only ['auction_bid_summary', 'listing', 'obo_offer_summary', 'record'] (need >=5 when owner-visible)
```

Scoped-first fetch reduces cross-type fanout by design; diversity gate still fails rollout criteria independent of latency work.

## Validation commands

```bash
cd services/python-ai-service && python3 -m unittest tests.test_shadow_fetch_strategy -q
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Deploy note: benchmark requires `python-ai-service:dev` image build + rollout restart before timing run.

## Rollback plan

```bash
git revert <T20.10W-commit-sha>
# rebuild + rollout python-ai-service
```

Keyword retrieval, DB state, env defaults, and indexes remain untouched.

## Follow-up

| Ticket | Scope |
|--------|-------|
| T20.10X (suggested) | ANN index exploration — ops-approved, separate from profile work |
| Readiness re-eval | Re-run T20.10O gates after additional embedding/coverage work |

## Final verdict

**Vector rollout: NOT APPROVED**

T20.10W achieved the intended **candidate_fetch latency reduction** via shadow-only fetch strategy refinement without changing production keyword behavior. Rollout gates (coverage, overlap, source diversity, stable latency) remain failing — this ticket does not enable vector default.
