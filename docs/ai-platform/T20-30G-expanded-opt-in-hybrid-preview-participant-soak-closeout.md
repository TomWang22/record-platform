# T20.30G — Expanded opt-in hybrid preview participant soak closeout

**Status:** T20.30 batch **CLOSED**  
**Generated:** 2026-07-01

---

## Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.30A | `3e7aa64` | Expanded soak design |
| T20.30B | `2b359f3` | Preflight PASS |
| T20.30C runner | (this batch) | Per-window reset fix + RAG verify |
| T20.30C | (this batch) | Live soak 3240/3240 |
| T20.30D–F | (this batch) | Rollback, telemetry, decision C |
| T20.30G/H | (this batch) | Closeout + Phase 21 |

## Images

`webapp:t20-p227b`, `python-ai-service:t20-p225b` (unchanged)

## Participant matrix

12 JWT × 6 windows × 5 runs × 9 cases = **3240**

## Live metrics

3240/3240 HTTP 200, 0% fallback, gate_reason allowlist 270 / preview_opt_in 2970. Cumulative **9585/9585**.

## Decision

**C** — KEEP opt-in preview UI; recommend T20.31A sustained soak design.
