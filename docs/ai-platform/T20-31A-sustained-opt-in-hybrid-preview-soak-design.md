# T20.31A — Sustained opt-in hybrid preview soak design

**Status:** Design approved for sustained multi-window soak evidence  
**Generated:** 2026-07-01  
**Baseline SHA:** `9a4560f`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objectives

Sustained multi-window soak (same calendar day; not multi-day) validates opt-in preview under extended enrollment churn after T20.30 3240-case pass.

| # | Objective |
|---|-----------|
| 1 | Sustained soak across 12 windows |
| 2 | Same 12-JWT participant matrix (no new users) |
| 3 | Per-window revoke → verify keyword → enroll → verify preview → run → revoke |
| 4 | 429 retry/backoff |
| 5 | Enrollment churn and re-enrollment safety |
| 6 | UI + API consistency |
| 7 | Telemetry/quality gates |
| 8 | Rollback / `CANARY=0` drill (after live eval only) |
| 9 | Invalid early artifacts excluded from closeout |
| 10 | Reject production-default options |

## 2. Participant set

12 JWT users from T20.29/T20.30 — 1 allowlist contract + 11 opt-in participants. No allowlist broadening.

## 3. Primary matrix

```text
12 windows × 12 JWT users × 5 runs/user/window × 9 cases/run = 6480 cases
```

Expected `gate_reason`: allowlist **540**, preview_opt_in **5940**.

## 4. Cumulative target

```text
Prior (T20.30C): 9585/9585
T20.31C target: 6480/6480
Cumulative: 16065/16065 HTTP 200, 0% fallback
```

## 5. Evidence discipline

Only the **clean final artifact** counts. Runs with 429 failures, transient `keyword_default`, bad enroll timing, or mid-drill `CANARY=0` are documented separately and excluded.

## 6. Verdict

```text
T20.31A: DESIGN COMPLETE
T20.31B: AUTHORIZED
```
