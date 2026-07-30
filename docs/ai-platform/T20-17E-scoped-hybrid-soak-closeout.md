# T20.17E — Scoped hybrid soak closeout

**Status:** T20.17 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.17D decision (B selected, C recommended)

---

## 1. Final state

```text
T20.17A–E: COMPLETE
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
T20.18A: NOT STARTED
```

---

## 2. Commit map (T20.17A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.17A | `b460e00` | Scoped hybrid soak design |
| T20.17B | `83769d7` | Preflight + control drills PASS |
| T20.17C-LIVE | `9856776` | Live soak eval PASS (90/90) |
| T20.17D | *(this batch)* | Decision package (B selected, C recommended) |
| T20.17E | *(this batch)* | Closeout |

---

## 3. Evidence summary table

| Evidence | Result |
|----------|--------|
| Live transcript (10×9) | **90/90** HTTP 200, **0%** fallback |
| Combined D-LIVE + C-LIVE | **135/135** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 10/10, score **4.0**, refs **9** |
| Avg / worst quality | **4.0 / 4.0** |
| Hybrid p50 / p95 (C-LIVE) | **103.03 / 223.12 ms** |
| Shadow pure / anchored | **8/16 / 16/16** (3 runs) |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| RP | **PASS** |
| Playwright | **PASS** |
| Rollback drill | **PASS** (T20.17B) |
| Lane C controls | **PASS** |

---

## 4. Final operational state

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Allowlist | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| `AI_RAG_HYBRID_CANARY` | **1** |
| PERCENT | **0** |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |

---

## 5. Rollback runbook

1. **Percent-only:** `AI_RAG_HYBRID_CANARY_PERCENT=0` (already KEEP)
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword for all users
3. **Image:** `t20-p216b` (current) or `t20-p215f` (pre-16B)
4. **KEEP restore:**

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## 6. Hard stops for future agents

- Do **NOT** enable vector retrieval as production default
- Do **NOT** set `AI_RAG_HYBRID_CANARY_PERCENT` > 0 without explicit scoped approval
- Do **NOT** rename hybrid canary as production rollout
- Do **NOT** remove keyword fallback or overlap anchors
- Do **NOT** weaken privacy/leakage filters
- Do **NOT** start T20.18A without explicit owner approval phrase
- Do **NOT** commit bench_logs, screenshots, traces, or scratch scripts

---

## 7. Next optional tracks (no auto-start)

| Track | Scope |
|-------|-------|
| **T20.18A** | Broader hybrid soak **design only** (optional) |
| **P21.10+** | Product follow-ups — keyword/rule-engine only |

### Required approval phrase

```text
Approved: start T20.18A broader hybrid soak design only
```

---

## 8. Stop condition

```text
T20.17 scoped hybrid soak batch: CLOSED
Default rollout: NOT APPROVED
Next: owner approval for T20.18A design only (optional)
```
