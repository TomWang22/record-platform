# T20.28F — Opt-in hybrid preview post-UI soak decision package

**Status:** Decision recorded  
**Generated:** 2026-07-01

---

## 1. Options

| Option | Verdict |
|--------|---------|
| **A** Rollback preview UI and API | **Rejected** |
| **B** KEEP API-only, hide UI | **Rejected** |
| **C** KEEP opt-in preview UI enabled, PERCENT=0 | **SELECTED** |
| **D** Recommend T20.29A participant-limited soak design | **Recommended next** |
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
T20.29A: NOT STARTED
```

## 3. Next approval phrase

```text
Approved: start T20.29A participant-limited opt-in hybrid preview soak design only
```
