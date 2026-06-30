# T20.15Y — 75% hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** post T20.15X  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15X — recommends 75% design only

---

## 1. Executive verdict

```text
T20.15Y 75% hybrid canary design: COMPLETE
Design only — no implementation
AI_RAG_HYBRID_CANARY_PERCENT remains 0
Hybrid allowlist canary: KEEP
Production default remains keyword
Vector production default: NOT APPROVED
T20.15Z implementation: NOT STARTED
```

---

## 2. T20.15G through W evidence summary

| Eval | Percent | Transcript | Fallback | Hybrid p95 | Restored |
|------|---------|------------|----------|------------|----------|
| G (1%) | 1 | 27/27 | 11.1% | 223 ms | **0** |
| K (5%) | 5 | 27/27 | 11.1% | 355 ms | **0** |
| O (10%) | 10 | 27/27 | 11.1% | 224 ms | **0** |
| S (25%) | 25 | 27/27 | 11.1% | 1052 ms | **0** |
| W (50%) | 50 | 27/27 | 11.1% | 515 ms | **0** |

All evals: anchored **16/16**, pure **8/16**, telemetry WARNs **0**, leakage **PASS**, canary errors **0**.

---

## 3. Decision boundary

| Rule | State |
|------|-------|
| T20.15Y scope | **Design only** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **Remains 0** |
| T20.15Z implementation | **NOT APPROVED** |
| T20.15AA 75% eval | **NOT APPROVED** |

---

## 4. 75% rollout model (future — T20.15AA only)

Same gate engine as F/V:

- `PERCENT=75` → buckets **0–74** in cohort; bucket **≥75** excluded
- Allowlist **always overrides**
- Hard cap: do not set PERCENT above 75 without explicit approval

### Cohort users for T20.15AA

Reuse existing users for buckets 0–49. Create if needed:

- bucket 55–74 cohort user (e.g. bucket 60)
- bucket ≥75 non-allowlisted control

---

## 5. Proposed T20.15Z (NOT APPROVED)

Verification-only: tests for `percent=75` (buckets 0–74 in, 75+ out), deploy PERCENT=0, D-T drill PASS.

---

## 6. Proposed T20.15AA 75% eval (NOT APPROVED)

Preflight PERCENT=0 → set PERCENT=75 → proof paths → transcript + cohort matrix → shadow/Playwright (Lane C) → restore PERCENT=0.

---

## 7. Rollback

Percent-only off under 5 minutes; same runbook as prior tranches.

---

## 8. Stop condition

```text
T20.15Y 75% hybrid canary design: COMPLETE
T20.15Z implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Vector production default: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15Z 75 percent hybrid canary implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15X-hybrid-canary-50percent-decision-package.md`
- `docs/ai-platform/T20-15W-50percent-hybrid-canary-eval.md`
