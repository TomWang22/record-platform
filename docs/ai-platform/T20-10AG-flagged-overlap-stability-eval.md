# T20.10AG — Flagged overlap stability re-evaluation

**Generated:** 2026-06-25  
**Baseline SHA:** `bdc310d` (`docs(ai): fix T20.10AF implementation SHA in closeout doc`)  
**Mode:** read-only — no code, flag default, or rollout changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Verdict |
|------|---------|
| Vector rollout | **NOT APPROVED** |
| Default/off regression | **None** — **11/16** zero-overlap unchanged |
| Flagged overlap stability | **Stable** — **8/16** on all 3 runs |
| Flagged latency | **Mostly acceptable** — cf p95 ≤996 ms all runs; shadow p95 ≤3,185 ms (run 1 embed variance) |
| Flag defaults | **`0/0`** confirmed in code and deployment (reset post-eval) |
| Keyword retrieval | **Unchanged** (production default) |
| `AI_RAG_SHADOW_VECTOR` | **`0`** (unchanged) |

**Summary:** T20.10AF overlap gain (**11/16 → 8/16**) is **repeatable across three consecutive flagged warm runs**. Latency is **improved vs T20.10AF's split runs** — candidate_fetch p95 stays under 1,000 ms on all flagged runs; only run 1 shows elevated shadow p95 from embed variance (one outlier, 0 timeouts). **Overlap branch can close.** Recommend **T20.16 — Phase 20 copilot context refresh** next. **Do not** open T20.10AH (no repeated warm-fetch latency failure).

---

## Flag default confirmation

| Location | `AI_RAG_SHADOW_ENTITY_HINTS` | `AI_RAG_SHADOW_NEIGHBOR_EXPANSION` |
|----------|-------------------------------|-------------------------------------|
| `config.py` | `"0"` default → `False` | `"0"` default → `False` |
| Deployment (pre-eval) | `0` | `0` |
| Deployment (during flagged runs) | `1` | `1` |
| Deployment (post-eval) | `0` | `0` |
| Unit tests | `test_flags_default_off` asserts `False` | same |

No code or committed config changed during this ticket.

---

## Harness

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
```

Flagged runs required matching deployment env (`kubectl set env … 1/1`) plus client env echo. Deployment reset to `0/0` after runs.

**Artifacts (local, not committed):**

| Run | Artifact |
|-----|----------|
| Default/off control | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-112932.md` |
| Flagged run 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-113304.md` |
| Flagged run 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-113403.md` |
| Flagged run 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-113427.md` |

---

## Default/off control

| Metric | Value | Expected | Status |
|--------|------:|---------:|--------|
| zero chunk-overlap | **11/16** | 11/16 | PASS |
| doc-overlap >0 | **5/16** | 5/16 | PASS |
| entity-overlap >0 | **5/16** | 5/16 | PASS |
| source diversity (T19.6C weighted types) | **6** | ≥5 | PASS |
| leakage (T19.6C) | **0** | 0 | PASS |
| keyword / RAG contract | **PASS** | PASS | PASS |
| candidate_fetch p95 | 3,289 ms | — | embed-variance note only |
| shadow p95 | 8,031 ms | — | 1 embed outlier; overlap gate unaffected |
| embed p95 | 3,807 ms | — | cold-start variance on control run |
| embed timeouts | **0** | 0 | PASS |

**Conclusion:** No default/off overlap regression. Elevated default/off shadow p95 on this run is **embed-driven**, not overlap-refinement related (flags off).

---

## Flagged/on stability runs

| Metric | Run 1 | Run 2 | Run 3 | Target | Status |
|--------|------:|------:|------:|-------:|--------|
| zero chunk-overlap | **8/16** | **8/16** | **8/16** | ≤8/16 | **PASS (3/3)** |
| doc-overlap >0 | **8/16** | **8/16** | **8/16** | ≥8/16 | **PASS (3/3)** |
| entity-overlap >0 | **8/16** | **8/16** | **8/16** | ≥8/16 | **PASS (3/3)** |
| candidate_fetch p95 | **996 ms** | **386 ms** | **476 ms** | ≤1,500 ms preferred | **PASS (3/3)** |
| shadow p95 | **3,185 ms** | **545 ms** | **588 ms** | ≤3,000 ms preferred | **CONDITIONAL** — run 1 within ≤3,500 acceptable |
| embed p95 | 2,252 ms | 4 ms | 1 ms | document variance | run 1 warm-up swing; runs 2–3 hot |
| embed timeouts | **0** | **0** | **0** | 0 | **PASS (3/3)** |
| embed outliers (≥5s) | 1 | 0 | 0 | — | run 1 only |
| source diversity | **6** | **6** | **6** | ≥5 | **PASS** |
| leakage | **0** | **0** | **0** | 0 | **PASS** |
| zero-result shadow | **0/16** | **0/16** | **0/16** | 0 | **PASS** |

### Remaining zero-overlap (all flagged runs)

All **8** zero-overlap runs per flagged pass: **`same_source_type_different_chunks`** (unchanged pattern from T20.10AD/T20.10AF).

---

## Aggregate interpretation

### Overlap

- **Stable:** 3/3 flagged runs at **8/16** zero-overlap, **8/16** doc-overlap, **8/16** entity-overlap.
- Matches T20.10AD, T20.10AF, and T20.10AC flagged baselines.
- Default/off **11/16** unchanged — no regression from T20.10AF shipping.

### Latency

| Comparison | T20.10AF flagged | T20.10AG flagged (runs 1–3) |
|------------|------------------|----------------------------|
| cf p95 | 4,491 / 1,244 ms | **996 / 386 / 476 ms** |
| shadow p95 | 7,516 / 1,412 ms | **3,185 / 545 / 588 ms** |

T20.10AF trims (AF1–AF3) plus warm embed state yield **materially lower fetch fanout** than T20.10AC/T20.10AF cold runs. Run 1 shadow p95 **3,185 ms** is embed-variance conditional (one outlier, 0 timeouts); runs 2–3 are well under preferred gates.

**Not** a repeated warm-fetch failure pattern — **T20.10AH not warranted.**

### Safety

- Leakage **0**, source diversity **6**, keyword contracts **PASS** across validation bundle.
- Flags remain diagnostic-only / default off.

### Rollout blockers (unchanged)

- Embedded coverage still below rollout threshold (see T20.8/T20.16 context).
- Chunk parity incomplete even flagged (**8/16** not full parity).
- Flags must not default on for production.

---

## Validation bundle

| Script | Result |
|--------|--------|
| `rp-ai-shadow-source-diagnostic.sh` | PASS (6 weighted types, 0 issues) |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-runtime-contract.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS |

---

## Recommendation

| Path | Decision |
|------|----------|
| **T20.16 — Phase 20 copilot context refresh** | **Recommended** — overlap branch stable; latency acceptable for diagnostic confidence |
| T20.10AH — final latency-risk design note | **Not recommended** — warm flagged runs do not show repeated cf p95 failure |
| Further overlap tuning (T20.10AC+ flags) | **Stop** — diminishing returns; remaining gaps are `same_source_type_different_chunks` |

---

## Rollback / hygiene

No code rollback required. Deployment overlap flags reset to `0/0` after eval. No embeddings, metadata, or index changes.

---

## Final verdict

**Vector rollout: NOT APPROVED**
