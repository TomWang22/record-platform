# T20.10AF — Flagged shadow overlap latency trims

**Generated:** 2026-06-25  
**Baseline SHA:** `8468921` (T20.10AE flagged overlap latency-trim proposal)  
**Implementation SHA:** `ebda2ae` (`chore(ai): trim flagged shadow overlap latency`)  
**Mode:** flagged-path-only latency trims — flags remain default off  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Verdict |
|------|---------|
| Vector rollout | **NOT APPROVED** |
| AF1 entity-gated neighbor expansion | **Implemented** |
| AF2 reduced neighbor caps | **Implemented** |
| AF3 conditional listing_id fetch | **Implemented** |
| AF4 tests + diagnostics | **Implemented** |
| Default/off behavior | **Unchanged** — **11/16** zero-overlap |
| Flagged/on overlap | **Preserved** — **8/16** zero-overlap (both runs) |
| Latency | **Run-dependent** — run 1 missed gates (embed variance); run 2 PASS |

T20.10AE **AF1 + AF2 + AF3 + AF4** are implemented behind the same default-off flags as T20.10AC. Overlap improvement (**11/16 → 8/16**) is **repeatable** on two flagged warm runs. Latency remains **embed-variance sensitive** — one flagged run exceeded shadow/candidate_fetch p95 targets; a second warm run met both. This does **not** change the rollout verdict.

---

## Flags (default off, unchanged)

| Flag | Default | Purpose |
|------|---------|---------|
| `AI_RAG_SHADOW_ENTITY_HINTS` | `0` | Entity key extraction, score boost, conditional listing_id typed fetch (AF3) |
| `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` | `0` | Entity-gated neighbor expansion (AF1) with AF2 caps |

Read at process start in `app/ai/config.py`. Deployment reset to `0/0` after diagnostic runs.

---

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/shadow_profiles.py` | AF2 — neighbor caps 1/doc, 3 global, 3 docs |
| `services/python-ai-service/app/ai/rag_retrieval.py` | AF1 entity-gated neighbor expansion; AF3 conditional listing fetch; new diagnostics |
| `services/python-ai-service/tests/test_shadow_overlap_refinement.py` | AF4 — 22 tests including latency-trim cases |
| `docs/ai-platform/T20-10AF-flagged-overlap-latency-trim.md` | This document |

**Not changed:** `config.py`, keyword retrieval, `AI_RAG_SHADOW_VECTOR`, API contracts, embeddings, metadata, DB/index.

---

## Implementation summary

### AF1 — Entity-gated neighbor expansion

Neighbor expansion runs only when entity alignment is already present:

```text
if entity_overlap_before >= 1 or entity_boosted_rows >= 1:
    run neighbor expansion
else:
    skip neighbor expansion (reason: low_entity_confidence)
```

Diagnostics: `neighbor_expansion_skipped`, `neighbor_expansion_skip_reason`, `entity_overlap_before`, `entity_boosted_rows`.

### AF2 — Reduced neighbor caps (flagged path only)

| Constant | T20.10AC | T20.10AF |
|----------|----------|----------|
| `SHADOW_NEIGHBOR_PER_DOC` | 2 | **1** |
| `SHADOW_NEIGHBOR_GLOBAL_CAP` | 6 | **3** |
| `SHADOW_NEIGHBOR_DOCS_CONSIDERED` | 4 | **3** |

### AF3 — Conditional listing_id typed fetch

Skip listing entity fetch when entity boost is already sufficient:

```text
if entity_boosted_rows >= 2 or entity_overlap_before >= 1:
    skip listing_id typed fetch (reason: sufficient_entity_boost)
else:
    run bounded listing_id typed fetch
```

Diagnostics: `entity_listing_fetch_skipped`, `entity_listing_fetch_skip_reason`.

### AF4 — Tests

| # | Case | Status |
|---|------|--------|
| 1 | Flags default off | PASS |
| 2 | Default/off path unchanged | PASS |
| 3 | Neighbor skips when entity confidence zero | PASS |
| 4 | Neighbor runs when entity overlap exists | PASS |
| 5 | Neighbor caps 1/doc, 3 global, 3 docs | PASS |
| 6 | Listing fetch skips when `entity_boosted_rows >= 2` | PASS |
| 7 | Listing fetch skips when `entity_overlap_before >= 1` | PASS |
| 8 | Listing fetch runs when entity confidence absent | PASS |
| 9 | Keyword retrieval path untouched | PASS |
| 10 | Leakage/privacy filters on neighbors | PASS |

---

## Benchmark — default/off (deployment flags `0/0`)

**Harness:** `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1`  
**Artifact (local, not committed):** `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-104855.md`

| Metric | T20.10AD default | T20.10AF default | Gate |
|--------|------------------:|-----------------:|------|
| zero chunk-overlap | 11/16 | **11/16** | PASS (unchanged) |
| doc-overlap >0 | 5/16 | **5/16** | — |
| entity-overlap >0 | 5/16 | **5/16** | — |
| zero-result shadow | 0/16 | **0/16** | PASS |
| candidate_fetch p95 | 1,206 ms | **1,227 ms** | PASS (≤1,500 ms) |
| shadow p95 | 2,354 ms | **2,499 ms** | PASS (≤3,000 ms) |
| embed p95 | 1,182 ms | **1,265 ms** | run variance |

**Conclusion:** Default/off overlap and keyword behavior unchanged vs T20.10AD baseline.

---

## Benchmark — flagged/on run 1 (deployment `1/1`)

**Artifact (local, not committed):** `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-105150.md`

| Metric | T20.10AD flagged | T20.10AF run 1 | Gate |
|--------|------------------:|---------------:|------|
| zero chunk-overlap | 8/16 | **8/16** | PASS (≤8/16) |
| doc-overlap >0 | 8/16 | **8/16** | PASS (≥8/16) |
| entity-overlap >0 | 8/16 | **8/16** | PASS (≥8/16) |
| candidate_fetch p95 | 1,075 ms | **4,491 ms** | **MISS** (embed + fetch variance) |
| shadow p95 | 2,335 ms | **7,516 ms** | **MISS** (embed p95 **3,371 ms**) |
| embed p95 | 1,282 ms | **3,371 ms** | cold/warm swing |

**Note:** Overlap preserved; latency miss driven primarily by embed variance on this run — **not** treated as rollout rejection beyond existing NOT APPROVED verdict.

---

## Benchmark — flagged/on run 2 (deployment `1/1`)

**Artifact (local, not committed):** `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-105421.md`

| Metric | T20.10AD flagged | T20.10AF run 2 | Gate |
|--------|------------------:|---------------:|------|
| zero chunk-overlap | 8/16 | **8/16** | PASS |
| doc-overlap >0 | 8/16 | **8/16** | PASS |
| entity-overlap >0 | 8/16 | **8/16** | PASS |
| candidate_fetch p95 | 1,075 ms | **1,244 ms** | PASS |
| shadow p95 | 2,335 ms | **1,412 ms** | PASS |
| embed p95 | 1,282 ms | **6 ms** | warm cache |

**Conclusion:** AF trims preserve **8/16** overlap; warm flagged run meets latency targets.

---

## Overlap before/after (T20.10AF)

| Mode | zero-overlap | doc-overlap >0 | entity-overlap >0 |
|------|-------------:|---------------:|------------------:|
| Default/off (pre & post AF) | **11/16** | **5/16** | **5/16** |
| Flagged/on run 1 | **8/16** | **8/16** | **8/16** |
| Flagged/on run 2 | **8/16** | **8/16** | **8/16** |

Remaining flagged zero-overlap: all **`same_source_type_different_chunks`**.

---

## Latency before/after (flagged)

| Run | candidate_fetch p95 | shadow p95 | embed p95 |
|-----|--------------------:|-----------:|----------:|
| T20.10AD flagged | 1,075 ms | 2,335 ms | 1,282 ms |
| T20.10AF run 1 | 4,491 ms | 7,516 ms | 3,371 ms |
| T20.10AF run 2 | 1,244 ms | 1,412 ms | 6 ms |

AF2/AF3 reduce worst-case fetch fanout; embed variance still dominates single-run p95.

---

## Source diversity, leakage, keyword stability

| Check | Result |
|-------|--------|
| Source diversity (T19.6C weighted types) | **6** — PASS (≥5) |
| OBO owner-visible | **18** — PASS |
| Leakage (T19.6C) | **0 issues** — PASS |
| RAG ingestion contract | **PASS** |
| Phase 17 quality smoke | **PASS** |
| Keyword retrieval default | **unchanged** |
| `AI_RAG_SHADOW_VECTOR` | **`0`** |

---

## pytest / coverage

| Check | Result |
|-------|--------|
| `test_shadow_overlap_refinement.py` | **22 passed** |
| Full `pytest tests` | **158 passed** |
| `app/ai` line coverage | **90.71%** — PASS (≥90%) |

---

## Validation bundle

| Script | Result |
|--------|--------|
| `rp-ai-shadow-source-diagnostic.sh` | PASS |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-runtime-contract.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |

---

## Rollback plan

1. Set deployment env: `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`; rollout restart.
2. Revert T20.10AF commit — restores T20.10AC neighbor/listing behavior and caps.
3. Re-run default/off benchmark — expect **11/16** zero-overlap.
4. No DB migration or metadata rollback required.

---

## Final verdict

**Vector rollout: NOT APPROVED**

- Keyword retrieval remains production default.
- Overlap flags stay **diagnostic-only / default off**.
- T20.10AF preserves flagged overlap (**8/16**) with reduced fetch fanout; latency still **run-unstable** under embed variance.
- **Next step:** T20.10AG read-only re-evaluation **or** T20.16 Phase 20 context refresh (after overlap branch closeout).
