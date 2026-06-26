# T20.13B — Shadow stability fix proposal (design-only)

**Status:** DESIGN ONLY — **T20.13C implementation NOT APPROVED**  
**Generated:** 2026-06-26  
**Baseline:** T20.13A triage (`docs/ai-platform/T20-13A-shadow-zero-result-latency-triage.md`)  
**Embedded:** 10,065 | ≥10k count gate: PASS | Vector rollout: NOT APPROVED

## Problem statement

Post-10k shadow diagnostics fail rollout for:

- **Harness-inflated zero-result** (batch `request_error` tail failures)
- **Embed timeout before fetch** (true zero-result when Ollama >5s)
- **Shadow p95 >3s** (embed + exact pgvector fetch)
- **Structural zero-overlap** (keyword lexical vs shadow semantic chunk mismatch)

Production keyword path remains healthy. Fixes must be **shadow/diagnostic-only** unless separately approved for rollout.

---

## Option comparison

### Option A — Embed warmup/health gate inside diagnostic scripts

Add script-level warmup before shadow diagnostics:

- Require N consecutive embed calls below threshold (already partially exists via `BENCH_REQUIRE_OLLAMA_WARM=1`)
- Extend to **per-query** re-warm if embed latency exceeds threshold mid-run
- Classify timeout separately from retrieval failure in summary MD

| | |
|--|--|
| **Pros** | Fixes false FAILs from cold Ollama; low product risk; directly addresses T20.13 8/16 harness inflation |
| **Cons** | Diagnostic-only; does not fix production vector path |

### Option B — Shadow candidate fetch retry on embed timeout

For shadow diagnostics only:

- If embed timeout, retry embed once after short warmup
- If still timeout, mark `embed_timeout` and **exclude from zero-result / overlap scoring**

| | |
|--|--|
| **Pros** | Reduces zero-result noise; clearer failure taxonomy |
| **Cons** | Increases benchmark wall time |

### Option C — Smaller typed fetch / route-specific caps

Reduce expensive broad fetches after corpus growth:

- Typed fetch first (already partially in shadow profiles)
- Stricter caps for listing-heavy routes post-10k
- Avoid global exact-sort unless typed pool underfilled

| | |
|--|--|
| **Pros** | Improves candidate_fetch p95 (currently 2.4–2.8s) |
| **Cons** | May reduce diversity; could mask overlap issues |

### Option D — Entity-first diagnostic mode

Use keyword-derived entities to constrain shadow diagnostics:

- Not default production behavior
- Only when `shadow_debug=1` or explicit diagnostic flag
- Reduces candidate spread after corpus growth

| | |
|--|--|
| **Pros** | Improves overlap (flagged mode already 3/7 vs 1/7 default) and latency |
| **Cons** | Diagnostic coupling to keyword path; not rollout parity proof |

### Option E — ANN index proposal (ops ticket)

Design-only:

- HNSW or IVFFLAT pgvector index on `embedding_vec`
- Requires migration/ops approval separate from Phase 20

| | |
|--|--|
| **Pros** | Real vector latency fix at scale |
| **Cons** | DB/index risk; not Phase 20 default |

### Option F — Declare vector rollout blocked and stop tuning

Document blocked state; keyword default indefinitely.

| | |
|--|--|
| **Pros** | Safest |
| **Cons** | No path to rollout |

---

## Recommended T20.13C scope

**Implement A + B first** (diagnostic harness reliability):

1. **A1** — Harden timing harness: detect `http_time_s=0` / missing `shadow_diagnostics` as `request_error`, not zero-result retrieval failure; optional batch cooldown/retry for tail queries.
2. **A2** — Separate summary counters: `zero_result_retrieval` vs `request_error` vs `embed_timeout`.
3. **B1** — Single embed retry on timeout before declaring zero-result; exclude hard timeouts from overlap denominator.

**Include C only if** T20.13C warm runs show candidate_fetch p95 >2s **after** embed stabilization (T20.13A shows it does — defer to **C-lite**: tighten typed fetch caps in shadow profiles only, no production change).

**Defer D** unless overlap remains impossible after A+B (structural mismatch may persist even with stable embed).

**Defer E** to separate ops-approved DB index ticket (T20.13E or infra).

**Keep F** as explicit fallback if T20.13C does not meet success criteria.

---

## T20.13C success criteria

| Metric | Target |
|--------|--------|
| Zero-result shadow runs (retrieval) | **≤2/16** on warm diagnostic |
| Request errors | Classified separately; **0** counted as retrieval zero-result |
| Embed timeout | Classified; not counted as retrieval failure |
| Source diagnostic | **PASS** repeatably |
| Shadow p95 | Improves **or** clearly documented as embed-bound only |
| Keyword contract | PASS |
| Leakage | 0 |
| Vector rollout | Still **NOT APPROVED** until overlap + latency + % coverage gates pass |

---

## Out of scope for T20.13C

- Vector production default flip (T20.14/T20.15)
- Default-on overlap flags
- Additional embedding tranches
- `EMBEDDING_BACKFILL_FORCE=1`
- Phase 21

---

## Required verdict

```text
Vector rollout: NOT APPROVED
Phase 21: not started
Production retrieval remains keyword
T20.13C implementation: requires explicit approval
```
