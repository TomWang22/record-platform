# T20.15AB — Hybrid canary 75% decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-29  
**Baseline SHA:** `b178160` + AA eval  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15AA — 75% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15AA 75% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Production default: keyword
Vector production default: NOT APPROVED
T20.15AC 100% design: RECOMMENDED (owner approval required)
```

---

## 2. Evidence summary (D-S through AA)

Percentage ladder 1%→75% all PASS with percent restored after each eval window. T20.15Z verification-only; T20.15AA proved buckets 0–74 + bucket75 control.

---

## 3. T20.15AA gate verdict table

| Gate | Result |
|------|--------|
| HTTP 200 (27 allowlist transcript) | **PASS** |
| Cohort API (36 prompts) | **PASS** |
| Fallback ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 ≤ 3000 ms | **PASS** (472.88 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Percent restored | **PASS** |
| Playwright / source diagnostic / RP | **PASS** |

---

## 4. Options

### A. ROLLBACK — **Not selected**

### B. KEEP allowlist only, percent=0 ✅ SELECTED

### C. KEEP allowlist + recommend 100% design only ✅ RECOMMENDED NEXT

### D. KEEP PERCENT=75 active — **Not selected**

---

## 5. Final env state

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

## 6. Rollback runbook

Percent-only off under 5 minutes; same as prior tranches.

---

## 7. Production defaults (unchanged)

Production default: **keyword**. Vector production default: **NOT APPROVED**. Hybrid allowlist canary: **KEEP**.

---

## 8. Next ticket recommendation

| Ticket | Status |
|--------|--------|
| T20.15AC 100% design | **RECOMMENDED** |
| T20.15AD implementation | **NOT APPROVED** |
| T20.15AE 100% eval | **NOT APPROVED** |

---

## Required next approval phrase

```text
Approved: start T20.15AC 100 percent hybrid canary design only
```
