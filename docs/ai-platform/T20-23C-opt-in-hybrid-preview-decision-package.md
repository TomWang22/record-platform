# T20.23C — Opt-in hybrid preview decision package

**Status:** Decision complete (docs only — **preview NOT APPROVED for implementation**)  
**Generated:** 2026-07-01  
**Baseline SHA:** T20.23A + T20.23B audit  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.23B — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Opt-in preview implementation: NOT APPROVED (owner sign-off absent)
Rollout: NOT APPROVED
T20.24A: NOT STARTED
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
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |

---

## 3. Sign-off inventory (from T20.23B)

| Sign-off | Status |
|----------|--------|
| Owner/product | **ABSENT** |
| Engineering | **ABSENT** |
| Privacy/leakage | Evidence PASS; formal sign-off **ABSENT** |
| Ops/rollback | Runbook documented; formal sign-off **ABSENT** |
| Observability | Telemetry 0 WARNs; formal sign-off **ABSENT** |
| Support/comms | **ABSENT** |

---

## 4. Decision options

### A. ROLLBACK hybrid canary — **Not selected**

2025/2025 live cases, 0% fallback across six evidence batches. Current canary is stable.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Operational state unchanged. Opt-in preview design documented; implementation not authorized.

### C. Approve opt-in preview implementation design next — **Not recommended**

Owner/product sign-off **absent**. No sign-off path artifact in repo. Do not recommend C unless sign-off path is documented with real artifacts.

### D. Approve opt-in preview implementation now — **REJECTED**

Owner/product sign-off absent. Prerequisites not satisfied.

### E. Approve production default switch — **REJECTED**

Explicitly out of scope. Hybrid and vector production defaults remain **NOT APPROVED**.

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
T20.24A: NOT STARTED
```
