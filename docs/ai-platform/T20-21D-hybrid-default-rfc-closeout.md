# T20.21D — Hybrid default RFC closeout

**Status:** T20.21 batch **CLOSED**  
**Generated:** 2026-06-30  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.21C decision (B selected; E rejected)

---

## 1. Final state

```text
T20.21A–D: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
Default switch: REJECTED (owner sign-off absent)
T20.22A: NOT STARTED
```

---

## 2. Commit map (T20.21A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.21A | `5ba8233` | Hybrid default RFC / owner sign-off design |
| T20.21B | *(this batch)* | RFC live confirmation PASS (270/270) |
| T20.21C | *(this batch)* | RFC decision package (B selected, E rejected) |
| T20.21D | *(this batch)* | RFC closeout |
| T20.21E | *(this batch)* | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| T20.21B live confirmation | **270/270** HTTP 200, **0%** fallback |
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` | **hybrid_canary** 30/30, fallback **0** |
| Avg / worst quality | **4.0 / 4.0** |
| Hybrid p50 / p95 | **40.34 / 155.20 ms** |
| Shadow pure / anchored | **8/16 / 16/16** |
| Telemetry WARNs | **0** |
| Leakage / OCH | **PASS** |
| Playwright | **PASS** |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**E rejected** — default switch not authorized (owner sign-off absent, blockers open).

T20.22A **NOT STARTED** — requires explicit approval and sign-off path.

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
- Do **NOT** enable hybrid production default
- Do **NOT** set `PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without eval approval + restore plan
- Do **NOT** start T20.22A without approval phrase and owner sign-off
- Pure vector 8/16 remains report-only
- Do **NOT** commit bench_logs, screenshots, traces

---

## 8. Next optional track

```text
Approved: start T20.22A hybrid production rollout design only
```

```text
T20.21 hybrid default RFC batch: CLOSED
Combined live evidence: 2025/2025 HTTP 200, 0% fallback
Default rollout: NOT APPROVED
```
