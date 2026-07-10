# T20.30A — Expanded opt-in hybrid preview participant soak design

**Status:** Design approved for expanded soak evidence  
**Generated:** 2026-07-01  
**Baseline SHA:** `09315ff`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objectives

Expanded post-T20.29 soak using the same **12 JWT participants** with more windows for sustained enrollment-churn and live inference evidence.

| # | Objective |
|---|-----------|
| 1 | Expanded participant soak after T20.29 2160-case pass |
| 2 | UI + API enrollment lifecycle (UI smoke; API bulk per window) |
| 3 | Per-window revoke → verify keyword → enroll → verify preview → run → revoke |
| 4 | 429 retry/backoff for 12-user load |
| 5 | Quality, telemetry, leakage, OCH, Playwright gates |
| 6 | Rollback / `CANARY=0` drill |
| 7 | Reject production-default options |

## 2. Participant set (unchanged from T20.29)

12 JWT users: 1 allowlist contract + 11 opt-in participants. No new users added; allowlist not broadened.

## 3. Live matrix (primary target)

```text
6 windows × 12 JWT users × 5 runs/user/window × 9 cases/run = 3240 cases
```

Expected `gate_reason`: allowlist **270**, preview_opt_in **2970**.

Minimum floor (documented infra fallback only): 2160 cases (4 windows).

## 4. Gates

| Gate | Threshold |
|------|-----------|
| HTTP 200 | 100% (3240/3240) |
| Fallback | ≤1% |
| `final_tagged_plan` fallback | 0 |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | 0 |
| Telemetry WARNs | 0 |
| Leakage / OCH / Playwright | PASS |
| PERCENT | 0 |
| Post-revoke `keyword_default` | PASS |

## 5. Cumulative live target

```text
Prior (T20.29C): 6345/6345
T20.30C: 3240/3240
Cumulative: 9585/9585 HTTP 200, 0% fallback
```

## 6. Verdict

```text
T20.30A: DESIGN COMPLETE
T20.30B: AUTHORIZED
```
