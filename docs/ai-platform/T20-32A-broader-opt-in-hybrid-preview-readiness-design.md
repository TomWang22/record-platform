# T20.32A — Broader opt-in hybrid preview readiness design

**Status:** Design approved for broader readiness live evidence  
**Generated:** 2026-07-02  
**Baseline SHA:** `42a3316`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Broader readiness objectives

After T20.31 sustained multi-window soak (6480/6480 PASS), this batch extends window depth to validate opt-in preview readiness before any real-participant / owner-approved expansion (T20.33A).

| # | Objective |
|---|-----------|
| 1 | Broader readiness across **16 windows** (vs T20.31 12) |
| 2 | Same **12-JWT** participant matrix — no new users without owner artifact |
| 3 | Per-window revoke → verify keyword → enroll → verify preview → RAG probe → run → revoke |
| 4 | UI + API enrollment consistency |
| 5 | 429 retry/backoff |
| 6 | Enrollment churn and re-enrollment safety |
| 7 | Guest/anonymous exclusion |
| 8 | Telemetry, quality, leakage, RP, Playwright gates |
| 9 | Rollback / `CANARY=0` drill (after live eval only) |
| 10 | Reject production-default options |

## 2. Participant set

12 JWT users from T20.29–T20.31 — 1 allowlist contract + 11 opt-in participants. Allowlist not broadened.

## 3. Readiness matrix

```text
16 windows × 12 JWT users × 5 runs/user/window × 9 cases/run = 8640 cases
```

Expected `gate_reason`: allowlist **720**, preview_opt_in **7920**.

## 4. Cumulative target

```text
Prior (T20.31C): 16065/16065
T20.32C target: 8640/8640
Cumulative: 24705/24705 HTTP 200, 0% fallback
```

## 5. Evidence discipline

Only the **clean final artifact** counts. Runs with 429 failures, transient `keyword_default`, bad enroll timing, stale enrollment, or mid-drill `CANARY=0` are documented separately and excluded.

## 6. Explicit rejections

- Hybrid production default: **NOT APPROVED**
- Vector production default: **NOT APPROVED**
- `AI_RAG_HYBRID_CANARY_PERCENT` > 0: **NOT APPROVED**
- Allowlist broadening: **NOT APPROVED**

## 7. Verdict

```text
T20.32A: DESIGN COMPLETE
T20.32B: AUTHORIZED
```
