# T20.35F — Real-participant soak decision package

**Status:** Decision complete — real-participant soak **BLOCKED**  
**Generated:** 2026-07-03

---

## Decision options

| Option | Meaning | Result |
|--------|---------|--------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP real-participant opt-in preview UI/API, PERCENT=0 | **SELECTED** (runtime unchanged) |
| D | Recommend T20.36A or complete participant artifact | **RECOMMENDED** |
| E | Approve hybrid/vector production default | **REJECTED** |

## Required verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Real-participant soak: BLOCKED (artifact incomplete — TBD rows)
T20.36A: NOT STARTED
```

## Verdict

```text
T20.35F: C selected (KEEP UI/API); real-participant soak BLOCKED; D recommends completing artifact; E rejected
T20.35G: AUTHORIZED
```
