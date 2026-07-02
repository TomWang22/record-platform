# T20.33C-BLOCKED — Real-participant opt-in hybrid preview readiness eval

**Status:** Real-participant live eval **BLOCKED**  
**Generated:** 2026-07-02  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`

---

## 1. Block reason

Owner-approved real-participant artifact is **missing**:

- Expected: `docs/ai-platform/T20-33-owner-approved-real-preview-participants.md`
- Found: **no committed artifact**
- `real_owner_approved` participants: **0** (minimum for C-LIVE: **3**)

## 2. What was not run

| Item | Status |
|------|--------|
| 8-window × N real-participant soak matrix | **NOT RUN** |
| Staging 12-JWT cohort as “real participant” eval | **REJECTED** |
| Cumulative live increment | **NONE** (remains **24705/24705**) |

## 3. Staging evidence (prior batches — not T20.33C)

| Batch | Cases | Class |
|-------|------:|-------|
| D16→T20.32C | 24705/24705 | staging_cohort + contract_allowlist |

## 4. Required to unblock C-LIVE

1. Owner provides participant list with consent and approval source.
2. Commit `T20-33-owner-approved-real-preview-participants.md` with all required fields per participant.
3. Minimum **3** `real_owner_approved` participants.
4. Separate approval to re-run T20.33C-LIVE (or T20.34A soak design).

## 5. Verdict

```text
T20.33C-LIVE: BLOCKED
T20.33D: SKIPPED (no real participants for rollback drill)
Runtime: UNCHANGED (KEEP preview UI/API, PERCENT=0)
```
