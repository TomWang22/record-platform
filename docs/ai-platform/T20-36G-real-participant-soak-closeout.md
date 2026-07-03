# T20.36G — Real-participant soak closeout

**Status:** T20.36 batch **CLOSED PASS**  
**Generated:** 2026-07-03

---

## Commit map

| Ticket | Description |
|--------|-------------|
| T20.36C | Live eval PASS + eval runner |
| T20.36D | Rollback drill PASS |
| T20.36E/F | Telemetry + decision |
| T20.36G/H | Closeout + Phase 21 |

## Images & env

`webapp:t20-p227b`, `python-ai-service:t20-p225b`; KEEP env, PERCENT=0.

## Participant artifact

3 complete rows; JWT verified at T20.36B.

## Live metrics

**1440/1440** HTTP 200, 0% fallback, hybrid p95 159.61 ms, avg quality 4.0.  
Cumulative: **26145/26145**.

## Decision

**C** — KEEP preview UI/API; first real-participant soak PASS.

## Next approval phrase

```text
Approved: start T20.37A real-participant opt-in hybrid preview extension design only
```

(2880-case extension only after explicit approval.)
