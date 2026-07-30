# T20.24C — Opt-in hybrid preview implementation decision package

**Status:** Decision complete (docs only — **implementation NOT APPROVED**)  
**Generated:** 2026-07-01  
**Baseline SHA:** T20.24A + T20.24B audit  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.24B — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Implementation: NOT APPROVED (sign-off artifacts absent)
Rollout: NOT APPROVED
T20.25A: NOT STARTED
```

---

## 2. Evidence summary

| Metric | Result |
|--------|--------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored overlap | **16/16** |
| Pure overlap | **8/16** report-only |
| T20.22 rollout design | **CLOSED**; rollout **NOT APPROVED** |
| T20.23 preview design | **CLOSED**; preview implementation **NOT APPROVED** |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |

---

## 3. Sign-off inventory (from T20.24B)

| Sign-off | Status |
|----------|--------|
| Owner/product | **ABSENT** |
| Engineering | **ABSENT** |
| Privacy/leakage | Evidence PASS; formal **ABSENT** |
| Ops/rollback | Runbook documented; formal **ABSENT** |
| Observability | Telemetry 0 WARNs; formal **ABSENT** |
| Support/comms | **ABSENT** |

---

## 4. Decision options

### A. ROLLBACK hybrid canary — **Not selected**

2025/2025 live cases, 0% fallback. Current canary stable.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Operational state unchanged. Implementation design documented; code/env not authorized.

### C. Approve implementation ticket next — **Not recommended**

All sign-off artifacts **absent**. Do not recommend C unless real artifacts are committed to repo.

### D. Approve implementation now — **REJECTED**

Owner/product sign-off absent. Prerequisites not satisfied.

### E. Approve production default switch — **REJECTED**

Out of scope. Hybrid and vector production defaults remain **NOT APPROVED**.

---

## 5. Required verdict

```text
Selected decision: B
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Opt-in preview implementation: NOT APPROVED
Rollout: NOT APPROVED
T20.25A: NOT STARTED
```
