# T20.13N — Phase 21 runway / rollout blocker burn-down map

**Status:** Docs-only runway map  
**Generated:** 2026-06-27  
**Baseline SHA:** `40bb4c1`

---

## Purpose

Map the exact path from current state to Phase 21 **without** prematurely starting Phase 21 or vector rollout. Phase 21 is reachable; the next step is clearing rollout blockers via T20.13O→Q, then T20.14→16.

---

## Current state

```text
Embedded: 10,065
Count gate: PASS (≥10k)
Percent coverage: ~13.8% (FAIL vs 15%; count gate satisfies alternate)
Keyword synthesis: PASS — 3.6/5 (target ≥3.5)
Production retrieval: keyword
model_used: rule-engine
Vector rollout: NOT APPROVED
Phase 21: not started
Shadow p95: 6–9s (FAIL vs 3s SLO)
Shadow overlap: weak — 1/7 off, 3/7 flagged diagnostic-only
Leakage: 0 PASS
Keyword stability: PASS
```

**Product win (shipped):** T20.13I/J keyword synthesis — deterministic seller/buyer summaries without vector.

**Rollout blockers (remaining):**

1. Shadow p95 latency 8–10s (recent warmed runs)
2. Weak default shadow-keyword overlap
3. Vector path diagnostic-only
4. Flagged overlap diagnostic-only (and latency-expensive)
5. No signed T20.14 promotion gate yet

---

## Required sequence before Phase 21

```text
T20.13O — latency stabilization implementation
    ↓
T20.13P — shadow overlap / hybrid diagnostic implementation
    ↓
T20.13Q — post-fix readiness re-eval
    ↓
T20.14  — vector/hybrid rollout proposal (design-only)
    ↓
T20.15  — controlled rollout implementation (only if T20.14 approved)
    ↓
T20.16  — rollback/monitoring closeout
    ↓
Phase 21 — only after T20.15 succeeds OR vector explicitly deferred
```

**Parallel / non-blocking:**

| Ticket | Scope | When |
|--------|-------|------|
| T20.13K-R | Release-note wording cleanup | Anytime, docs-only |
| ANN index ops ticket | HNSW design from T20.13L Option D | Parallel to T20.13O |
| T20.13K | Post-synthesis closeout | **Complete** (`40bb4c1`) |
| T20.13L/M/N | Blocker plans + runway | **This doc set** |

**Explicitly not in sequence without approval:**

- Additional embedding tranches (10k gate satisfied; 15% only with explicit approval)
- `EMBEDDING_BACKFILL_FORCE=1`
- Default-on overlap flags
- Production vector default

---

## Promotion gates for T20.14

All must pass before T20.14 rollout **proposal** can recommend implementation:

| Gate | Target | Current (T20.13L) | Status |
|------|--------|-------------------|--------|
| Embedded count | ≥10k or ≥15% | 10,065 / 13.8% | **PASS** (count) |
| Shadow p95 | ≤3,000 ms × repeated warm runs | 6,057–9,434 ms | **FAIL** |
| Embed timeouts | 0 | 0 | **PASS** |
| Zero-result shadow | ≤2/16 | 0/16 | **PASS** |
| Overlap — chunk | TBD in T20.14 proposal | 1/7 off | **FAIL** |
| Overlap — document | ≥5/7 off (proposed) | 1/7 off | **FAIL** |
| Overlap — entity | ≥4/7 off (proposed) | 1/7 off | **FAIL** |
| Answer quality (RAG) | ≥3.5/5 | **3.6/5** | **PASS** |
| Leakage | 0 | 0 | **PASS** |
| Keyword stability | unchanged | PASS | **PASS** |
| Rollback plan | documented | not yet | **PENDING** |
| Observability | dashboards/alerts | partial | **PENDING** |

T20.14 proposal must define final overlap targets (chunk + document + entity) and sign rollback/observability requirements.

---

## Phase 21 start criteria

Phase 21 can start only after **one of**:

### Path A — Vector rollout path

| Criterion | Detail |
|-----------|--------|
| T20.15 controlled rollout | Succeeds in staging/canary |
| Rollback tested | One-click revert to keyword default verified |
| Production monitoring | Shadow vs keyword parity dashboards live |
| Keyword fallback | Preserved — vector is additive/hybrid, not sole path |

### Path B — Deferred vector path

| Criterion | Detail |
|-----------|--------|
| Explicit decision | Keep keyword production; defer vector default |
| Phase 21 scope | Excludes vector production rollout |
| Phase 21 track | Non-vector product features (defined separately at Phase 21 kickoff) |

**Current recommendation:** Pursue Path A through T20.13O→Q first; Path B remains valid escape hatch if overlap/latency cannot meet gates after O+P.

---

## Blocker burn-down ownership

| Blocker | Plan doc | Implementation ticket | Success metric |
|---------|----------|----------------------|----------------|
| Shadow p95 6–9s | T20.13L | **T20.13O** | p95 ≤3s × 3 consecutive warm runs |
| Weak overlap | T20.13M | **T20.13P** | doc overlap ≥5/7; entity ≥4/7; quality ≥3.5/5 |
| Gate re-eval | — | **T20.13Q** | All T20.14 promotion gates assessed |
| Rollout proposal | — | **T20.14** | Signed design + rollback plan |
| Controlled rollout | — | **T20.15** | Explicit approval only |

---

## Recommended immediate next ticket

**Start with T20.13O — latency stabilization.**

Rationale:

- p95 blocks **every** vector path including flagged overlap diagnostics
- Embed variance (warmup p95 ~25s spikes) and cf cost (p95 3.5–6.7s) both require stabilization before meaningful overlap tuning
- T20.13P overlap/hybrid work produces noisy results while p95 >3s
- Keyword product is already healthy (3.6/5) — no user-facing urgency to skip latency work

**Do not start:** T20.14, T20.15, Phase 21, vector default, embedding tranches.

---

## Safe future choices (post T20.13N)

| Option | Scope |
|--------|-------|
| **T20.13O** | Latency stabilization implementation — **recommended next** |
| **T20.13P** | Overlap/hybrid diagnostic implementation — after O |
| **T20.13Q** | Post-fix readiness re-eval — after O+P |
| **T20.13K-R** | Docs wording cleanup — anytime |
| **Stop** | Valid if keyword synthesis sufficient and vector deferred indefinitely |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Phase 21 is not started
Production retrieval remains keyword
```

**Runway summary:**

```text
fix latency (T20.13O) → fix overlap/hybrid diagnostics (T20.13P) → re-evaluate (T20.13Q)
  → rollout proposal (T20.14) → controlled rollout (T20.15) → Phase 21
```
