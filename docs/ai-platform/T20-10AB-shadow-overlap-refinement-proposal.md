# T20.10AB — Shadow overlap refinement proposal (design-only)

**Generated:** 2026-06-25  
**Baseline SHA:** `61a0bae` (T20.10AA shadow keyword overlap deep dive)  
**Mode:** design-only — no product behavior changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Status |
|------|--------|
| Vector rollout | **NOT APPROVED** |
| Keyword retrieval | **Production default** (unchanged) |
| `AI_RAG_SHADOW_VECTOR` | `0` (unchanged) |
| This ticket | **Design-only** — no code, DB, embedding, or index changes |
| Recommended next step | **T20.10AC** implementation — **approval required** before any code change |

T20.10W/T20.10Y restored shadow **source diversity** (6 types PASS) and improved **candidate_fetch** latency, but **chunk-level shadow–keyword overlap remains 11/16 zero** (FAIL). T20.10AA showed failures are **mostly complementary retrieval**, not leakage or empty shadow results. This proposal evaluates bounded shadow-only refinements that improve overlap parity **without** changing production keyword retrieval or enabling vector default.

---

## Current blockers (T20.10Z canonical)

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Embedded coverage | ≥15% or ≥10k embedded | **7.62%** (5,565 / 73,043) | **FAIL** |
| Shadow–keyword chunk overlap | meaningful overlap | **11/16 zero-overlap** | **FAIL** |
| Latency stability | shadow p95 ≤3,000 ms; embed p95 ≤2,000 ms | **2,839 / 950 ms** on run `215017` | **PASS**† |
| Source diversity (hinted union) | ≥5 types | **6 types** | **PASS** |
| Owner-visible OBO embedded | ≥10 | **18** | **PASS** |
| Leakage | 0 | **0** | **PASS** |
| Keyword stability | unchanged summaries/refs | contract PASS | **PASS** |

† Latency passes on T20.10Z canonical run; T20.10O/T20.10Y bad-variance runs failed p95 gates — treat as **conditionally passing**, not stable.

**Overlap and coverage remain rollout blockers** even if latency is acceptable on a single warm run.

---

## T20.10AA failure-class summary (11 zero-overlap runs)

T20.10AA audit classifications (mutually exclusive per zero-overlap row):

| Classification | Count | Rows | Root cause |
|----------------|------:|------|------------|
| `topup_diversity_not_overlap` | 4 | 1, 8, 9, 13 | T20.10Y diversity top-ups add `notification` / `listing_revision` / OBO slots; chunk IDs still differ from keyword lexical hits |
| `shadow_summary_vs_keyword_event_chunk` | 3 | 2, 4, 16 | OBO-profile shadow returns OBO-heavy mix; keyword returns listing-heavy or narrow event chunks |
| `source_type_mismatch` | 2 | 3, 5 | Keyword and shadow primary source-type mixes do not align (listing×8 vs OBO-heavy; obo×8 vs listing+revision) |
| `keyword_exact_match_vs_shadow_semantic` | 1 | 7 | Keyword includes revision chunks from lexical match; shadow listing monotype from semantic ranking |
| `same_source_type_different_chunks` | 1 | 15 | Both paths return `listing` but select different listing documents |

Built-in zero-overlap reasons (coarser, from overlap diagnostics):

| Reason | Count | Share |
|--------|------:|------:|
| `same_source_type_different_chunks` | 10 | 91% |
| `source_type_mismatch` | 1 | 9% |

**Key insight:** T20.10Y fixed the **type-union gate** (source diversity PASS) but not the **chunk-parity gate**. Entity overlap exists on **5/16** runs when profiles align; chunk overlap is flat vs T20.10J.

**Not relevance failures:** 0/16 zero-result shadow runs; leakage 0; keyword summaries/refs unchanged.

---

## Current shadow overlap machinery (reference)

For T20.10AC planning only — **no changes in T20.10AB.**

| Mechanism | Location | Effect today |
|-----------|----------|--------------|
| Route-weighted slot quotas | `shadow_profiles.py` + `_select_route_weighted_chunks` | Reserves OBO/revision/notification slots per profile |
| T20.10Y diversity top-ups | `_collect_route_mode_shadow_rows` | Adds missing source types to candidate pool |
| Keyword alignment boost (rerank) | `_apply_keyword_alignment_boost` in `rag_retrieval.py` | Multiplies scores for shadow rows matching keyword chunk/doc/entity keys — **only on fill slots after quotas** |
| Entity key extraction | `_entity_keys_for_chunk`, `_keyword_alignment_targets` | `listing_id`, `offer_id`, `source_type:source_id` bridges (T20.10K–N) |

Alignment boost today is **insufficient** because: (1) quota slots are filled before boost runs; (2) keyword anchor chunks may not be in the shadow candidate pool at all; (3) semantic neighbors on different listings score higher than boosted fill candidates.

---

## Options evaluated

### Option A — Entity-aware shadow hint expansion

**Intent:** Use existing entity metadata and aliases (`listing_id`, `offer_id`, `record_id`, `source_type:source_id`) to bias shadow **candidate acquisition and rerank** toward chunks attached to the same entities keyword retrieved.

**Proposed mechanics (shadow-only):**

1. After keyword retrieval (diagnostic path only), extract entity keys from top keyword chunks.
2. During shadow typed fetches or post-fetch pool merge, apply a **bounded entity filter or score boost** for rows sharing those keys.
3. Emit diagnostic fields: `entity_hint_keys`, `entity_hint_hits_in_pool`.

**Pros:**

- Targets entity overlap directly — addresses rows where metadata bridges exist but chunk IDs differ.
- Safer than keyword blending — does not inject keyword chunk IDs into production paths.
- Stays vector-shadow-only; keyword path untouched.

**Cons:**

- Depends on metadata quality (notification coverage still sparse at 7.62%).
- May improve entity overlap without chunk overlap if shadow selects different chunks on the same listing.
- Modest lift expected for `source_type_mismatch` rows (3, 5) where entity keys may not bridge across types.

---

### Option B — Keyword-anchor diagnostic blend

**Intent:** For shadow diagnostics only, include a small number of keyword-retrieved anchor chunk IDs or entity IDs **before** vector candidate selection (or force-include into pool pre-rerank).

**Proposed mechanics:**

1. Run keyword retrieval on shadow diagnostic requests (already done for overlap metrics).
2. Pin up to **K=2** keyword chunk IDs into shadow candidate pool (deduped, privacy-checked).
3. Label response `shadow_vector.keyword_anchor_blend=true`; never expose on production keyword responses.

**Pros:**

- Most likely to improve **chunk overlap** directly — addresses 11/16 zero-overlap band.
- Builds on existing `_keyword_alignment_targets` / alignment multiplier patterns.

**Cons:**

- **Highest risk of making shadow artificially close to keyword** — overlap metric may cease to measure independent retrieval quality.
- Must be strictly diagnostic-only and feature-flagged (`AI_RAG_SHADOW_KEYWORD_ANCHOR=0` default).
- Could mask semantic retrieval regressions if used as rollout gate input without a parallel unanchored shadow run.

---

### Option C — Same-entity neighbor expansion

**Intent:** When shadow retrieves a chunk for entity E, add up to **N** adjacent chunks from the same `document_id` (or same `listing_id` via metadata) before rerank.

**Proposed mechanics:**

1. After primary vector fetches, for each selected high-score row, fetch sibling chunks: `WHERE document_id = $doc ORDER BY chunk_index LIMIT N` (cap N=2 per entity, global cap 6 extra rows).
2. Merge into pool before `_select_route_weighted_chunks`.
3. Diagnostic: `neighbor_expansion_added`, `neighbor_expansion_ms`.

**Pros:**

- Directly helps `same_source_type_different_chunks` and row 7 (`keyword_exact_match_vs_shadow_semantic`) when keyword hits a revision chunk and shadow hits a different chunk on the same document.
- Preserves semantic retrieval for primary candidates; expansion is bounded.

**Cons:**

- Adds 1–2 SQL round-trips → **latency risk** on top of T20.10Y diversity top-ups.
- Neighbors may be low-signal filler if document chunking is coarse.
- Strict caps required to avoid pool bloat.

---

### Option D — Source-specific overlap top-ups

**Intent:** For known failure classes, add tiny typed fetches beyond T20.10Y diversity top-ups:

- OBO summary vs listing event chunks → extra `obo_offer_summary` fetch with entity filter
- `listing_revision` top-up when keyword returns revision-heavy mix
- `notification` top-up when query mentions notifications

**Pros:**

- Builds on proven T20.10Y pattern; low DB schema risk.
- Familiar implementation surface in `_collect_route_mode_shadow_rows`.

**Cons:**

- **T20.10AA showed top-ups improved diversity, not overlap** — rows 9, 13 still zero-overlap after T20.10Y.
- Additional fetches increase `candidate_fetch_ms` without guaranteed chunk parity.
- Risk of overfitting benchmark prompt wording.

**Stance:** Do **not** implement D alone for T20.10AC.

---

### Option E — No refinement; document complementary retrieval

**Intent:** Treat vector shadow as **complementary retrieval** by design. Keep overlap as a rollout blocker until embedded coverage improves and semantic corpus is richer.

**Pros:**

- Safest — no risk of artificial parity or latency regression.
- Avoids overfitting shadow to keyword on 16-prompt benchmark.
- Honest framing: keyword = lexical production path; shadow = semantic diagnostic path.

**Cons:**

- Does **not** clear overlap rollout gate.
- Vector default remains blocked indefinitely unless gate criteria are revised separately.

**Stance:** Keep as **fallback** if T20.10AC A+C show no measurable overlap lift without harming diversity or latency.

---

## Option comparison table

| Option | Expected overlap impact | Latency risk | Leakage risk | Implementation risk | Shadow-only? |
|--------|------------------------|--------------|--------------|---------------------|--------------|
| **A** Entity-aware hints | Medium entity; low–medium chunk | Low–medium | Low | Low–medium | **Yes** |
| **B** Keyword-anchor blend | **High** chunk | Low | Low (if privacy re-checked) | Medium — metric integrity | **Yes** (diagnostic flag) |
| **C** Neighbor expansion | Medium chunk (revision/listing docs) | Medium | Low | Medium | **Yes** |
| **D** Source-specific top-ups | **Low** (proven insufficient) | Medium–high | Low | Low | **Yes** |
| **E** No change | None | None | None | None | N/A |

---

## Recommended T20.10AC implementation scope

**Primary package: Option A + Option C** (shadow-only, behind feature flags defaulting off).

| Component | T20.10AC scope |
|-----------|----------------|
| **A1** Entity hint extraction from keyword chunks on shadow diagnostic requests | Include |
| **A2** Entity-key score boost on shadow pool rows (stronger than current fill-slot-only boost) | Include |
| **A3** Optional typed fetch filter: when keyword entity keys present, add `metadata->>'listing_id' = ANY(...)` clause to one typed fetch (bounded) | Include if EXPLAIN shows selective plan |
| **C1** Same-document neighbor expansion (N=2 per doc, global cap 6) post-fetch, pre-rerank | Include |
| **B** Keyword-anchor pin (K≤2 chunks) | **Defer** — implement only if A+C fail to reduce zero-overlap below gate threshold; must use `AI_RAG_SHADOW_KEYWORD_ANCHOR` flag and `keyword_anchor_blend` diagnostic |
| **D** Additional source-specific top-ups | **Exclude** as standalone work |
| **E** Complementary retrieval documentation | **Include** in T20.10AC doc if overlap gate still fails after A+C |

### Success criteria for T20.10AC (proposal — not yet approved)

| Metric | Target |
|--------|--------|
| Zero chunk-overlap | **≤8/16** (material improvement from 11/16) |
| Source diversity | **≥5 types** (no regression from 6) |
| entity-overlap >0 runs | **≥5/16** (maintain or improve) |
| Leakage | **0** |
| Keyword stability | **PASS** (unchanged) |
| shadow p95 (warmup=1) | **≤3,000 ms** on canonical harness |
| candidate_fetch p95 | **≤1,800 ms** (no major regression vs T20.10Z 1,478 ms) |

If A+C meet latency/diversity/leakage gates but overlap remains **>8/16 zero**, run a **diagnostic-only B experiment** (separate benchmark artifact, not rollout input) before revisiting gate criteria.

### Explicit non-goals (T20.10AC)

- No keyword retrieval changes
- No shadow route weight changes without separate approval
- No vector production default (`AI_RAG_SHADOW_VECTOR` remains `0`)
- No Phase 21
- No embedding backfill / tranche work (T20.12+)
- No metadata writes or reindex jobs
- No ANN index creation
- No API contract changes to production RAG responses

---

## Risk analysis

### Overlap metric integrity

**Medium for B; low for A+C.** Keyword-anchor blend (B) can inflate overlap without improving independent semantic quality. Mitigation: separate diagnostic flag; report anchored vs unanchored overlap in benchmark summary.

### Source diversity regression

**Low for A+C.** Neighbor expansion adds chunks within existing source types. Entity hints should not remove T20.10Y diversity top-ups. Mitigation: run `rp-ai-shadow-source-diagnostic.sh`; fail if union types <5.

### Latency regression

**Medium.** Neighbor expansion and entity-filtered typed fetches add SQL round-trips. Mitigation: hard caps (≤6 neighbor rows, ≤1 entity-filtered fetch per request); compare `candidate_fetch_ms` p95 on embed-cache-hit runs.

### Leakage

**Low.** All expansions reuse existing `_chunk_passes_privacy` and scope filters. Keyword-pinned chunks must pass the same privacy gate as keyword path. Mitigation: leakage diagnostic + contract audit.

### Keyword stability

**None** if shadow-only flags remain off by default and keyword code paths are untouched. Mitigation: `audit-rp-ai-rag-contract.sh` on every validation run.

---

## Validation plan (for T20.10AC implementation)

T20.10AB is docs-only. When refinements are implemented:

| Gate | Command / artifact | Pass criteria |
|------|-------------------|---------------|
| T20.10T benchmark | `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh` | Zero-overlap ≤8/16; p95 within thresholds; per-run `chunk_ov`, `entity_ov`, `reason` recorded |
| T20.10Z readiness re-run | Manual comparison to T20.10Z table | Coverage/overlap/diversity/latency documented; vector verdict unchanged unless all gates pass |
| RAG contract | `bash scripts/audit-rp-ai-rag-contract.sh` | PASS |
| Source diagnostic | `bash scripts/rp-ai-shadow-source-diagnostic.sh` | PASS — ≥5 types, no leakage |
| Quality smoke | `bash scripts/rp-ai-rag-quality-smoke.sh` | PASS |
| RP scan | `bash scripts/rp-rp-decontaminate-scan.sh` | PASS |
| Unit tests | `pytest services/python-ai-service/tests/test_shadow_fetch_strategy.py` + new overlap tests | PASS |

Do **not** commit `bench_logs/`, screenshots, or coverage artifacts.

---

## Rollback plan

| Scenario | Action |
|----------|--------|
| Overlap regression (zero-overlap >11/16) | Disable `AI_RAG_SHADOW_ENTITY_HINTS` / `AI_RAG_SHADOW_NEIGHBOR_EXPAND` flags; revert T20.10AC commits |
| Diversity regression (<5 types) | Revert T20.10AC; preserve T20.10Y top-ups |
| Latency regression (shadow p95 >3,000 ms sustained) | Revert neighbor expansion first; then entity hints if needed |
| Leakage or keyword stability failure | **Immediate revert** of T20.10AC; re-run contract audit |
| Keyword-anchor experiment (B) pollutes metrics | Disable `AI_RAG_SHADOW_KEYWORD_ANCHOR`; exclude anchored runs from rollout gate |

Rollback is **code + env flag revert** — no DB migration or embedding rollback required.

---

## Follow-up tickets

| Ticket | Scope | Gate |
|--------|-------|------|
| **T20.10AC** | Implement A+C shadow-only overlap refinements | **Explicit approval required** — do not start until this proposal is reviewed |
| **T20.10AD** (suggested) | Diagnostic-only keyword-anchor experiment (Option B) | Only if T20.10AC insufficient; never production default |
| **T20.12+** | Bounded embedding tranche | Separate approval; addresses coverage blocker |
| **T20.14/15** | Vector rollout | Blocked until coverage + overlap + stable latency pass |

**Do not implement T20.10AC until this proposal is reviewed and approved.**

---

## Definition of done (T20.10AB)

- [x] Proposal document exists
- [x] Options A–E evaluated
- [x] T20.10AC implementation scope explicit
- [x] No product behavior changed
- [x] No retrieval code changed
- [x] Vector rollout remains NOT APPROVED

## Files changed

- `docs/ai-platform/T20-10AB-shadow-overlap-refinement-proposal.md` (this document)

## Validation (this ticket)

```bash
git status --short
bash scripts/rp-rp-decontaminate-scan.sh
```

**Vector rollout: NOT APPROVED**
