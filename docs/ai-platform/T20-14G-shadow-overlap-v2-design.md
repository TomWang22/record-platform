# T20.14G — Shadow overlap v2 design

**Status:** Design only — no implementation  
**Generated:** 2026-06-28  
**Baseline SHA:** `d7cd4c3` (T20.14F2 ANN dev experiment complete)  
**Mode:** Read-only analysis; no code, DB, index, or rollout changes

---

## Executive summary

T20.14F2 solved **candidate_fetch latency** with local/dev HNSW (cf p95 **557 / 205 / 532 ms**). **Overlap and zero-result gates remain the vector rollout blockers.**

F2 artifacts show a **stable, repeatable** overlap profile across three runs: **11/16** zero chunk-overlap, **5/16** doc-overlap >0, **5/16** entity-overlap >0, and **2/16** true zero-result after fetch — always the same two `shadow_default` queries. `shadow_obo_owner` returns **8/8** on those same prompts. This is **`typed_pool_empty` on `seller_sales_summary`**, not embed failure or privacy filtering.

HNSW **did not improve** overlap distribution vs T20.14E; it may have **surfaced** the two zero-result cases (T20.14E: **0/16** zero-result; F2: **2/16**). Treat as fetch-path + ANN interaction to verify in G2, not as overlap regression from exact sort.

**Recommended path:** T20.14G2 shadow-only zero-result fallback + keyword-anchor top-up + overlap telemetry v2; optional G3 entity expansion; then T20.14H 5-run stability with HNSW + G2.

```text
T20.14G shadow overlap v2 design: COMPLETE
Implementation: NOT STARTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G2 shadow overlap v2 implementation, only if explicitly approved
```

---

## Required analysis (answers)

### 1. Which exact 2/16 cases are true zero-result after fetch?

Stable across all three F2 runs (`185845`, `185948`, `190020`). Both are **`shadow_default`** (inferred `seller_sales_summary`); **`shadow_obo_owner`** succeeds on the same prompts.

| # | Query (truncated) | Mode | Profile | Keyword refs | Shadow selected | Fetch attempted |
|---|-------------------|------|---------|--------------|-----------------|-----------------|
| 1 | Summarize listing activity and buyer interest for my catalog this week | `shadow_default` | `seller_sales_summary` | 8 (listing×6, listing_revision×2) | **0** | **Yes** |
| 2 | What notifications matter most for my selling activity right now? | `shadow_default` | `seller_sales_summary` | 8 (obo_offer_summary×8) | **0** | **Yes** |

Paired `shadow_obo_owner` on same queries: **8 selected**, overlap reason `source_type_mismatch` (not zero-result).

### 2. Root-cause classification

| Case | Diagnosis | Evidence |
|------|-----------|----------|
| Catalog / `shadow_default` | **`typed_pool_empty`** + **`profile_miss`** | `candidate_count_raw=0` after primary=`listing` + diversity top-ups + global fallback; `typed_fetches_run`: listing, listing_revision, notification, obo_offer_summary; `global_fetch_skipped=false`; privacy blocks **0**; `embed_timeout_before_fetch=0` |
| Notifications / `shadow_default` | **`typed_pool_empty`** + **`profile_miss`** | `candidate_count_raw=0` after primary=`notification` + typed/global fetches; contract user has **11** embedded notification chunks in scope; keyword returns obo×8 ( **`keyword_only_source_type`** for notification intent) |
| Neither case | rerank_filtered_empty | Pool empty **before** rerank (`candidate_pool_before_rerank=0`) |
| Neither case | visibility_filter_empty | `blocked_*_count=0` on all privacy counters |
| Neither case | true_missing_embedding | `shadow_fetch_attempted=true`; scope counts show listing/notification embedded |

Overlap label: **`one_path_empty`** (keyword_count=8, shadow_count=0 per `_classify_zero_overlap_reason`).

### 3. Does HNSW change overlap distribution vs exact sort?

**No material change** to overlap metrics:

| Metric | T20.14E (pre-HNSW, runs 1–2) | F2 (post-HNSW, all 3 runs) |
|--------|------------------------------|----------------------------|
| Zero chunk-overlap | 11/16 | **11/16** |
| doc overlap >0 | 5/16 | **5/16** |
| entity overlap >0 | 5/16 | **5/16** |
| Zero-overlap reasons | 6 STM, 3 SSTDC, 0 OPE* | 6 STM, 3 SSTDC, **2 OPE** |
| true zero-results | **0/16** | **2/16** |

\*T20.14E had no `one_path_empty` on scored runs; F2 adds 2 OPE from the zero-result pair.

HNSW improved latency dramatically; overlap **shape** is unchanged. Zero-results **may** correlate with HNSW + scoped typed fetch (investigate `ef_search`, planner choice on filtered ANN queries in G2).

### 4. Chunk only, or doc/entity/source overlap too?

**All layers matter; different problems:**

| Layer | F2 state | Role |
|-------|----------|------|
| **Chunk overlap** | 11/16 zero | Dominated by complementary retrieval (lexical keyword vs semantic shadow); **diagnostic**, not sole rollout gate |
| **Doc overlap** | 5/16 >0 | Better signal for semantically equivalent evidence |
| **Entity overlap** | 5/16 >0 | Metadata bridges (`listing_id`) work when profiles align (e.g. revision query + `obo_helper`: entity_ov **13**) |
| **Source-type parity** | 6/11 zeros = `source_type_mismatch` | Keyword narrows to one type; shadow diversifies by design |
| **True zero-result** | 2/16 | **Hard blocker** — shadow path empty after fetch while keyword succeeds |

### 5. Which overlap metric should gate rollout?

Adopt **Option E (gate redefinition)** — primary gates:

1. **true zero-results = 0** (non-negotiable)
2. **source diagnostic PASS**
3. **doc_overlap >0 on ≥10/16** (62.5%, up from 5/16)
4. **entity_overlap >0 on ≥10/16**
5. **answer-quality parity PASS** (Playwright + telemetry 0 WARNs)
6. **chunk_overlap** — **report-only** on default/off path; optional flagged run reported separately (T20.10AG: 8/16 with hints+neighbors, diagnostic only)

### 6. What is safe without changing production keyword path?

All proposals below are **shadow/canary diagnostic path only** (`shadow_vector=1`, `AI_RAG_SHADOW_VECTOR` remains off for production default):

- Zero-result fallback when `shadow_fetch_attempted` and `selected_count=0`
- Keyword-anchor top-up (tagged `keyword_anchor_added`)
- Entity-aware expansion v2 (caps + privacy)
- Source-type floor in shadow profiles
- Extended overlap telemetry v2 fields
- Unit/integration tests for shadow diagnostics only

**Forbidden without explicit approval:** production vector default, hybrid default, keyword retrieval changes, default-on `AI_RAG_SHADOW_ENTITY_HINTS` / `AI_RAG_SHADOW_NEIGHBOR_EXPANSION`, DB/index changes, embedding tranches, T20.15.

---

## 1. Current overlap state

| Metric | Current (F2, stable 3/3 runs) | Target | Status |
|--------|------------------------------:|--------|--------|
| true zero-results | **2/16** | 0 | **FAIL** |
| default zero chunk overlap | **11/16** | materially lower (≥8/16 with overlap >0) | **FAIL** |
| doc overlap >0 | **5/16** | ≥10/16 | **FAIL** |
| entity overlap >0 | **5/16** | ≥10/16 | **FAIL** |
| flagged overlap (T20.10AG ref) | **8/16** when flags on | diagnostic only | info |
| source diagnostic | **PASS** | PASS | **PASS** |
| latency after HNSW | cf p95 **557/205/532**; shadow p95 **1494/376/1317** | cf ≤1500; shadow ≤3000 | **PASS** |
| embed timeouts | **0** | 0 | **PASS** |
| shadow_fetch_attempted | **16/16** | 16/16 | **PASS** |

### Zero-overlap reason breakdown (11/16)

| Reason | Count | Notes |
|--------|------:|-------|
| `source_type_mismatch` | 6 | Keyword one-type narrow vs shadow diversified pool |
| `same_source_type_different_chunks` | 3 | Shared type, different chunk IDs / listings |
| `one_path_empty` | 2 | **Same as true zero-result cases** |

### Overlap-present runs (5/16) — when shadow works

| Query theme | Mode | chunk | doc | entity |
|-------------|------|------:|----:|-------:|
| Pricing/revision changes | obo_owner | 4 | 4 | 13 |
| Notifications | obo_owner | 2 | 2 | 5 |
| Bidding/offer activity | default + obo_owner | 1–2 | 1–2 | 3–5 |
| Listing revisions / conversion | obo_owner | 2 | 2 | 5 |

Pattern: **`obo_helper` profile** or aligned source-type mix unlocks entity/doc overlap even when chunk overlap is low.

---

## 2. Zero-result root cause

| Case | Prompt / profile | Keyword refs | Shadow selected | Fetch attempted | Reason | Fix candidate |
|------|------------------|--------------|-----------------|-----------------|--------|---------------|
| Catalog week | `shadow_default` / `seller_sales_summary` | listing×6, revision×2 | **0** | Yes | `typed_pool_empty` — all typed + global fetches returned 0 rows; `primary=listing` | **D** rerank/global fallback; **C** source-type floor; **A** keyword-anchor; investigate HNSW+scoped fetch |
| Notifications | `shadow_default` / `seller_sales_summary` | obo×8 (keyword misses notification intent) | **0** | Yes | `typed_pool_empty` — `primary=notification` but pool empty; keyword used OBO only | **C** notification floor; **A** keyword-anchor; **B** entity expand from keyword `listing_id` |
| *(control)* | `shadow_obo_owner` / `obo_helper` | same prompts | **8** | Yes | `source_type_mismatch` (not zero) | Profile routing works; default path broken |

Labels applied:

- `profile_miss` — inferred `seller_sales_summary` fetch strategy underfills vs `obo_helper`
- `typed_pool_empty` — `candidate_count_raw=0` after fetch chain
- `keyword_only_source_type` — notification query; keyword returns obo only
- `not_exposed` — production keyword path unaffected

---

## 3. Overlap v2 principles

```text
1. Do not require exact chunk ID parity as the only gate.
2. Prefer document/entity overlap for semantically equivalent evidence.
3. Keep leakage/privacy filters identical or stricter.
4. Keep keyword production path unchanged.
5. Keep vector as shadow/canary only until T20.15 approval.
6. Existing overlap flags remain diagnostic-only unless a new gate explicitly promotes a safer v2 design.
```

Additional principles for G2:

- **Tag all remediations** in diagnostics (`zero_result_fallback`, `keyword_anchor_added`, `source_type_floor_applied`) so overlap gains are auditable and not confused with pure vector quality.
- **Never hide vector weakness** — fallback paths must record `fallback_reason`; vector-only scores remain in telemetry separately.
- **HNSW headroom** — cf p95 PASS gives room for modest fetch fanout (source-type floor, entity expansion) without re-opening latency gate.

---

## 4. Proposed overlap v2 options (ranked)

### Rank 1 — Option D: Rerank / empty-set fallback (recommended first in G2)

If `shadow_fetch_attempted` and `selected_count=0` after normal fetch+rerank:

1. Retry with **global untyped fetch** (bypass `scoped_first` early-exit) capped at `shadow_global_fetch_limit`.
2. If still empty, **keyword-anchor top-up** (up to K=2 chunks, privacy-checked).
3. Set `zero_result_reason` → `zero_result_fallback_applied` (not bare `zero_result_after_fetch`).

**Goal:** true zero-results **0/16** without production keyword changes.  
**Risk:** Low if tagged; may mask ANN+filter bugs — keep raw vector attempt metrics.

### Rank 2 — Option A: Keyword anchor top-up, shadow-only

After vector selection, top up shadow pool with up to **K=2** keyword chunk IDs (or top keyword documents) for overlap diagnostics only.

**Goal:** eliminate `one_path_empty`; improve doc/entity overlap on 11/16 band.  
**Risk:** Artificial chunk overlap if overused — require `keyword_anchor_added=true` and cap K.

### Rank 3 — Option C: Source-type floor by query intent

For `seller_sales_summary` when query matches notification/catalog/revision terms:

- Require **≥N=2** candidates from `primary_source_type` before accepting pool.
- If typed fetch underfills, force global fetch or secondary typed fetch (HNSW headroom supports this).

**Goal:** fix `typed_pool_empty` on notification/catalog without switching to `obo_helper`.  
**Risk:** modest cf increase; monitor in T20.14H.

### Rank 4 — Option B: Entity-aware candidate expansion v2

Extract `listing_id`, offer/listing bridges from keyword chunks; bounded sibling fetches (`SHADOW_ENTITY_LISTING_FETCH_LIMIT` pattern, extended).

**Goal:** doc/entity overlap without raw keyword injection; helps OBO/listing/revision relationships.  
**Risk:** privacy caps critical; may not fix zero-result without D/A.

### Rank 5 — Option E: Gate redefinition (required for T20.14H, not implementation)

Replace chunk-only blocker with composite gate (see §7). Chunk overlap remains reported for trend analysis.

---

## 5. Recommended implementation sequence

```text
T20.14G2 — implement shadow-only zero-result fallback + overlap telemetry v2
         (Option D + Option A minimum; Option C if zero-results persist)
T20.14G3 — implement entity-aware expansion v2 if doc/entity gates still fail after G2
T20.14H  — 5-run stability re-eval with HNSW (local/dev) + G2/G3
T20.15A  — canary plan only if T20.14H passes all gates
```

**G2 priority order:** D (zero-result) → A (anchor) → C (source floor) → telemetry fields.  
**Defer G3** unless entity/doc thresholds miss after G2 on 3-run smoke.

**HNSW note:** G2 implementation does **not** require new index work. T20.14H should run against the **same local/dev HNSW** baseline as F2; staging/prod index remains a separate ops approval.

---

## 6. T20.14G2 allowed scope

### Allowed

- Shadow/canary diagnostic code only (`retrieve_chunks_vector_shadow`, `shadow_profiles.py`, harness parsing)
- Zero-result fallback classification (`zero_result_fallback_applied`, `fallback_stage`)
- Keyword-anchor top-up in shadow results (`keyword_anchor_added`, `keyword_anchor_ids`)
- Doc/entity overlap metrics v2 (per-run thresholds in harness summary)
- Source-type floor in `seller_sales_summary` shadow profiles
- Tests in `test_t20_14d_shadow_embed_fetch.py` / `test_shadow_diagnostics.py` lineage
- Docs for G2 closeout

### Forbidden

- Production vector default (`AI_RAG_SHADOW_VECTOR=1` as default)
- Hybrid default
- Changing keyword production retrieval
- Default-on old overlap flags
- DB/index changes
- Embedding tranches
- T20.15

---

## 7. New rollout gate proposal (T20.14H)

All gates must pass on **5 consecutive warm runs** (`BENCH_REQUIRE_OLLAMA_WARM=1`, `BENCH_WARMUP_RUNS=1`).

| Gate | Required | F2 baseline |
|------|----------|-------------|
| HNSW candidate_fetch p95 | ≤1500 ms | **PASS** (557 / 205 / 532) |
| shadow p95 | ≤3000 ms across 5 runs | **PASS** (1494 / 376 / 1317) |
| embed timeouts | 0 | **PASS** |
| true zero-results | **0** | **FAIL** (2/16) |
| source diagnostic | PASS | **PASS** |
| doc overlap >0 | **≥10/16** per run | **FAIL** (5/16) |
| entity overlap >0 | **≥10/16** per run | **FAIL** (5/16) |
| chunk overlap | report-only (default/off); log flagged run separately | 11/16 zero |
| keyword product suites | PASS | **PASS** |
| leakage | PASS | **PASS** (0) |
| telemetry WARNs | 0 preferred | **PASS** |
| rollback plan | present (F2 + G2 env/index docs) | present |
| owner T20.15 approval | explicit | **not requested** |

**Stability rule:** No single run may exceed shadow p95 3000 ms or cf p95 1500 ms; embed timeouts 0 on all 5.

---

## 8. Prior art references

| Doc | Relevance |
|-----|-----------|
| T20.10AA | Deep dive on 11/16 zero chunk-overlap; complementary retrieval thesis |
| T20.10AB | Keyword-anchor + entity-hint proposal (Options A/B origin) |
| T20.10AG | Flagged overlap 8/16 stable; flags stay diagnostic/default-off |
| T20.13G | Latency/overlap triage; fetch-bound classification |
| T20.14B | Rollout gate template; overlap blocks T20.14H |
| T20.14F2 | HNSW latency PASS; overlap/zero-result FAIL state |

---

## 9. Final verdict

```text
T20.14G shadow overlap v2 design: COMPLETE
Implementation: NOT STARTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G2 shadow overlap v2 implementation, only if explicitly approved
```

**Stop line:** Do not start T20.14G2, T20.14H, or T20.15 without explicit approval.

---

## Artifacts (local only, not committed)

| Run | Report |
|-----|--------|
| F2 run 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-185845.md` |
| F2 run 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-185948.md` |
| F2 run 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-190020.md` |

JSONL companions: `185845.jsonl`, `185948.jsonl`, `190020.jsonl` (zero-result diagnostics extracted from `shadow_diagnostics.debug`).
