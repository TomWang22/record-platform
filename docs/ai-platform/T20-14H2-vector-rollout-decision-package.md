# T20.14H2 — Vector rollout decision package

**Status:** Decision package complete  
**Generated:** 2026-06-29  
**Baseline SHA:** `521dee8` (H0) + H1 eval  
**Deploy image:** `python-ai-service:t20-p214g3r`  
**Implementation:** `cbe764a` (G3R)

---

## Current evidence

### Infrastructure

| Item | Result |
| ---- | ------ |
| HNSW local/dev index | **present** — `ai_document_chunks_embedding_vec_hnsw_idx` |
| Embedded chunks | **10,065** |
| Cluster health | All pods Running; `python-ai-service:t20-p214g3r` deployed |
| shopping-service | 1/1 Ready |

### Ticket lineage summary

| Ticket | Key outcome |
| ------ | ----------- |
| T20.14D/E | Vector shadow path established; privacy scope locked |
| T20.14F2 | HNSW index; latency headroom (cf p95 ~200–550 ms) |
| T20.14G2 | Zero-results fixed (0/16); latency regressed |
| T20.14G2R | Latency restored; overlap 7/16 |
| T20.14G3 | Entity expansion v2; overlap 8/16 |
| T20.14G3R | Overlap anchors; pure 8/16, anchored 16/16 |
| **T20.14H0** | Three-lane hybrid gate design |
| **T20.14H1** | 5-run stability: pure 8/16, anchored 16/16, all latency/zero/product PASS |
| **T20.14H2** | This decision package |

### Gate results (H1 — worst case across 5 runs)

| Lane | Metric | Result | Gate |
| ---- | ------ | ------ | ---- |
| **A — Pure vector** | pure doc/entity overlap >0 | **8/16** (all 5 runs) | ≥10/16 — **FAIL** |
| **A** | true zero-results | 0/16 | **PASS** |
| **A** | shadow p95 | 108–1351 ms | ≤3000 ms — **PASS** |
| **A** | candidate_fetch p95 | 49–56 ms | ≤1500 ms — **PASS** |
| **A** | embed timeouts | 0 | **PASS** |
| **B — Hybrid anchored** | anchored doc/entity overlap >0 | **16/16** (all 5 runs) | ≥10/16 — **PASS** |
| **B** | overlap anchors added | 8/16 (stable) | reported |
| **B** | entity expansion added | 6/16 (stable) | reported |
| **B** | product suites | PASS | **PASS** |
| **B** | leakage | PASS | **PASS** |
| **C — Keyword production** | Phase 21 suites | PASS | **PASS** |
| **C** | telemetry WARNs | 0 | **PASS** |

### Rollback state

| Action | Command / state |
| ------ | --------------- |
| Production retrieval | keyword — **no change required for rollback** |
| Shadow diagnostics | opt-in; disable via `AI_RAG_SHADOW_VECTOR=0` |
| Image rollback | `kubectl set image deployment/python-ai-service app=python-ai-service:t20-p214g3` |
| Anchor caps | `SHADOW_OVERLAP_ANCHOR_MAX=1` in code |

### Known risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Pure vector overlap stuck at 8/16 | High | Report pure vs anchored separately; do not approve pure rollout |
| Eight prompts depend on keyword overlap anchors | Medium | Hybrid canary must tag and meter `overlap_anchor_added` |
| Cold-embed shadow p95 tail (~1.3–1.6 s) | Low | Under 3000 ms SLO; monitor on canary if approved |
| Keyword entity bridge unused (0/16) | Info | Bridge implemented but anchors sufficient today |
| Anchor-assisted overlap may mask vector quality gaps | Medium | H0/H1 telemetry split enforced in harness |

---

## Decision options

### Option A — Stay keyword default

**Use if:** pure vector failed; hybrid not approved; product keyword remains strong.

**Assessment:** Pure vector **failed** (8/16). Hybrid gates **passed** H1. Product keyword **strong** (0 WARNs, all suites PASS).

**Verdict:** Valid fallback if owner declines hybrid canary design. **Not the recommended path** given H1 hybrid stability — but production default **remains keyword** regardless.

```text
Recommended if H1 has any hard failure.
```

H1 had **no hard failures**. Option A is the safe default but does not advance vector evidence collection.

---

### Option B — Hybrid canary design only

**Use if:** pure vector overlap fails; anchored hybrid overlap passes; latency/zero/product/leakage pass.

**Assessment:** All conditions **met** across 5 H1 runs.

**Scope (design-only T20.15A — not started):**

- No production default flip
- Canary must use explicit env/flag (e.g. per-route shadow profile or dedicated canary tenant)
- Pure and anchored metrics continue reporting separately
- Rollback plan documented in H0
- Owner explicit approval required before any T20.15A implementation

```text
Recommended only if H1 hybrid gates pass all 5 runs.
```

**H1 result:** Hybrid gates **PASS** all 5 runs.

---

### Option C — Pure vector canary planning

**Use only if:** pure vector overlap ≥10/16 all 5 runs; latency and zero-result gates pass.

**Assessment:** Pure overlap **8/16** on all 5 runs — **not met**.

```text
Not expected from current baseline.
```

**Verdict:** **Not applicable.**

---

## H2 decision matrix

| Option | Pure gate | Hybrid gate | Product | H2 recommendation |
| ------ | --------- | ----------- | ------- | ----------------- |
| A — Stay keyword | FAIL | PASS | PASS | Fallback only |
| **B — Hybrid canary design** | FAIL | **PASS** | **PASS** | **SELECTED** |
| C — Pure vector canary | FAIL | — | — | Not applicable |

---

## What T20.15A would contain (if owner approves — not started)

Design-only scope for a future ticket:

1. Explicit canary flag / env gate (no default-on)
2. Hybrid retrieval path: vector + entity expansion + bounded overlap anchors
3. Dashboards: pure vs anchored overlap, anchor count, latency p95
4. Rollback: single env flip + image pin
5. No keyword production retrieval change
6. No embedding tranches without separate approval

**T20.15A is NOT started by this ticket.**

---

## Required final verdict

```text
Vector rollout: NOT APPROVED
T20.15A HYBRID CANARY DESIGN: READY FOR OWNER APPROVAL
Production default remains keyword
```

### Supporting rationale

- **Pure vector rollout:** NOT APPROVED — 8/16 stable across G3, G3R, and H1 (5 runs). Lane A gate requires ≥10/16.
- **Hybrid canary design:** READY FOR OWNER APPROVAL — Lane B gates pass on all 5 H1 runs (anchored 16/16, latency, zero-results, product, leakage).
- **Production default:** keyword — unchanged and approved (Lane C PASS).
- **T20.15 execution:** BLOCKED until owner explicitly approves T20.15A design scope.

---

## References

- `docs/ai-platform/T20-14H0-hybrid-vector-gate-design.md`
- `docs/ai-platform/T20-14H1-hybrid-vector-5run-stability-eval.md`
- `docs/ai-platform/T20-14G3R-overlap-tuning-eval.md`
- `docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md`
