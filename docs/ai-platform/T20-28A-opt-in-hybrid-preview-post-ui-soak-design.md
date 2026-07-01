# T20.28A — Opt-in hybrid preview post-UI soak design

**Status:** Design approved for soak evidence only  
**Generated:** 2026-07-01  
**Baseline SHA:** `3d2e139`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objectives

Post-UI soak validates the shipped `/insights` opt-in hybrid preview card plus existing API runtime under sustained live inference.

| # | Objective |
|---|-----------|
| 1 | Shipped preview UI + API runtime under repeated live inference |
| 2 | UI enroll/revoke lifecycle exercised (Playwright + API bulk setup) |
| 3 | Preview enrollments remain user-scoped and reversible |
| 4 | Non-enrolled cohort users stay `keyword` / `keyword_default` |
| 5 | Allowlist contract user stays `hybrid_canary` / `allowlist` |
| 6 | `AI_RAG_HYBRID_CANARY_PERCENT=0` throughout |
| 7 | No production-default semantics in UI or API responses |
| 8 | No message-body exposure in UI or RAG payloads |
| 9 | Telemetry remains clean (0 WARNs) |

## 2. Out of scope

- Hybrid or vector production default
- `PERCENT > 0`
- Allowlist broadening
- Anonymous/guest hybrid access
- Keyword fallback removal
- Overlap anchor removal
- T20.29A implementation

## 3. Live matrix (T20.28C)

```text
4 windows × 6 users × 5 runs/user/window × 9 cases/run = 1080 cases
```

| User | Role |
|------|------|
| e2e-contract@record-platform.local | allowlist, not preview-enrolled |
| t20-15g-cohort0@record-platform.local | preview-enrolled per window |
| t20-15k-cohort1@record-platform.local | preview-enrolled |
| buyer-contract@record-platform.local | preview-enrolled |
| t20-15o-bucket10@record-platform.local | preview-enrolled |
| t20-15s-bucket20@record-platform.local | preview-enrolled |

Per-window setup: revoke all → verify keyword → enroll 5 cohort (API bulk; UI verified in Playwright) → verify allowlist → verify PERCENT=0.

## 4. Gates

| Gate | Threshold |
|------|-----------|
| HTTP 200 | 1080/1080 |
| Fallback | ≤1% |
| `final_tagged_plan` fallback | 0 |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | 0 |
| Telemetry WARNs | 0 |
| Leakage / OCH | PASS |
| Playwright | PASS |
| PERCENT | 0 |
| `gate_reason` | allowlist 180, preview_opt_in 900 |
| Post-revoke `keyword_default` | PASS |

## 5. Rollback drill (T20.28D)

UI enroll → `preview_opt_in` → UI revoke → `keyword_default` → API re-enroll → UI reflects enrolled → API revoke → revoke all → `CANARY=0` → all keyword → restore KEEP env.

## 6. Decision options (T20.28F)

| Option | Meaning |
|--------|---------|
| A | Rollback preview UI and API |
| B | KEEP API-only, hide UI |
| C | KEEP opt-in preview UI, PERCENT=0 |
| D | Recommend T20.29A participant-limited soak design |
| E | Approve production default — **reject** |

Expected on pass: **C**, recommend **D**, reject **E**.

## 7. Cumulative live target

```text
Prior (T20.27E): 3105/3105
T20.28C: 1080/1080
Cumulative: 4185/4185 HTTP 200, 0% fallback
```

## 8. Verdict

```text
T20.28A: DESIGN COMPLETE
T20.28B: AUTHORIZED
```
