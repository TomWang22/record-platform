# T20.18E — Broader hybrid soak closeout

**Status:** T20.18 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.18D decision (B selected, D recommended)

---

## 1. Final state

```text
T20.18A–E: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
T20.19A: NOT STARTED
```

---

## 2. Commit map (T20.18A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.18A | `7424efa` | Broader hybrid soak design |
| T20.18B | `1c60701` | Preflight + cohort JWT verification |
| T20.18C-LIVE | `6cf4814` | Multi-user live soak PASS (270/270) |
| T20.18D | `a071f28` | Decision package (B selected) |
| T20.18E | *(this batch)* | Closeout |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| Live transcript (6 users × 5×9) | **270/270** HTTP 200, **0%** fallback |
| Combined D17+D18 live | **405/405** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 30/30, score **4.0**, fallback **0** |
| Avg / worst quality | **4.0 / 4.0** (all users) |
| Hybrid p50 / p95 (aggregate) | **39.86 / 145.78 ms** |
| Shadow pure / anchored | **8/16 / 16/16** |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |
| Playwright | **PASS** |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

Multi-user soak passed cleanly; operational allowlist restored to contract seller user. **D recommended** for optional T20.19A extended soak design.

---

## 5. Final operational state

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Allowlist | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` **only** |
| `AI_RAG_HYBRID_CANARY` | **1** |
| PERCENT | **0** |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |

---

## 6. Rollback runbook

1. **Percent-only:** `AI_RAG_HYBRID_CANARY_PERCENT=0`
2. **Full hybrid off:** `AI_RAG_HYBRID_CANARY=0` → rollout → verify keyword
3. **Allowlist narrow:** restore single contract UUID
4. **Image:** `t20-p216b` (current)

---

## 7. Hard stops

- Do **NOT** enable vector production default
- Do **NOT** set `AI_RAG_HYBRID_CANARY_PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without explicit eval approval + restore plan
- Do **NOT** start T20.19A without approval phrase
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.19A extended hybrid soak design only
```

```text
T20.18 broader hybrid soak batch: CLOSED
Default rollout: NOT APPROVED
```
