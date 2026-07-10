# T20.31G — Sustained opt-in hybrid preview soak closeout

**Status:** T20.31 batch **CLOSED**  
**Generated:** 2026-07-02

---

## Commit map

| Ticket | SHA | Description |
|--------|-----|-------------|
| T20.31A | `adb3e11` | Sustained soak design |
| T20.31B | `ef160e8` | Preflight PASS |
| T20.31B e2e | `ecfa384` | Playwright revoke gate stabilization |
| T20.31C | `4c3d306` | Live soak 6480/6480 |
| T20.31D | `5386506` | Rollback drill |
| T20.31E/F | `63bf15e` / `1e2a724` | Telemetry + decision C |
| T20.31G/H | `46372f0` / `f60a518` | Closeout + Phase 21 |

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

12 JWT × 12 windows × 5 runs × 9 cases = **6480**

## Live metrics

6480/6480 HTTP 200, 0% fallback, gate_reason allowlist 540 / preview_opt_in 5940. Cumulative **16065/16065**.

## Telemetry WARNs

1 post-batch `ui_latency_p95_ms` (non-soak UI class). Soak path: 0 WARNs.

## Leakage / OCH / Playwright / rollback

- Leakage: **PASS**
- OCH: **PASS** (`__SCANNED__=590`)
- Playwright: **PASS** (final clean runs)
- Rollback + `CANARY=0`: **PASS**

## Decision

**C** — KEEP opt-in preview UI, PERCENT=0; recommend T20.32A.

## Next approval phrase

```text
Approved: start T20.32A broader opt-in hybrid preview readiness design only
```
