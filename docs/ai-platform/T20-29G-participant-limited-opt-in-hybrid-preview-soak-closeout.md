# T20.29G — Participant-limited opt-in hybrid preview soak closeout

**Status:** T20.29 batch **CLOSED**  
**Generated:** 2026-07-01

---

## Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.29A/B | `6829aab` | Design + preflight |
| T20.29B runner | `a097184` | 12-user eval + 429 retry |
| T20.29C | `cd18da6` | Live soak 2160/2160 |
| T20.29D | `7b9a57c` | Rollback drill |
| T20.29E/F | `3517c44` | Telemetry + decision C |
| T20.29G/H | `54a9524` + `b838f45` | Closeout + Phase 21 |

## Images

`webapp:t20-p227b`, `python-ai-service:t20-p225b` (unchanged)

## Participant matrix

12 JWT users × 4 windows × 5 runs × 9 cases = **2160**

## Live metrics

2160/2160 HTTP 200, 0% fallback, gate_reason allowlist 180 / preview_opt_in 1980. Cumulative **6345/6345**.

## Decision

**C** — KEEP opt-in preview UI; recommend T20.30A expanded soak design.
