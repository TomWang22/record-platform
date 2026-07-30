# T20.29A — Participant-limited opt-in hybrid preview soak design

**Status:** Design approved for participant-limited soak evidence  
**Generated:** 2026-07-01  
**Baseline SHA:** `cd82abb`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objectives

Participant-limited soak validates opt-in preview lifecycle with JWT-authenticated users after UI launch, emphasizing enrollment churn and revoke safety.

| # | Objective |
|---|-----------|
| 1 | Participant opt-in lifecycle after UI launch |
| 2 | UI enroll/revoke where practical; API bulk setup documented |
| 3 | All participants JWT-authenticated |
| 4 | Preview enrollment user-scoped |
| 5 | Non-enrolled users remain `keyword` / `keyword_default` |
| 6 | Allowlist contract user remains `hybrid_canary` / `allowlist` |
| 7 | `PERCENT=0` throughout |
| 8 | No production-default semantics |
| 9 | Telemetry, leakage, RP, Playwright, rollback, post-revoke proof |

## 2. Participant policy

```text
Target: 8–12 owner-approved participants if available
Minimum hard floor: 6 JWT users
If fewer than 8 real/participant accounts are available, use existing 6-user cohort and document limitation honestly.
Do not broaden permanent allowlist.
Do not use anonymous/guest users.
```

### Available participant inventory (T20.29B)

| Role | Email | JWT sub | Notes |
|------|-------|---------|-------|
| Allowlist contract | e2e-contract@record-platform.local | `2ed75568-…` | Not preview-enrolled |
| Participant | t20-15g-cohort0@record-platform.local | `00000040-…` | Cohort |
| Participant | t20-15k-cohort1@record-platform.local | `0000002a-…` | Cohort |
| Participant | buyer-contract@record-platform.local | `5a68fe88-…` | Cohort |
| Participant | t20-15o-bucket10@record-platform.local | `000001bc-…` | Cohort |
| Participant | t20-15s-bucket20@record-platform.local | `00000002-…` | Cohort |

**Actual matrix:** **12 JWT participants** (1 allowlist contract + 11 opt-in participants). Extended cohort includes seller-contract, bidder2/3, and bucket25/30/50 users verified via JWT login and sub match.

## 3. Live matrix (T20.29C)

```text
4 windows × 12 participants × 5 runs/user/window × 9 cases/run = 2160 cases
```

Expected `gate_reason`: allowlist 180, preview_opt_in 1980.

## 4. Gates

| Gate | Threshold |
|------|-----------|
| HTTP 200 | 100% (2160/2160) |
| Fallback | ≤1% |
| `final_tagged_plan` fallback | 0 |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | 0 |
| Telemetry WARNs | 0 |
| Leakage / RP / Playwright | PASS |
| PERCENT | 0 |
| Post-revoke `keyword_default` | PASS |
| Guest hidden / no message bodies | PASS |

Expected `gate_reason`: allowlist 180, preview_opt_in 1980.

## 5. Cumulative live target

```text
Prior (T20.28C): 4185/4185
T20.29C: 2160/2160
Cumulative: 6345/6345 HTTP 200, 0% fallback
```

## 6. Verdict

```text
T20.29A: DESIGN COMPLETE
T20.29B: AUTHORIZED
```
