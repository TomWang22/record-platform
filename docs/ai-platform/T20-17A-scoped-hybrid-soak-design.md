# T20.17A — Scoped hybrid soak design

**Status:** Design complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `853468a` (T20.16F-CONTEXT-FIX)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.16E decision (B selected; C recommended → this soak)

---

## 1. Executive verdict

```text
T20.17A scoped hybrid soak design: COMPLETE
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Live soak eval: NOT STARTED (T20.17B preflight → T20.17C)
```

This document defines a **soak-style evidence batch** for Lane B (hybrid anchored allowlist canary) after T20.16B fixed `final_tagged_plan` fallback. It does **not** authorize vector or hybrid as production default and does **not** raise `AI_RAG_HYBRID_CANARY_PERCENT`.

---

## 2. Objective

Collect **stronger real inference evidence** for the scoped allowlist hybrid canary with **PERCENT=0**:

- **10×** live API transcript runs (90 cases) vs T20.16D's 5× (45 cases)
- Re-verify `final_tagged_plan` stays on `hybrid_canary` with **0 fallback**
- Confirm Lane C keyword controls and rollback drills still hold
- Supplement with shadow overlap (pure report-only; anchored gated)
- Product Playwright under correct lane envs

---

## 3. Lanes

### Lane C — keyword production default

| Aspect | State |
|--------|-------|
| Status | **Current approved production path** |
| Retrieval | `keyword` |
| Eval role | Fake-allowlist control + `CANARY=0` rollback + record/longform Playwright |

### Lane B — hybrid anchored allowlist canary

| Aspect | State |
|--------|-------|
| Status | **KEEP** — allowlist-only, percent=0 |
| Retrieval | `hybrid_canary` for contract user only |
| Eval role | Primary: 10× API transcript + seller-intelligence Playwright |

### Lane A — pure vector report-only

| Aspect | State |
|--------|-------|
| Status | **Report-only** — not a production gate |
| Overlap | Stable **8/16** across prior batches |
| Eval role | Shadow supplementary — separate metrics from anchored |

---

## 4. Soak matrix

| Path | User / env | Expected `retrieval_mode` | `gate_reason` |
|------|------------|---------------------------|---------------|
| Allowlist contract | JWT `e2e-contract@…` | `hybrid_canary` | `allowlist` |
| Fake allowlist | `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=00000000-0000-0000-0000-000000000000` | `keyword` | `keyword_default` |
| CANARY=0 rollback | `AI_RAG_HYBRID_CANARY=0` | `keyword` | n/a |
| Post-restore KEEP | Standard env below | allowlist → hybrid; others keyword | per T20.15/T20.16 pattern |
| Shadow supplementary | KEEP env | diagnostic only | pure vs anchored split |

JWT `sub` drives gating — **no header user-ID spoofing**.

### Live transcript

- **10×** `bash scripts/rp-ai-hybrid-canary-transcript.sh`
- **90 API cases** (9 prompts × 10 runs)
- Every run must include **`final_tagged_plan`**

### Product / UI

| Suite | Env | Purpose |
|-------|-----|---------|
| seller-intelligence | KEEP allowlist | Real hybrid product path |
| record RAG | Lane C fake allowlist | Keyword control assertions |
| longform RAG | Lane C fake allowlist | Keyword control assertions |
| `ai-quality-telemetry-report.mjs` | post-Playwright | WARN count |

### Shadow supplementary

- **3×** `bash scripts/rp-ai-shadow-real-query-timing.sh` with `BENCH_REQUIRE_OLLAMA_WARM=1`
- **1×** `bash scripts/rp-ai-shadow-source-diagnostic.sh` (classify; non-blocking if known OBO class)

---

## 5. Gates

| Gate | Target | Hard threshold |
|------|--------|----------------|
| HTTP 200 (transcript) | **90/90** | **90/90** |
| Fallback rate | **0%** | **≤2%** (≤2/90) |
| `final_tagged_plan` fallback | **0** | **0/10** |
| Avg quality score | **≥4.0** | **≥3.5** |
| Worst quality score | **≥3.0** | **≥3.0** |
| Hybrid p95 | — | **≤3000 ms** |
| Canary errors | **0** | **0** |
| Telemetry WARNs | **0** | **0** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Anchored overlap (shadow) | **16/16** | **≥10/16** |
| Pure overlap (shadow) | report-only | no promotion |
| True zero-results | **0** | **0** |
| Embed timeouts | **0** | **0** |
| Playwright | **PASS** | **PASS** |
| Rollback drill | **PASS** | **PASS** |
| Contracts / readiness | **PASS** | **PASS** |

---

## 6. Stop rule

If **any hard gate fails** during T20.17C:

1. Restore KEEP env immediately
2. Write **failure** doc (`T20-17C-LIVE-scoped-hybrid-soak-eval.md` with FAIL status)
3. **Stop** before T20.17D decision and T20.17E closeout
4. Do not hide failure

---

## 7. Evidence baseline (T20.16D-LIVE)

| Metric | T20.16D (5 runs) | T20.17 soak target |
|--------|------------------|-------------------|
| Cases | 45 | **90** |
| HTTP 200 | 45/45 | 90/90 |
| Fallback | 0% | 0% target |
| `final_tagged_plan` | hybrid_canary 5/5 | hybrid_canary 10/10 |
| Avg score | 4.0 | ≥4.0 target |
| Hybrid p95 | 438.85 ms | ≤3000 ms |
| Anchored overlap | 16/16 | ≥10/16 (target 16/16) |
| Pure overlap | 8/16 report-only | report-only |

---

## 8. Rollback plan

1. **Percent-only off:** `AI_RAG_HYBRID_CANARY_PERCENT=0` (already KEEP)
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword for allowlist user
3. **Image rollback:** `t20-p216b` (current) or `t20-p215f` (pre-16B)
4. **KEEP restore:**

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
image: python-ai-service:t20-p216b
```

---

## 9. Ticket sequence

| Ticket | Scope |
|--------|-------|
| **T20.17A** | This design (complete) |
| **T20.17B** | Preflight + control drill |
| **T20.17C** | Live soak eval (10× transcript + shadow + Playwright) |
| **T20.17D** | Decision package (only if C hard gates PASS) |
| **T20.17E** | Closeout + `PHASE_21_COPILOT_CONTEXT.md` update |

---

## 10. KEEP env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
image: python-ai-service:t20-p216b
```

Do **not** start T20.18A until T20.17E closeout is complete.
