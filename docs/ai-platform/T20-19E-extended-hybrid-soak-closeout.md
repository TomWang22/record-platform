# T20.19E — Extended hybrid soak closeout

**Status:** T20.19 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.19D decision (B selected, D recommended)

---

## 1. Final state

```text
T20.19A–E: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
T20.20A: NOT STARTED
```

---

## 2. Commit map (T20.19A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.19A | `6794774` | Extended hybrid soak design |
| T20.19B | `2b35ee3` | Preflight + JWT verification |
| T20.19C-LIVE | `7a88999` | 3-window live soak PASS (810/810) |
| T20.19D | `ae091e5` | Decision package (B selected) |
| T20.19E | *(this batch)* | Closeout |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| T20.19C live (3 windows) | **810/810** HTTP 200, **0%** fallback |
| Combined live (D16→D19) | **1215/1215** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 90/90, fallback **0** |
| Avg / worst quality | **4.0 / 4.0** |
| Hybrid p50 / p95 | **37.34 / 119.34 ms** |
| Shadow pure / anchored | **8/16 / 16/16** |
| Telemetry WARNs | **0** |
| Leakage / OCH | **PASS** |
| Playwright | **PASS** |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**D recommended** — optional T20.20A hybrid production-decision design.

---

## 5. Final operational state

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Allowlist | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` **only** |
| PERCENT | **0** |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |

---

## 6. Rollback runbook

1. `AI_RAG_HYBRID_CANARY_PERCENT=0`
2. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
3. Restore single contract UUID allowlist
4. Image `t20-p216b` (current)

---

## 7. Hard stops

- Do **NOT** enable vector production default
- Do **NOT** set `PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without eval approval + restore plan
- Do **NOT** start T20.20A without approval phrase
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.20A hybrid production-decision design only
```

```text
T20.19 extended hybrid soak batch: CLOSED
Combined live evidence: 1215/1215 HTTP 200, 0% fallback
Default rollout: NOT APPROVED
```
