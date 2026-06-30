# T20.16F — Hybrid production-readiness closeout

**Status:** T20.16 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.16E decision (B selected, C recommended)

---

## 1. Final state

```text
T20.16A–F: COMPLETE
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
T20.17A: NOT STARTED
```

---

## 2. Commit map (T20.16A → F)

| Ticket | SHA (see git log) | Summary |
|--------|-------------------|---------|
| T20.16A | `fd39db3` | Production-readiness design |
| T20.16B | `37d09f6` | `final_tagged_plan` fallback fix (`t20-p216b`) |
| T20.16C | `ef88664` | Pure vector overlap research (report-only 8/16) |
| T20.16D | `39c708e` | Production-readiness eval plan |
| T20.16D-LIVE | *(this batch)* | Live inference eval PASS |
| T20.16E | *(this batch)* | Decision package |
| T20.16F | *(this batch)* | Closeout |

---

## 3. Evidence summary table

| Evidence | Result |
|----------|--------|
| Live transcript (5×9) | **45/45** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 5/5, score **4.0** |
| Avg / worst quality | **4.0 / 4.0** |
| Hybrid p95 (live) | **438.85 ms** |
| Shadow pure / anchored | **8/16 / 16/16** (3 runs) |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| OCH | **PASS** |
| Playwright | **PASS** |
| Rollback drill | **PASS** |
| Lane C controls | **PASS** |

---

## 4. Final operational state

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Allowlist | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| PERCENT | **0** |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |

---

## 5. Rollback runbook

1. **Percent-only:** `AI_RAG_HYBRID_CANARY_PERCENT=0` (already KEEP)
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword
3. **Image:** `t20-p216b` (current) or `t20-p215f` (pre-16B)
4. **KEEP restore:** standard env block in T20.16D plan

---

## 6. Hard stops for future agents

- Do **NOT** enable vector retrieval as production default
- Do **NOT** set `AI_RAG_HYBRID_CANARY_PERCENT` > 0 without explicit scoped approval
- Do **NOT** rename hybrid canary as production rollout
- Do **NOT** remove keyword fallback or overlap anchors
- Do **NOT** weaken privacy/leakage filters
- Do **NOT** start T20.17+ without explicit owner approval phrase
- Do **NOT** commit bench_logs, screenshots, traces, or scratch scripts

---

## 7. Next optional tracks (no auto-start)

| Track | Scope |
|-------|-------|
| **T20.17A** | Scoped hybrid soak **design only** |
| T20.16D-impl | Only if owner reopens pure-vector research (not recommended per 16C) |
| T20.16E-alt | Production default switch — **blocked** |

### Required approval phrase

```text
Approved: start T20.17A scoped hybrid soak design only
```

---

## 8. Stop condition

```text
T20.16 hybrid production-readiness batch: CLOSED
Default rollout: NOT APPROVED
Next: owner approval for T20.17A design only (optional)
```
