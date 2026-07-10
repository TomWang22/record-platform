# T20.10Y — Shadow source diversity typed top-up implementation

**Generated:** 2026-06-25  
**Baseline SHA:** `203a1e9` (T20.10X shadow source diversity diagnostics)  
**Implementation SHA:** `e6efcd3`  
**Mode:** shadow-only — keyword retrieval unchanged  
**Vector rollout:** NOT APPROVED

## Executive summary

Implemented T20.10X **Option A** — small typed diversity top-up fetches after primary scoped fetch, **without** reverting T20.10W skip-global behavior.

| Goal | Result |
|------|--------|
| Source diversity ≥5 | **PASS — 6 types** (restored from 4) |
| `listing_revision` restored | **Yes** |
| `notification` restored | **Yes** |
| T20.10W skip-global preserved | **Yes** |
| Keyword retrieval unchanged | **Yes** |

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/shadow_profiles.py` | `diversity_topup_source_types()`, `pool_diversity_satisfied()`, extended `ShadowFetchStrategy` |
| `services/python-ai-service/app/ai/rag_retrieval.py` | Diversity top-up loop in `_collect_route_mode_shadow_rows()`; `source_types_before/after_rerank` diagnostics |
| `services/python-ai-service/tests/test_shadow_fetch_strategy.py` | 15 tests covering top-ups, dedupe, global fallback |
| `docs/ai-platform/T20-10Y-shadow-diversity-topup.md` | This document |

## Implementation details

### Flow (T20.10W + T20.10Y)

1. Primary typed fetch (scoped-first profiles)
2. **Diversity top-up typed fetches** (LIMIT 3 each) — run even when count sufficient; stop when ≥5 distinct types in pool
3. Global fallback only on count underfill
4. Extra typed fetches (T20.10W Option B dedupe) if still needed
5. Existing rerank/select unchanged

### Diversity top-up maps

| Profile | Top-up types (after primary) |
|---------|------------------------------|
| `obo_helper` | `listing`, `listing_revision`, `notification` |
| `record_valuation` | `listing`, `listing_revision`, `notification`, `obo_offer_summary` |
| `seller_sales_summary` | `listing_revision`, `notification`, `obo_offer_summary`, `listing` |
| `auction_risk` | `listing`, `listing_revision` |
| `generic_rag` + notification terms | `notification`, `listing`, `listing_revision`, `obo_offer_summary` |
| `generic_rag` default | `listing_revision`, `notification`, `listing` |

### New diagnostics (`shadow_diagnostics.debug`)

- `diversity_topups_run`
- `diversity_topups_skipped`
- `source_types_before_rerank`
- `source_types_after_rerank`
- (preserved) `fetch_strategy`, `primary_source_type`, `global_fetch_skipped`, `candidate_fetch_ms`

## Source diversity before/after

| Metric | T20.10W (post) | T20.10Y (post) |
|--------|---------------:|---------------:|
| Hinted union types | **4 — FAIL** | **6 — PASS** |
| `listing_revision` in union | No | **Yes** |
| `notification` in union | No | **Yes** |
| T19.6C issues | 1 | **0** |

### Types present after fix (hinted union)

`auction_bid_summary`, `listing`, `listing_revision`, `notification`, `obo_offer_summary`, `record`

### Per-prompt restoration (T19.6C diagnostic)

| prompt | w+h types (post-Y) |
|--------|-------------------|
| `obo_counter` | listing, listing_revision, obo_offer_summary |
| `underpriced_records` | listing, notification, record |
| `notifications` | listing, listing_revision, notification, obo_offer_summary |
| `auction_risk` | auction_bid_summary, listing, listing_revision |

## Benchmark before/after

Comparison: T20.10O (pre-W) → T20.10W → T20.10Y (warm rerun `214301`).

| Metric | T20.10O | T20.10W | T20.10Y |
|--------|--------:|--------:|--------:|
| candidate_fetch p50 ms | 867 | 351.5 | **1,101.0** |
| candidate_fetch p95 ms | 3,434 | 801.8 | **3,098.8** |
| shadow total p50 ms | 1,433 | 1,643 | **1,995.5** |
| shadow total p95 ms | 7,422 | 3,095.5 | **7,240.5**† |
| embed timeouts | 2 | 0 | 1† |

† Shadow p95 still embed-variance dominated (embed p95 5,424 ms on this run). candidate_fetch p95 remains **below T20.10O** (3,434 ms) while diversity is restored.

T20.10Y adds 2–4 small typed fetches per route-mode query — expected cf increase vs T20.10W-only, but avoids global-first regression.

## Gate results

| Gate | Result |
|------|--------|
| pytest (python-ai-service) | **136 passed** |
| Coverage enforce | **PASS** — lines 90.94% |
| Source diagnostic (T19.6C) | **PASS** — 6 types, 0 issues |
| RAG contract | **PASS** |
| RAG quality smoke | **PASS** |
| Runtime contract | **PASS** |
| Endpoints contract | **PASS** |
| Provider readiness | **PASS** |
| pgvector readiness | **PASS** (retry after transient psql timeout) |
| OCH scan | **PASS** |
| OBO owner-visible embedded | **18** (≥10) |
| Leakage | **0** |
| Keyword stability | **PASS** — all 7 prompts unchanged |
| Zero-overlap shadow runs | 12/16 (unchanged band) |

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

Deploy: `docker build` + `kubectl rollout restart deployment/python-ai-service` required before live diagnostics.

## Rollback plan

```bash
git revert <T20.10Y-commit-sha>
# rebuild + rollout python-ai-service
```

Reverts to T20.10W behavior (4-type diversity, lower cf). Keyword path untouched.

## Follow-up

**T20.10Z** — post shadow-refinement readiness re-eval (read-only). Do not enable vector default.

## Final verdict

**Vector rollout: NOT APPROVED**

T20.10Y restored source diversity to **6 types** while keeping candidate_fetch p95 below the pre-T20.10W baseline. Coverage (~7.62%), overlap (12/16 zero), and embed variance remain rollout blockers.
