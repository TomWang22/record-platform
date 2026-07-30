# T20.15AC — 100% hybrid canary design

**Status:** Design complete (docs only — no implementation, no env change)  
**Generated:** 2026-06-29  
**Baseline SHA:** post T20.15AB  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15AB — recommends 100% design only

---

## 1. Executive verdict

```text
T20.15AC 100% hybrid canary design: COMPLETE
Design only — no implementation
AI_RAG_HYBRID_CANARY_PERCENT remains 0
Hybrid allowlist canary: KEEP
Production default remains keyword
Vector production default: NOT APPROVED
T20.15AD implementation: NOT STARTED
```

---

## 2. 75% eval evidence summary

T20.15AA PASS: 27/27 transcript, fallback 11.11%, hybrid p95 473 ms, 36/36 cohort prompts, anchored 16/16, percent restored to 0. Full ladder 1%→75% proven.

---

## 3. Why 100% is design-only

100% is the final percentage step in the evidence ladder. It exercises the gate at maximum cohort width (buckets 0–99) while still:

- Requiring explicit eval window approval
- Restoring PERCENT=0 after eval
- **Not** changing production default (keyword)
- **Not** approving vector as production default

Hybrid canary remains gated, reversible, and allowlist-overridable.

---

## 4. 100% cohort model

- `PERCENT=100` → all buckets 0–99 in percentage cohort
- Allowlist **always overrides** (contract user bucket 15 stays allowlist path)
- Only non-allowlisted authenticated UUID users with valid owner scope enter hybrid via percentage
- Anonymous/guest remain keyword_default

**This is NOT vector production rollout.** Keyword remains production default; hybrid is evidence-only canary lane.

---

## 5. Required gates before T20.15AD

Same as prior tranches: D-T drill, contracts, RP, PERCENT=0 before/after, no code change expected.

---

## 6. Proposed T20.15AD (NOT APPROVED)

Verification-only: test `percent=100` (all buckets in), deploy PERCENT=0.

---

## 7. Proposed T20.15AE 100% eval (NOT APPROVED)

Preflight PERCENT=0 → set PERCENT=100 → proof paths → transcript + cohort matrix → shadow/Playwright (Lane C) → restore PERCENT=0.

Cohort users: reuse full ladder set; bucket 75+ user becomes percentage cohort at 100%.

---

## 8. Rollback

Percent-only off under 5 minutes.

---

## 9. Stop condition

```text
T20.15AC 100% hybrid canary design: COMPLETE
T20.15AD implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Vector production default: NOT APPROVED
```

---

## Required next approval phrase

```text
Approved: start T20.15AD 100 percent hybrid canary implementation percent-zero only
```

---

## References

- `docs/ai-platform/T20-15AB-hybrid-canary-75percent-decision-package.md`
- `docs/ai-platform/T20-15AA-75percent-hybrid-canary-eval.md`
