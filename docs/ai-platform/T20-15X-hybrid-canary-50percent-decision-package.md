# T20.15X — Hybrid canary 50% decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-29  
**Baseline SHA:** `29a2674` + W eval  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15W — 50% eval PASS, percent restored to 0

---

## 1. Executive verdict

```text
T20.15W 50% hybrid canary eval: PASS
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0 restored
Production default: keyword
Vector production default: NOT APPROVED
T20.15Y 75% design: RECOMMENDED (owner approval required)
```

---

## 2. Evidence summary (D-S through W)

| Ticket | Key result |
|--------|------------|
| T20.15G/K/O/S | 1%/5%/10%/25% evals PASS; percent restored each time |
| T20.15V | 50% verification-only; percent=50 bucket math |
| T20.15W | 50% PASS; buckets 0–49 + bucket50 control; percent restored |

---

## 3. T20.15W gate verdict table

| Gate | Result |
|------|--------|
| HTTP 200 (27 allowlist transcript) | **PASS** |
| Cohort API (28 prompts) | **PASS** |
| Fallback ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 ≤ 3000 ms | **PASS** (514.96 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Percent restored | **PASS** |
| Playwright | **PASS** |
| Source diagnostic (Lane C) | **PASS** |
| OCH / contracts | **PASS** |

---

## 4. Options

### A. ROLLBACK hybrid entirely — **Not selected**

### B. KEEP allowlist only, percent=0 ✅ SELECTED (active state)

### C. KEEP allowlist + recommend 75% design only ✅ RECOMMENDED NEXT

### D. KEEP PERCENT=50 active — **Not selected**

---

## 5. Explicit recommendation

**Active:** Option **B**. **Next:** Option **C** → T20.15Y 75% design only.

---

## 6. Final env state

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Image: `python-ai-service:t20-p215f`

---

## 7. Rollback runbook

Percent-only off → full hybrid off → image pin `t20-p215f`. Target under 5 minutes.

---

## 8. Production defaults (unchanged)

| Setting | Value |
|---------|-------|
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |
| Hybrid allowlist canary | **KEEP** |

---

## 9. Next ticket recommendation

| Ticket | Scope | Status |
|--------|-------|--------|
| T20.15Y | 75% design only | **RECOMMENDED** |
| T20.15Z | 75% implementation percent-zero | **NOT APPROVED** |
| T20.15AA | 75% eval window | **NOT APPROVED** |

---

## Required next approval phrase

```text
Approved: start T20.15Y 75 percent hybrid canary design only
```
