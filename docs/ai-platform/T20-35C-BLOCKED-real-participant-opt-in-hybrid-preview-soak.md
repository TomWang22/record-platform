# T20.35C-BLOCKED — Real-participant opt-in hybrid preview soak

**Status:** Real-participant soak **BLOCKED**  
**Generated:** 2026-07-03  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`

---

## 1. Block reason

Participant artifact is **committed but incomplete**:

| Check | Result |
|-------|--------|
| Artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Complete participants | **0** / **3** required |
| Issue | All rows: email `TBD`, UUID `TBD`, approval source `TBD`, consent unset, signature `TBD` |

## 2. What was not run

| Item | Status |
|------|--------|
| 8-window × N real-participant soak | **NOT RUN** |
| Staging 12-JWT cohort substitute | **REJECTED** |
| Shadow diagnostics (soak path) | **NOT RUN** |
| Full Playwright C-suite | **Deferred** |
| Cumulative live increment | **NONE** |

## 3. Cumulative live (unchanged)

```text
Staging (D16→T20.32C): 24705/24705 HTTP 200, 0% fallback
T20.33C: 0 | T20.34C: 0 | T20.35C: 0
```

## 4. Runtime

**UNCHANGED** — KEEP preview UI/API, PERCENT=0, contract-only allowlist.

## 5. To unblock

Fill in ≥3 complete rows in `T20-35-owner-approved-real-preview-participants.md` (real email, UUID, approval source, consent=yes, signature) and re-run T20.35B audit.

## 6. Verdict

```text
T20.35C-LIVE: BLOCKED
T20.35D: SKIPPED
```
