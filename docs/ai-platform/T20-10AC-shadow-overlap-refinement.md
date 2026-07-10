# T20.10AC — Shadow overlap refinement implementation

**Generated:** 2026-06-25  
**Baseline SHA:** `692b28e` (T20.10AB shadow overlap refinement proposal)  
**Implementation SHA:** see commit `chore(ai): add flagged shadow overlap refinements`  
**Mode:** shadow-only diagnostic flags (default off)  
**Vector rollout:** NOT APPROVED

## Executive verdict

Implemented **T20.10AB Option A + C** behind default-off environment flags. **Production behavior is unchanged** when flags are off (`AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`). Keyword retrieval, vector default, and API contracts are untouched.

Flagged diagnostic mode on the T20.10T harness **improved chunk overlap from 11/16 to 8/16 zero-overlap** (meets T20.10AC proposal target ≤8/16). This is a **diagnostic-only** improvement — it does **not** approve vector rollout. Coverage and latency gates remain mixed on this run.

---

## Flags added (default off)

| Flag | Default | Purpose |
|------|---------|---------|
| `AI_RAG_SHADOW_ENTITY_HINTS` | `0` | A1/A2/A3 — entity key extraction, score boost, optional listing_id typed fetch |
| `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` | `0` | C1 — same-document neighbor expansion (≤2 per doc, ≤6 global) |

Both are read in `app/ai/config.py` at process start. **No production default-on change.**

---

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/config.py` | Default-off diagnostic flags |
| `services/python-ai-service/app/ai/shadow_profiles.py` | T20.10AC caps/constants |
| `services/python-ai-service/app/ai/rag_retrieval.py` | Entity hints, listing fetch, neighbor expansion, diagnostics |
| `services/python-ai-service/tests/test_shadow_overlap_refinement.py` | Unit tests (17 cases) |
| `scripts/rp-ai-shadow-real-query-timing.sh` | Echo when overlap flags set in client env (server env required for effect) |
| `docs/ai-platform/T20-10AC-shadow-overlap-refinement.md` | This document |

---

## Implementation summary

### A1 — Entity hint extraction

- `extract_keyword_entity_hint_keys()` collects safe metadata keys from keyword chunks passed on `shadow_debug=1` paths.
- Fields: `listing_id`, `record_id`, `offer_id`, `obo_offer_id`, `auction_id`, `bid_id`, plus `source_type:source_id` aliases.
- No message body inspection; privacy filters unchanged.

### A2 — Entity-key score boost

- `_apply_entity_hint_score_boost()` multiplies candidate scores by `1.5` when entity keys intersect keyword hints.
- Applied to shadow candidate pool only when `AI_RAG_SHADOW_ENTITY_HINTS=1`.
- Diagnostics: `entity_hints_enabled`, `entity_hint_keys_count`, `entity_boosted_rows`, `entity_overlap_before`, `entity_overlap_after`.

### A3 — Listing entity-filtered typed fetch

- One bounded fetch: `metadata->>'listing_id' = ANY(...)` with ≤5 listing IDs, limit 8 rows.
- Runs only when entity hints flag on, keyword chunks present, and `query_vec` available.
- Diagnostics: `entity_listing_fetch_run`, `entity_listing_fetch_rows`.

### C1 — Same-document neighbor expansion

- After vector fetch, before rerank: up to 4 top documents, ≤2 neighbors each, ≤6 neighbors total.
- Privacy filter applied to neighbors; dedupe by chunk id.
- Diagnostics: `neighbor_expansion_enabled`, `neighbor_docs_considered`, `neighbor_rows_added`, `candidate_pool_before_neighbors`, `candidate_pool_after_neighbors`.

### Not implemented (per T20.10AB)

- Keyword-anchor pinning (Option B)
- Additional source-specific top-ups beyond T20.10Y (Option D)
- Vector rollout / production default changes

---

## Validation — default/off (flags `0` on deployment)

**Artifact:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-232242.md` (local, not committed)

| Gate | Result |
|------|--------|
| Zero chunk-overlap | **11/16** (unchanged vs T20.10Z) |
| doc-overlap >0 | **5/16** |
| entity-overlap >0 | **5/16** |
| zero-result shadow | **0/16** |
| Source diversity (T19.6C) | **6 types PASS** |
| OBO owner-visible | **18 PASS** |
| Leakage | **0 PASS** |
| Keyword / RAG contract | **PASS** |
| shadow p95 | **3,689 ms** (warmup=1) |
| candidate_fetch p95 | **844 ms** |
| Unit tests | **153 passed** |
| Coverage (`app/ai`) | **90.08% PASS** |
| OCH scan | **PASS** |

**Conclusion:** Default-off behavior preserved; overlap distribution matches pre-T20.10AC baseline.

---

## Validation — flagged/on (deployment `AI_RAG_SHADOW_ENTITY_HINTS=1`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1`)

**Artifact:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-234051.md` (local, not committed)

| Gate | T20.10AC target | Result |
|------|-----------------|--------|
| Zero chunk-overlap | ≤8/16 | **8/16** ✅ |
| doc-overlap >0 | improve | **8/16** (was 5/16 default) |
| entity-overlap >0 | maintain/improve | **8/16** (was 5/16 default) |
| Source diversity | ≥5 | **6 types PASS** |
| Leakage | 0 | **0 PASS** |
| zero-result shadow | 0 | **0/16** |
| Keyword / RAG contract | PASS | **PASS** |
| candidate_fetch p95 | ≤1,800 ms | **2,535 ms** ⚠️ (run variance; neighbor + entity fetch cost) |
| shadow p95 | ≤3,000 ms | **5,462 ms** ⚠️ (embed outlier on one prompt) |
| embed p95 | — | **2,734 ms** |

### Overlap before/after (shadow runs only)

| Metric | Default/off | Flagged/on | Delta |
|--------|------------:|-----------:|------:|
| Zero chunk-overlap | 11/16 | **8/16** | **−3** |
| doc-overlap >0 | 5/16 | **8/16** | **+3** |
| entity-overlap >0 | 5/16 | **8/16** | **+3** |
| zero-result | 0/16 | 0/16 | 0 |

### Zero-overlap reasons (flagged)

| Reason | Count |
|--------|------:|
| `same_source_type_different_chunks` | 8 |

All remaining zero-overlap runs are same-type different-chunk (no `source_type_mismatch` on this run).

---

## Rollback plan

| Scenario | Action |
|----------|--------|
| Flagged mode causes errors | Set `AI_RAG_SHADOW_ENTITY_HINTS=0` and `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`; rollout restart |
| Overlap/diversity regression with flags off | Revert T20.10AC code commit; redeploy prior image |
| Latency regression | Disable neighbor expansion first; then entity hints |
| Keyword or leakage regression | Immediate code revert + contract re-audit |

Deployment flags were reset to **`0`** after flagged benchmark. Production path remains default-off.

---

## Recommended next ticket

**T20.10AD** — Read-only flagged overlap refinement evaluation (compare flagged artifacts to T20.10Z/T20.10AA; no code changes).

Do **not** enable flags by default, proceed to vector rollout, or start embedding tranches without explicit approval.

---

## Definition of done (T20.10AC)

- [x] Option A + C implemented behind default-off flags
- [x] Default/off benchmark shows unchanged 11/16 overlap
- [x] Flagged/on benchmark measured (8/16 zero-overlap)
- [x] Unit tests and coverage gate pass
- [x] No generated artifacts committed
- [x] Vector rollout remains NOT APPROVED

**Vector rollout: NOT APPROVED**
