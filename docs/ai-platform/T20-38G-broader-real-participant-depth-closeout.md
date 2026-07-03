# T20.38G — Broader real-participant depth closeout

**Status:** T20.38 batch **CLOSED PASS**  
**Generated:** 2026-07-03

---

## Commit map

| Ticket | Description |
|--------|-------------|
| T20.38B | `cfbc796` — validator PASS, artifact unchanged for Option B, preflight PASS |
| T20.38C | `71d3465` — live eval PASS 4320/4320 + `t20-38c-broader-real-participant-depth-soak-eval.py` |
| T20.38D | `a75fee3` — rollback drill PASS |
| T20.38E/F | `2501331` — telemetry + decision |
| T20.38G/H | `9b06997` — closeout + Phase 21 |

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

3 complete rows unchanged since T20.37B; `audit-real-participant-artifact.sh` PASS at T20.38B. Option B used N=3 depth extension only.

## Live metrics

**4320/4320** HTTP 200, 0% fallback, hybrid p95 151.42 ms, avg quality 4.0.  
Cumulative: **33345/33345** (29025 prior + 4320 T20.38C).

## Rollback proof

T20.38D: Tom UI enroll/revoke, tw5126 API enroll/revoke, bulk revoke, CANARY=0 drill, KEEP restore — **PASS**.

## Decision

**C** — KEEP real-participant opt-in preview UI/API, PERCENT=0.  
**D** — T20.39A broader expansion design recommended next; N=5 only after adding two approved participant rows.

## Hard stops (honored)

No allowlist broadening; no PERCENT > 0; no hybrid/vector production default; no message bodies; no staging cohort as real participants; bench logs not committed.

## Next approval phrase

```text
Approved: start T20.39A broader real-participant opt-in hybrid preview expansion design only
```
