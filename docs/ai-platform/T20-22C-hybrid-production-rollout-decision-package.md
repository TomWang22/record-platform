# T20.22C — Hybrid production rollout decision package

**Status:** Decision complete (docs only — **rollout NOT APPROVED**)  
**Generated:** 2026-07-01  
**Baseline SHA:** `95f1cfb` + T20.22B audit  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.22B — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Default rollout: NOT APPROVED
T20.23A: NOT STARTED
```

---

## 2. Evidence summary

| Metric | Result |
|--------|--------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored overlap | **16/16** |
| Pure overlap | **8/16** report-only |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |

### Live evidence table

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| T20.19C-LIVE | 810 | 810/810 | 0% |
| T20.20C-LIVE | 540 | 540/540 | 0% |
| T20.21B-LIVE | 270 | 270/270 | 0% |
| **Combined** | **2025** | **2025/2025** | **0%** |

---

## 3. Audit table (T20.22B)

| Audit item | Result |
|------------|--------|
| Closeout docs T20.15AG–T20.21D | **Present** |
| `PHASE_21_COPILOT_CONTEXT.md` T20.21 state | **Current** |
| Image `t20-p216b` | **Verified** |
| Single allowlist + PERCENT=0 | **Verified** |
| Contract → hybrid_canary | **PASS** |
| Cohort → keyword | **PASS** |
| Preflight scripts | **PASS** |
| RP / telemetry | **PASS** |

---

## 4. Sign-off inventory

| Sign-off | Status |
|----------|--------|
| Owner/product | **ABSENT** — no artifact in repo |
| Engineering | **ABSENT** |
| Privacy/leakage | Evidence PASS; formal sign-off **ABSENT** |
| Ops/rollback | Runbook documented; formal sign-off **ABSENT** |
| Observability | Telemetry 0 WARNs; formal sign-off **ABSENT** |
| Support/comms | **ABSENT** |

---

## 5. Blocker table

| Blocker | Status |
|---------|--------|
| Owner/product sign-off absent | **Open** |
| Pure vector 8/16 | **Open** |
| Hybrid anchor dependency | **Open** |
| Keyword fallback mandatory | **Required** |
| Production default switch not approved | **Open** |
| Permanent broader allowlist | **Not selected** |

---

## 6. Decision options

### A. ROLLBACK hybrid canary — **Not selected**

2025/2025 live cases, 0% fallback across six evidence batches.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Operational state unchanged. Rollout design documented; implementation not authorized.

### C. Open T20.23A opt-in hybrid preview design — **Not recommended**

Owner/product sign-off **absent**. No sign-off path documented. Do not recommend C without explicit sign-off artifacts.

### D. Approve production default switch — **REJECTED**

Owner/product sign-off absent. Pure vector 8/16. Hybrid anchor dependency. Blockers unresolved.

---

## 7. Required verdict

```text
Selected decision: B
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Default rollout: NOT APPROVED
T20.23A: NOT STARTED
```
