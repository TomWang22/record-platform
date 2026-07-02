# T20.32G — Broader opt-in hybrid preview readiness closeout

**Status:** T20.32 batch **CLOSED**  
**Generated:** 2026-07-02

---

## Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.32A | `4c3b14c` | Broader readiness design |
| T20.32B | `8734cde` | Preflight PASS |
| T20.32C | `9340dc7` | Live eval 8640/8640 |
| T20.32D | `beff95a` | Rollback drill |
| T20.32E/F | `f5f7839` / `4499866` | Telemetry + decision C |
| T20.32G/H | `6ed60bd` / `dfde586` | Closeout + Phase 21 |

## Images

`webapp:t20-p227b`, `python-ai-service:t20-p225b` (unchanged)

## Final env (KEEP)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## Participant matrix

12 JWT × 16 windows × 5 runs × 9 cases = **8640**

## Live metrics

8640/8640 HTTP 200, 0% fallback, gate_reason allowlist 720 / preview_opt_in 7920. Cumulative **24705/24705**.

## Telemetry WARNs

0 soak-path WARNs (preflight and post-batch).

## Leakage / OCH / Playwright / rollback

- Leakage: **PASS**
- OCH: **PASS** (`__SCANNED__=590`)
- Playwright: **PASS** (final clean runs)
- Rollback + `CANARY=0`: **PASS**

## Decision

**C** — KEEP opt-in preview UI/API, PERCENT=0; recommend T20.33A.

## Next approval phrase

```text
Approved: start T20.33A real-participant opt-in hybrid preview readiness design only
```
