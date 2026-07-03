# T20.34F — Owner-approved participant soak decision package

**Status:** Decision package complete — owner-approved soak **BLOCKED**  
**Generated:** 2026-07-03

---

## Decision options

| Option | Meaning | Result |
|--------|---------|--------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP owner-approved participant opt-in preview UI/API, PERCENT=0 | **SELECTED** (existing runtime; soak blocked) |
| D | Recommend T20.35A or participant artifact collection | **RECOMMENDED** |
| E | Approve hybrid/vector production default | **REJECTED** |

## Required verdict (blocked path)

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Real-participant soak: BLOCKED (missing/incomplete participant artifact)
Preview enrollments: revoked after eval (staging smoke only)
T20.35A: NOT STARTED
```

## Participant acquisition (required before live eval)

Commit `docs/ai-platform/T20-34-owner-approved-real-preview-participants.md` with ≥3 owner-approved entries and all required NO fields before any C-LIVE or T20.35A soak.

## Verdict

```text
T20.34F: C selected (KEEP UI/API); real-participant soak BLOCKED; D recommends artifact collection; E rejected
T20.34G: AUTHORIZED
```
