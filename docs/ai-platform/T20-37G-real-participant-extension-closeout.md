# T20.37G — Real-participant extension closeout

**Status:** T20.37 batch **CLOSED PASS**  
**Generated:** 2026-07-03

---

## Commit map

| Ticket | Description |
|--------|-------------|
| T20.37B | Validator PASS — artifact unchanged, preflight PASS |
| T20.37C | Live eval PASS 2880/2880 + `t20-37c-real-participant-extension-soak-eval.py` |
| T20.37D | Rollback drill PASS |
| T20.37E/F | Telemetry + decision |
| T20.37G/H | Closeout + Phase 21 + validator + T20.38A design @ `0da5aab` |

## Images & env

`webapp:t20-p227b`, `python-ai-service:t20-p225b`

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
```

## Participant artifact

3 complete rows unchanged since T20.36B; JWT verified at T20.37B.

## Live metrics

**2880/2880** HTTP 200, 0% fallback, hybrid p95 183.61 ms, avg quality 4.0.  
Cumulative: **29025/29025** (26145 prior + 2880 T20.37C).

## Rollback proof

T20.37D: API/UI enroll-revoke, bulk revoke, CANARY=0 drill, KEEP restore — **PASS**.

## Decision

**C** — KEEP real-participant opt-in preview UI/API, PERCENT=0.  
**D** — T20.38A broader readiness design recommended next.

## Hard stops (honored)

No allowlist broadening; no PERCENT > 0; no hybrid/vector production default; no message bodies; no staging cohort as real participants; bench logs not committed.

## Next approval phrase

```text
Approved: start T20.38A broader real-participant opt-in hybrid preview readiness design only
```
