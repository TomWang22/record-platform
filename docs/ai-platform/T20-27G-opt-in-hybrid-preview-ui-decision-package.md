# T20.27G — Opt-in hybrid preview UI decision package

**Status:** Decision recorded  
**Generated:** 2026-07-01

---

## 1. Options

| Option | Verdict |
|--------|---------|
| **A** Rollback API + UI | **Rejected** |
| **B** KEEP API, disable/hide UI | **Rejected** |
| **C** KEEP opt-in preview UI for authenticated users, PERCENT=0 | **SELECTED** |
| **D** Recommend T20.28A post-UI soak design | **Recommended next** |
| **E** Approve hybrid/vector production default | **REJECTED** |

## 2. Locked verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Preview enrollments revoked after eval
T20.28A: NOT STARTED
```

## 3. Next approval phrase

```text
Approved: start T20.28A opt-in hybrid preview post-UI soak design only
```
