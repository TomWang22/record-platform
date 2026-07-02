# T20.31F — Sustained opt-in hybrid preview soak decision package

**Status:** Decision package complete  
**Generated:** 2026-07-02  
**Evidence:** T20.31C-LIVE 6480/6480 PASS; cumulative 16065/16065

---

## Decision options

| Option | Meaning | Result |
|--------|---------|--------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP sustained opt-in preview UI, PERCENT=0 | **SELECTED** |
| D | Recommend T20.32A broader/real-participant preview readiness design | **RECOMMENDED** |
| E | Approve hybrid/vector production default | **REJECTED** |

## Required verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Preview enrollments revoked after eval unless user explicitly re-enrolls
T20.32A: NOT STARTED
```

## Verdict

```text
T20.31F: C selected; D recommended; E rejected
T20.31G: AUTHORIZED
```
