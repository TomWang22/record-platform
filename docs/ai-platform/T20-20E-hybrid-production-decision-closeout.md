# T20.20E — Hybrid production-decision closeout

**Status:** T20.20 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.20D decision (B selected, D recommended)

---

## 1. Final state

```text
T20.20A–E: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
T20.21A: NOT STARTED
```

---

## 2. Commit map (T20.20A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.20A | `2de1fe2` | Hybrid production-decision design |
| T20.20B | `f4d0540` | Preflight + evidence audit |
| T20.20C-LIVE | `55d520b` | Final verification PASS (540/540) |
| T20.20D | `aff3948` | Production-decision package (B selected) |
| T20.20E | *(this batch)* | Closeout |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| T20.20C live (2 windows) | **540/540** HTTP 200, **0%** fallback |
| Combined live (D16→D20) | **1755/1755** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 60/60, fallback **0** |
| Avg / worst quality | **4.0 / 4.0** |
| Hybrid p50 / p95 | **42.53 / 141.65 ms** |
| Shadow pure / anchored | **8/16 / 16/16** |
| Telemetry WARNs | **0** |
| Leakage / OCH | **PASS** |
| Playwright | **PASS** |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**D recommended** — optional T20.21A hybrid default RFC / owner sign-off design.

**E rejected** — production default switch not authorized.

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
- Do **NOT** start T20.21A without approval phrase
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.21A hybrid default RFC and owner sign-off design only
```

```text
T20.20 hybrid production-decision batch: CLOSED
Combined live evidence: 1755/1755 HTTP 200, 0% fallback
Default rollout: NOT APPROVED
```
