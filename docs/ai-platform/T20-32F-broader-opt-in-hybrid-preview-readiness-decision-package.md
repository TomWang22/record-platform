# T20.32F — Broader opt-in hybrid preview readiness decision package

**Status:** Decision package complete  
**Generated:** 2026-07-02  
**Evidence:** T20.32C-LIVE 8640/8640 PASS; cumulative 24705/24705

---

## Decision options

| Option | Meaning | Result |
|--------|---------|--------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP broader-readiness opt-in preview UI, PERCENT=0 | **SELECTED** |
| D | Recommend T20.33A real-participant / owner-approved readiness design | **RECOMMENDED** |
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
T20.33A: NOT STARTED
```

## Verdict

```text
T20.32F: C selected; D recommended; E rejected
T20.32G: AUTHORIZED
```
