# T20.18D — Broader hybrid soak decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-30  
**Baseline SHA:** `1c60701` + C-LIVE eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.18C-LIVE — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.18 broader soak: multi-user evidence PASS; operational allowlist restored to contract user
```

---

## 2. Evidence summary (T20.16D + T20.17C + T20.18C)

| Batch | Users | Cases | HTTP 200 | Fallback | Avg score | Hybrid p95 |
|-------|-------|-------|----------|----------|-----------|------------|
| T20.16D-LIVE | 1 | 45 | 45/45 | 0% | 4.0 | 438.85 ms |
| T20.17C-LIVE | 1 | 90 | 90/90 | 0% | 4.0 | 223.12 ms |
| **T20.18C-LIVE** | **6** | **270** | **270/270** | **0%** | **4.0** | **145.78 ms** |
| **Combined** | — | **405** | **405/405** | **0%** | **4.0** | — |

---

## 3. Per-user gate table

| User | HTTP 200 | Fallback | Avg | Worst | final_tagged_plan | Verdict |
|------|----------|----------|-----|-------|-------------------|---------|
| e2e-contract | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |
| t20-15g-cohort0 | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |
| t20-15k-cohort1 | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |
| buyer-contract | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |
| t20-15o-bucket10 | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |
| t20-15s-bucket20 | 45/45 | 0 | 4.0 | 4.0 | hybrid_canary 5/5 | **PASS** |

---

## 4. Aggregate gate table

| Gate | Result |
|------|--------|
| HTTP 200 | **270/270 PASS** |
| Fallback | **0% PASS** |
| final_tagged_plan fallback | **0/30 PASS** |
| Avg / worst score | **4.0 / 4.0 PASS** |
| Hybrid p95 | **145.78 ms PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Telemetry WARNs | **0 PASS** |
| Leakage / OCH | **PASS** |
| Playwright | **PASS** |

---

## 5. final_tagged_plan per user

| User | Mode (all 5 runs) | Score | Fallback |
|------|-------------------|-------|----------|
| All 6 users | hybrid_canary | 4.0 | **0/5 each** |

T20.16B remediation holds across **6 distinct JWT identities**.

---

## 6. Latency

| Scope | Hybrid p50 | Hybrid p95 |
|-------|------------|------------|
| Aggregate (270) | 39.86 ms | 145.78 ms |
| e2e-contract | — | 271.0 ms |
| buyer-contract | — | 141.4 ms |
| Cohort users (avg) | — | ~50–85 ms |

---

## 7. Shadow pure vs anchored

| Run | Pure | Anchored |
|-----|------|----------|
| 153200 | 8/16 | 16/16 |
| 153222 | 8/16 | 16/16 |
| 153234 | 8/16 | 16/16 |

---

## 8. Rollback proof

| Step | Proof |
|------|-------|
| Broader allowlist eval | 6 users → hybrid_canary 270/270 |
| Original KEEP restore | Contract → hybrid_canary; cohort → keyword |
| Fake allowlist | All → keyword |
| PERCENT | **0** |

---

## 9. Options

### A. ROLLBACK hybrid canary entirely — **Not selected**

405/405 live cases with 0% fallback across three soak batches.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Restore operational allowlist to contract seller user only. Multi-user soak was **evidence**, not production rollout.

### C. KEEP broader allowlist canary, percent=0 — **Not selected**

Technical gates pass for all 6 users, but cohort accounts are dev/staging test identities. Operational hybrid canary scope remains the contract seller corpus user per T20.15–T20.17 ladder discipline.

### D. Recommend extended soak / production-readiness design ✅ **RECOMMENDED**

Multi-user soak clean; optional **T20.19A** extended soak design if owner approves.

### E. Approve production default switch — **Rejected**

Vector production default **NOT APPROVED**.

---

## 10. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
image: python-ai-service:t20-p216b
```

---

## 11. Next step

**T20.18E** closeout. Optional: **T20.19A extended hybrid soak design**.

```text
Approved: start T20.19A extended hybrid soak design only
```
