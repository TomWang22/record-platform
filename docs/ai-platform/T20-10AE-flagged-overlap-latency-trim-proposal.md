# T20.10AE — Flagged overlap latency-trim proposal (design-only)

**Generated:** 2026-06-25  
**Baseline SHA:** `0f42c06` (T20.10AD flagged overlap refinement evaluation)  
**Mode:** design-only — no product behavior changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Status |
|------|--------|
| Vector rollout | **NOT APPROVED** |
| Keyword retrieval | **Production default** (unchanged) |
| `AI_RAG_SHADOW_VECTOR` | `0` (unchanged) |
| Overlap flags | **`AI_RAG_SHADOW_ENTITY_HINTS=0`**, **`AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`** — remain default off |
| This ticket | **Design-only** — no code, flag default, or deployment changes |
| Recommended next step | **T20.10AF** implementation — **approval required** before any code change |

T20.10AD confirmed T20.10AC Option A+C are **diagnostically useful** (overlap **11/16 → 8/16** zero) but **latency is unstable** when flagged (T20.10AC cf p95 **2,535 ms**, shadow p95 **5,462 ms** vs T20.10AD cf **1,075 ms**, shadow **2,335 ms** on the same 8/16 overlap). This proposal defines **bounded latency trims** for flagged diagnostic mode only — not rollout promotion.

---

## T20.10AD metric recap

| Metric | Default/off | Flagged/on | Notes |
|--------|------------:|-----------:|-------|
| zero chunk-overlap | **11/16** | **8/16** | repeatable improvement |
| doc-overlap >0 | **5/16** | **8/16** | +3 |
| entity-overlap >0 | **5/16** | **8/16** | +3 |
| source diversity | **6** | **6** | PASS |
| candidate_fetch p95 | **1,206 ms** | **1,075 ms** | T20.10AD; T20.10AC flagged **2,535 ms** |
| shadow p95 | **2,354 ms** | **2,335 ms** | T20.10AD; T20.10AC flagged **5,462 ms** |
| leakage | **0** | **0** | PASS |
| keyword contract | **PASS** | **PASS** | stable |
| zero-result shadow | **0/16** | **0/16** | safe |

**Remaining flagged zero-overlap:** all **8** runs are `same_source_type_different_chunks` (no `source_type_mismatch`).

**Rollout blockers unchanged:** coverage **7.62% FAIL**, overlap **FAIL** even flagged, latency stability **FAIL / borderline**.

---

## Latency risk explanation

### Where flagged cost comes from (T20.10AC reference)

When both flags are on and `shadow_debug=1` supplies keyword chunks, `_apply_shadow_overlap_refinements()` in `rag_retrieval.py` may add:

| Step | SQL cost | Current bounds |
|------|----------|----------------|
| **A3** listing_id typed fetch | 1 vector sort + metadata filter | ≤5 listing IDs, limit 8 |
| **A2** entity score boost | in-memory only | 1.5× multiplier |
| **C1** neighbor expansion | up to 4 sequential fetches | 4 docs × (≤3 rows query), global cap 6 |

These run **after** T20.10W/Y route-mode fetches (scoped-first + diversity top-ups). `candidate_fetch_ms` in diagnostics includes **all** fetch work in the refinement window.

### Why latency is unstable

1. **Ollama embed variance** — shadow p95 includes embed; cold/warm swings dominate some runs (T20.10AC embed outlier on revision prompt).
2. **Neighbor fetch fanout** — worst case: 4 documents × 1 round-trip each when expansion runs unconditionally.
3. **Entity listing fetch** — always runs when entity hints on and listing IDs exist, even if boost already aligned pool.
4. **No ANN index** — each extra typed/vector fetch is exact-sort bound (T20.10U).

Flagged mode must stay **diagnostic-only** until overlap **and** latency gates pass on **multiple** warm runs — not a single good T20.10AD sample.

---

## Current T20.10AC constants (reference for trims)

From `shadow_profiles.py` (implementation planning only):

| Constant | Value |
|----------|------:|
| `SHADOW_NEIGHBOR_PER_DOC` | 2 |
| `SHADOW_NEIGHBOR_GLOBAL_CAP` | 6 |
| `SHADOW_NEIGHBOR_DOCS_CONSIDERED` | 4 |
| `SHADOW_ENTITY_LISTING_FETCH_LIMIT` | 8 |
| `SHADOW_ENTITY_LISTING_ID_CAP` | 5 |
| `SHADOW_ENTITY_HINT_SCORE_MULTIPLIER` | 1.5 |

---

## Options evaluated

### Option A — Gate neighbor expansion by entity-hit confidence

**Intent:** Run C1 neighbor expansion only when entity hints (A1/A2) already matched **≥1** candidate row in the pool (`entity_boosted_rows > 0` or `entity_overlap_before > 0`).

**Mechanics (proposed):**

```text
if AI_RAG_SHADOW_NEIGHBOR_EXPANSION and entity_overlap_before >= 1:
    expand neighbors
else:
    skip; diag neighbor_expansion_skipped_reason=low_entity_confidence
```

**Pros:** Skips 0–4 SQL round-trips when keyword entity keys do not bridge to shadow pool — common on pure listing-divergence failures. Preserves expansion on runs where entity alignment already works.

**Cons:** May skip neighbors on runs where expansion would help without prior entity match (rare per T20.10AD — failures are same-type different-chunk).

---

### Option B — Reduce neighbor expansion caps

**Intent:** Lower C1 fanout while keeping expansion enabled.

**Proposed test values:**

| Parameter | T20.10AC | T20.10AF proposal |
|-----------|----------|-------------------|
| per-doc limit | 2 | **1** |
| global cap | 6 | **3** |
| docs considered | 4 | **3** |

**Pros:** Direct reduction in worst-case SQL calls and pool merge work. Simple to tune and test.

**Cons:** May lose 0–1 overlap runs if neighbors were the sole doc-overlap bridge. T20.10AD suggests doc/entity gains are partly from entity fetch + boost, not neighbors alone — risk is **low–medium**.

---

### Option C — Skip listing_id typed fetch when entity boost suffices

**Intent:** Skip A3 `_fetch_listing_entity_hint_rows` when `entity_boosted_rows >= K` (proposed **K=2**) or `entity_overlap_before >= 1` before fetch.

**Mechanics:**

```text
if entity_boosted_rows < K and entity_overlap_before == 0:
    run listing_id typed fetch
else:
    skip; diag entity_listing_fetch_skipped=sufficient_boost
```

**Pros:** Removes one vector-sort query on runs where rerank boost already surfaces entity-aligned rows. Listing fetch is the heavier refinement step when listing IDs are abundant.

**Cons:** Listing-driven prompts that relied on fetch (not boost) for overlap may regress toward 9/16 zero-overlap. Mitigate with conservative K and benchmark compare.

---

### Option D — Query-class selective flags

**Intent:** Apply flagged refinements only for query classes that gained overlap in T20.10AD (OBO/negotiation, revision, notifications); skip for catalog/listing-heavy prompts where failures remain pure `same_source_type_different_chunks`.

**Pros:** Targets latency spend where overlap improved; avoids work on hopeless classes.

**Cons:** **Higher implementation risk** — query-class routing duplicates profile logic; benchmark harness may not generalize; harder to reason about leakage and diversity per class. Better as **second-phase** trim if A+B+C insufficient.

---

### Option E — Keep A+C as diagnostic-only with no trim

**Intent:** Document current flagged behavior; accept latency variance; use flags only for manual benchmark investigations.

**Pros:** Zero implementation risk; overlap gain already proven at 8/16.

**Cons:** Does not address T20.10AC latency regression band; flagged runs remain unreliable for gate evidence; does not improve path toward stable diagnostic harness.

---

## Option comparison table

| Option | Overlap risk | Latency benefit | Leakage risk | Implementation risk | Default-off compatible |
|--------|--------------|-----------------|--------------|---------------------|------------------------|
| **A** Entity-gated neighbors | Low | **Medium–high** (skip 0–4 fetches) | Low | Low | **Yes** |
| **B** Reduced caps | Low–medium | **Medium** (fewer rows/fetches) | Low | **Low** | **Yes** |
| **C** Conditional listing fetch | Medium | **Medium** (skip 1 fetch) | Low | Low–medium | **Yes** |
| **D** Query-class selective | Medium | Medium | Low | **High** | Yes (still flag-gated) |
| **E** No trim | None | None | None | None | Yes |

---

## Recommended design stance

**Propose A + B + C for T20.10AF approval.** Keep **D deferred**. Keep **E** as fallback if T20.10AF cannot hold 8/16 overlap with improved p95.

| Option | T20.10AF stance |
|--------|-----------------|
| **A** — Entity-gated neighbor expansion | **Include** |
| **B** — Reduced neighbor caps (1/doc, 3 global, 3 docs) | **Include** |
| **C** — Skip listing fetch when boost sufficient (K=2) | **Include** |
| **D** — Query-class selective flags | **Defer** unless A+B+C fail latency targets |
| **E** — No trim | **Fallback** documentation only |

**Explicitly excluded from T20.10AF:**

- Keyword-anchor pinning (T20.10AB Option B)
- Default-on flags or production shadow behavior change
- Vector rollout / `AI_RAG_SHADOW_VECTOR=1`
- Keyword retrieval changes
- ANN index / embedding / metadata writes

---

## Recommended T20.10AF implementation scope

All changes **only when** `AI_RAG_SHADOW_ENTITY_HINTS=1` and/or `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1` — default-off path **must remain byte-identical in behavior** to T20.10AC with flags off.

### AF1 — Entity-gated neighbor expansion (Option A)

- Add precondition: `entity_overlap_before >= 1` OR `entity_boosted_rows >= 1` before `_expand_shadow_neighbor_rows`.
- Diagnostic: `neighbor_expansion_skipped`, `neighbor_expansion_skip_reason`.

### AF2 — Reduced neighbor caps (Option B)

- Update `shadow_profiles.py` constants (flagged path only or new `SHADOW_NEIGHBOR_*_TRIM` constants):
  - `SHADOW_NEIGHBOR_PER_DOC = 1`
  - `SHADOW_NEIGHBOR_GLOBAL_CAP = 3`
  - `SHADOW_NEIGHBOR_DOCS_CONSIDERED = 3`

### AF3 — Conditional listing fetch (Option C)

- Skip `_fetch_listing_entity_hint_rows` when `entity_boosted_rows >= 2` before fetch **or** `entity_overlap_before >= 1`.
- Diagnostic: `entity_listing_fetch_skipped`, `entity_listing_fetch_skip_reason`.

### AF4 — Diagnostics and tests

- Extend `shadow_diagnostics.debug` with skip reasons and pre-trim pool metrics.
- Unit tests: gate logic, cap enforcement, skip paths, default-off unchanged.
- No changes to `insights.py` keyword path or API response shape for production (`shadow_debug=0`).

### Success criteria (T20.10AF validation)

| Gate | Target |
|------|--------|
| zero chunk-overlap (flagged) | **≤8/16** (hold T20.10AD gain) |
| doc-overlap >0 (flagged) | **≥8/16** |
| entity-overlap >0 (flagged) | **≥8/16** |
| source diversity | **≥5 types** |
| leakage | **0** |
| keyword contracts | **PASS** |
| candidate_fetch p95 (flagged, warmup=1) | **≤1,500 ms** |
| shadow p95 (flagged, warmup=1) | **≤3,000 ms** when embed variance allows |
| default/off overlap | **11/16** unchanged |
| default/off latency | no regression vs T20.10AD default run |

Require **two** flagged warm runs: one must match T20.10AD overlap; neither may exceed cf p95 **1,800 ms** or shadow p95 **3,500 ms** without documented embed outlier.

---

## Explicit non-goals

- No vector production default / rollout approval
- No keyword retrieval or ranking changes
- No Phase 21
- No embedding backfill or tranche work (T20.12+)
- No metadata writes or reindex jobs
- No ANN index creation
- No API contract changes
- No default-on overlap flags in committed config
- No keyword-anchor diagnostic blend without separate approval ticket

---

## Validation plan (for T20.10AF implementation)

T20.10AE is docs-only. When trims are implemented:

| Gate | Command | Pass criteria |
|------|---------|---------------|
| Default/off benchmark | `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh` | 11/16 zero-overlap; cf/shadow p95 within T20.10AD default band |
| Flagged/on benchmark | Set deployment `AI_RAG_SHADOW_ENTITY_HINTS=1` `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1`; same harness | ≤8/16 zero; cf p95 ≤1,500 ms target |
| Reset flags | `kubectl set env ... AI_RAG_SHADOW_*=0` | deployment default off after run |
| Source diagnostic | `bash scripts/rp-ai-shadow-source-diagnostic.sh` | ≥5 types, 0 leakage |
| RAG contract | `bash scripts/audit-rp-ai-rag-contract.sh` | PASS |
| Unit tests | `pytest services/python-ai-service/tests/test_shadow_overlap_refinement.py` | PASS + new trim cases |
| Coverage | `bash scripts/coverage/run-service-coverage.sh python-ai-service` | ≥90% `app/ai` |
| OCH scan | `bash scripts/rp-och-decontaminate-scan.sh` | PASS |

Do **not** commit `bench_logs/`.

---

## Rollback plan

| Scenario | Action |
|----------|--------|
| Overlap regression (flagged >8/16 zero) | Revert T20.10AF; restore T20.10AC constants |
| Default/off overlap or latency regression | **Immediate revert** of T20.10AF |
| Latency still unstable after trim | Keep flags off; document E stance; consider T20.16 context refresh instead of D |
| Leakage or keyword failure | Revert T20.10AF; re-run contract audit |

Rollback is code revert + flag reset — no DB migration.

---

## Follow-up tickets

| Ticket | Scope | Gate |
|--------|-------|------|
| **T20.10AF** | Implement A+B+C latency trims (flagged path only) | **Explicit approval required** |
| **T20.10AG** (suggested) | Option D query-class selective flags | Only if T20.10AF misses latency targets |
| **T20.16** | Phase 20 copilot context refresh | Alternative if stopping shadow tuning branch |

**Do not implement T20.10AF until this proposal is reviewed and approved.**

---

## Definition of done (T20.10AE)

- [x] Proposal document exists
- [x] Options A–E evaluated
- [x] T20.10AF implementation scope explicit
- [x] No product behavior changed
- [x] Flags remain default off
- [x] Vector rollout remains NOT APPROVED

## Validation (this ticket)

```bash
git status --short
bash scripts/rp-och-decontaminate-scan.sh
```

**Vector rollout: NOT APPROVED**
