# T20.10X — Shadow source diversity restoration (diagnostics + proposal)

**Generated:** 2026-06-24  
**Baseline SHA:** `0d7aa7c` (T20.10W implementation + doc SHA fix)  
**Mode:** diagnostics/proposal only — no code changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

T20.10W ** materially improved candidate_fetch latency** but **regressed the T19.6C source-diversity gate** from **6 types → 4 types**. The regression is caused by **scoped-first skip-global + post-global dedupe**, not by corpus loss or diagnostic noise alone.

**Recommended next step:** **T20.10Y** — implement **Option A (diversity top-up typed fetches)** while keeping T20.10W scoped-first latency wins. Do **not** run rollout readiness (T20.10Z) until T20.10Y is implemented and validated.

---

## T20.10W before/after summary

| Metric | Pre-T20.10W (T20.10O) | Post-T20.10W (T20.10W run) | T20.10X re-run (`200439`) |
|--------|----------------------:|---------------------------:|--------------------------:|
| candidate_fetch p50 ms | 867 | 351.5 | **126.0** |
| candidate_fetch p95 ms | 3,434 | 801.8 | **461.2** |
| shadow total p50 ms | 1,433 | 1,643 | **733.0** |
| shadow total p95 ms | 7,422 | 3,095.5 | **1,736.2** |
| embed timeouts | 2 | 0 | **0** |
| T19.6C hinted union types | **6 (PASS)** | **4 (FAIL)** | **4 (FAIL)** |
| zero-overlap shadow runs | 12/16 | 11/16 | 11/16 |

Latency improved directionally and, on the T20.10X re-run, **shadow p95 is now under the 3,000 ms gate** (1,736 ms). Source diversity remains the blocking regression from T20.10W.

---

## Current source diversity result

**Script:** `bash scripts/rp-ai-shadow-source-diagnostic.sh`  
**Artifact:** `bench_logs/ai-platform/t19-6-route-shadow-quality.md` (T20.10X run)

```
RESULT: FAIL (1 issue)
Unweighted types: ['auction_bid_summary', 'listing', 'listing_revision', 'notification']
Weighted types:   ['auction_bid_summary', 'listing', 'obo_offer_summary', 'record']
Hinted types:     ['auction_bid_summary', 'listing', 'obo_offer_summary', 'record']  ← gate uses this union
Issue: hinted_union_types: only 4 types (need >=5 when owner-visible)
OBO owner-visible: 18 / 1118 embedded OBO
```

### Historical comparison (same diagnostic script)

| Eval | Hinted union (w+h) | Gate |
|------|-------------------|------|
| T20.10F (`c6e7f5c`) | **All 6 shadow-allowed types** | **PASS** |
| T20.10O (`85d6417`) | **6 types** (readiness doc) | **PASS** |
| Post-T20.10W (`0d7aa7c`) | **4 types** | **FAIL** |

The readiness docs (T20.10F/O) and T19.6C diagnostic use the same **≥5 types across weighted+hints contract prompts** threshold. T20.10W broke the diagnostic that previously passed.

---

## Source types present vs missing

### Present in hinted union (4)

| source_type | Example prompt(s) surfacing in w+h |
|-------------|-----------------------------------|
| `obo_offer_summary` | `obo_counter`, `listing_quality` |
| `listing` | `seller_summary`, `notifications` (w+h) |
| `record` | `underpriced_records`, `buyer_summary` |
| `auction_bid_summary` | `auction_risk` |

### Missing from hinted union (2)

| source_type | Still visible elsewhere | Last seen in w+h (pre-W) |
|-------------|-------------------------|--------------------------|
| **`listing_revision`** | Unweighted global path (`underpriced_records` uw column) | T20.10F — global merge + route rerank |
| **`notification`** | Unweighted global path (`notifications` uw = 2 candidates) | T20.10F — union included via route/global mix |

### Corpus is not the blocker

Embedded visible counts (contract user, T20.10U baseline) still include all types:

| source_type | embedded_visible |
|-------------|-----------------:|
| listing | 1,365 |
| listing_revision | 474 |
| record | 288 |
| auction_bid_summary | 253 |
| obo_offer_summary | 18 |
| notification | 6 |

**Unweighted** shadow still surfaces `listing_revision` and `notification`. The regression is in **route-mode weighted+hints selection**, not missing embeddings.

---

## Per-prompt diversity regression map (T20.10X diagnostic)

| prompt_id | profile | uw types | w+h types (post-W) | Diversity note |
|-----------|---------|----------|-------------------|----------------|
| `obo_counter` | obo_helper | — | **obo only** | Primary OBO fill → skip global + extras |
| `underpriced_records` | record_valuation | listing_revision | **record only** | Primary record fill → lost revision cross-type |
| `seller_summary` | seller_sales_summary | listing | **listing only** | Primary listing fill → monotype |
| `buyer_summary` | buyer_collection_summary | listing | **record only** | Primary record fill |
| `listing_quality` | pricing_recommendation → obo_helper | listing | **obo only** | Primary OBO fill |
| `notifications` | generic_rag | **notification** | **listing only** | Notification in uw; w+h rerank listing-only |
| `auction_risk` | auction_risk | auction_bid_summary | **auction only** | Expected monotype for auction profile |

**Route/profile labels that lost diversity:** `record_valuation`, `obo_helper`, `seller_sales_summary`, `generic_rag` (notifications prompt).

---

## Root-cause analysis

### Q1. Which source types disappeared after T20.10W?

**`listing_revision`** and **`notification`** dropped out of the **hinted union**. Four types remain.

### Q2. Which route/profile/query labels lost diversity?

Strong scoped-first profiles: **`obo_helper`**, **`record_valuation`**, **`seller_sales_summary`**, and **`generic_rag`** (notifications). Each w+h run now surfaces **one primary type** in top results.

### Q3. Did scoped-first skip global too aggressively?

**Yes — for latency, by design.** In `_collect_route_mode_shadow_rows()` (`rag_retrieval.py`):

```python
if strategy.fetch_strategy == "scoped_first" and primary:
    await _typed_fetch(primary)
    if _pool_is_sufficient(...):
        fetch_diag["global_fetch_skipped"] = True
        fetch_diag["typed_fetches_skipped"] = list(strategy.extra_source_types)
        return merged_rows  # early exit — no global, no extras
```

When primary typed fetch returns ≥ `max_chunks` rows (typical for record/listing/obo/auction profiles), **all extra typed fetches and global fallback are skipped**. Pre-T20.10W, global fetch always ran first and merged cross-type candidates before rerank.

### Q4. Are typed top-up fetches sufficient to restore ≥5 source types?

**Yes, likely.** T20.10U showed typed fetches are **~5× cheaper** than global (OBO ~1,178 vs global ~5,218 estimated cost). Small LIMIT 2–3 top-up fetches for `listing_revision` and `notification` across profiles should restore union diversity without restoring global-first behavior.

### Q5. Can we restore diversity without expensive global fetches?

**Yes.** Option A (below) adds **mandatory small typed top-ups** after primary success, decoupled from the count-sufficiency check that triggers skip-global.

### Q6. Real retrieval issue or diagnostic sample composition?

**Both, but primarily retrieval strategy:**

- The **diagnostic gate** unions **selected** source types from weighted+hints runs (not raw pool types). Monotype pools → monotype selection → gate failure.
- The **sample composition** (7 fixed prompts) is unchanged; T20.10F passed on the same prompts with 6 types. This is a **real regression from T20.10W fetch strategy**, not a new diagnostic artifact.

### Q7. Secondary factor — Option B post-global dedupe

For `global_first` paths (`generic_rag`, underfill fallbacks), when global returns ≥ `max_chunks` listing-heavy rows, **extra typed fetches are skipped** (`_pool_is_sufficient` + quota checks). That prevents `notification` from entering the notifications prompt pool on the w+h path even though uw global still finds 2 notification rows.

---

## Proposed T20.10Y implementation (recommended)

### Option A — Diversity top-up typed fetches (RECOMMENDED)

**Behavior:** After primary typed fetch (whether or not global is skipped), run **small typed top-up fetches** for configured secondary types **before rerank**. Top-ups are **not skipped** by count sufficiency; they run until diversity targets are met or the configured list is exhausted.

**New helper in `shadow_profiles.py`:**

```python
def diversity_topup_source_types(profile, custom_hints, query, primary) -> List[str]:
    """Shadow-only secondary types to fetch for rollout diversity gate."""
```

**Suggested top-up maps (LIMIT 2–3 each, shadow-only):**

| Profile | Primary (T20.10W) | Diversity top-ups |
|---------|-------------------|-------------------|
| `obo_helper` | `obo_offer_summary` | `listing`, `listing_revision`, `notification` |
| `record_valuation` / `buyer_collection_summary` | `record` | `listing`, `listing_revision`, `notification` |
| `seller_sales_summary` | `listing` (or query-specific primary) | `listing_revision`, `obo_offer_summary`, `notification` |
| `auction_risk` | `auction_bid_summary` | `listing`, `listing_revision` |
| `generic_rag` + notification query terms | — (global_first) | **`notification`**, `listing_revision` |

**Fetch loop change in `_collect_route_mode_shadow_rows()`:**

1. Primary typed fetch (unchanged T20.10W)
2. If count sufficient → **skip global** (keep latency win)
3. **Always run diversity top-ups** (small limits) for types not yet fetched
4. Only then return pool to rerank

**Sufficiency split:**

- `count_sufficient` → controls global fallback skip (T20.10W behavior)
- `diversity_sufficient(pool_by_type, min_distinct=5)` → controls whether top-ups continue (shadow diagnostic only; does not affect keyword)

**Expected cost:** +2–3 typed fetches × ~50–150 ms each on scoped-first routes ≪ global sort (~800 ms p95 pre-W).

### Option B — Conditional global diversity probe (FALLBACK ONLY)

Run a **small global LIMIT** (e.g. `max_chunks`, not `max_chunks * 3`) only when:

- Count sufficient after primary, but
- Distinct source types in pool < 5, and
- Option A top-ups did not add missing types (e.g. type has 0 embedded visible)

Higher latency risk; use only if Option A cannot reach ≥5 union types in validation.

### Option C — Revert skip-global (NOT RECOMMENDED)

Restore T20.10W-pre global-first for all route profiles. Would likely restore 6-type union but **forfeit candidate_fetch gains** (~801 ms → ~3,434 ms p95 band).

---

## Recommended stance

| Option | T20.10Y stance |
|--------|----------------|
| **A — Diversity top-up typed fetches** | **Implement** |
| **B — Conditional global probe** | Fallback only if A fails validation |
| **C — Revert skip-global** | **Do not use** unless A+B fail |

---

## T20.10Y exact code change checklist

| File | Change |
|------|--------|
| `shadow_profiles.py` | Add `diversity_topup_source_types()`; optional `SHADOW_DIVERSITY_MIN_DISTINCT_TYPES = 5` constant (shadow-only, not env default flip) |
| `rag_retrieval.py` | After primary success path, run top-ups before early return; add `diversity_topups_run`, `diversity_topups_skipped` diagnostics; do **not** subject top-ups to `_pool_is_sufficient` early break |
| `tests/test_shadow_fetch_strategy.py` | Assert top-ups run when global skipped; assert `listing_revision`/`notification` enter pool for record_valuation / generic_rag notification prompts |
| `docs/ai-platform/T20-10Y-shadow-diversity-topup.md` | Implementation report |

**Invariants (unchanged):** keyword path, `AI_RAG_SHADOW_VECTOR=0` default, no API/env changes, no ranking weight changes, no DB/index/metadata/embedding writes.

---

## Validation plan (T20.10Y)

```bash
cd services/python-ai-service && python3 -m unittest tests.test_shadow_fetch_strategy -q
bash scripts/coverage/run-service-coverage.sh python-ai-service
bash scripts/rp-ai-shadow-source-diagnostic.sh   # target: hinted union >= 5
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

**Success targets:**

| Gate | Target |
|------|--------|
| Hinted union types | **≥ 5** |
| candidate_fetch p95 | **< 1,500 ms** (hold T20.10W gains) |
| shadow p95 | **≤ 3,000 ms** |
| OBO owner-visible | **≥ 10** |
| Leakage | **0** |
| Keyword contracts | **PASS** |

---

## Rollback plan

1. Revert T20.10Y commit only → back to T20.10W behavior (4-type union, lower fetch latency).
2. Full revert T20.10W+Y → restore pre-W global-first diversity at higher fetch cost.

No DB or env rollback required.

---

## Overlap / coverage note (for T20.10Z)

T20.10X did **not** re-run full readiness. Expected T20.10Z state:

| Gate | Expected |
|------|----------|
| Embedded coverage (~7.62%) | **FAIL** |
| Shadow–keyword overlap (11–12/16 zero) | **FAIL** |
| Source diversity | **FAIL until T20.10Y** |

Do **not** run T20.10Z until T20.10Y validates diversity restoration.

---

## Diagnostics run (this ticket)

| Command | Result |
|---------|--------|
| `git status --short` | Hygiene OK — no AI code staged |
| `bash scripts/rp-ai-shadow-source-diagnostic.sh` | FAIL — 4 hinted types |
| `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh` | PASS harness — cf p95 **461 ms**, shadow p95 **1,736 ms** |
| `bash scripts/rp-och-decontaminate-scan.sh` | **PASS** (589 files) |

Artifacts (local, not committed): `bench_logs/ai-platform/t19-6-route-shadow-quality.md`, `t20-10-shadow-real-query-20260624-200439.{md,jsonl}`

---

## Definition of done (T20.10X)

- [x] Source diversity regression explained (6 → 4 types; `listing_revision`, `notification` missing)
- [x] T20.10Y recommendation explicit (Option A primary)
- [x] No code changed
- [x] No generated artifacts committed
- [x] Vector rollout remains NOT APPROVED

## Final verdict

**Vector rollout: NOT APPROVED**

T20.10W traded cross-type fanout for latency. Restoring diversity via **typed top-ups (T20.10Y Option A)** is the safest path to recover the ≥5-type gate without reverting to global-first fetches or enabling vector default.
