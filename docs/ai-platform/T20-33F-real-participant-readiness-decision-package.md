# T20.33F — Real-participant readiness decision package

**Status:** Decision package complete — real-participant readiness **BLOCKED**  
**Generated:** 2026-07-02

---

## Decision options

| Option | Meaning | Result |
|--------|---------|--------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP real-participant opt-in preview UI/API, PERCENT=0 | **SELECTED** (runtime unchanged; real-participant eval blocked) |
| D | Recommend T20.34A larger owner-approved soak **or** participant artifact collection | **RECOMMENDED** |
| E | Approve hybrid/vector production default | **REJECTED** |

## Required verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Real-participant readiness live eval: BLOCKED (missing owner-approved participant artifact)
Preview enrollments: revoked after eval (staging smoke only)
T20.34A: NOT STARTED
```

## Participant acquisition (not rollout)

Before any real-participant C-LIVE or T20.34A soak:

1. Obtain owner approval and consent per participant.
2. Commit `T20-33-owner-approved-real-preview-participants.md` with ≥3 `real_owner_approved` entries.
3. Re-authorize T20.33C-LIVE or approve T20.34A design.

## Verdict

```text
T20.33F: C selected (KEEP UI/API); real-participant readiness BLOCKED; D recommends artifact collection; E rejected
T20.33G: AUTHORIZED
```
