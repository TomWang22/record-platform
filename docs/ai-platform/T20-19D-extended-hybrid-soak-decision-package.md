# T20.19D — Extended hybrid soak decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-30  
**Baseline SHA:** `2b35ee3` + C-LIVE eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.19C-LIVE — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.19 extended soak: PASS — operational allowlist restored to contract user
```

---

## 2. Evidence summary

| Batch | Cases | HTTP 200 | Fallback | Users | Windows |
|-------|-------|----------|----------|-------|---------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 | 1 |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 | 1 |
| T20.18C-LIVE | 270 | 270/270 | 0% | 6 | 1 |
| **T20.19C-LIVE** | **810** | **810/810** | **0%** | **6** | **3** |
| **Prior total** | **405** | **405/405** | **0%** | — | — |
| **Combined** | **1215** | **1215/1215** | **0%** | — | — |

---

## 3. Per-user gate table (T20.19C)

| User | Cases | HTTP 200 | Fallback | Avg | final_tagged_plan | Verdict |
|------|-------|----------|----------|-----|-------------------|---------|
| e2e-contract | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |
| t20-15g-cohort0 | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |
| t20-15k-cohort1 | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |
| buyer-contract | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |
| t20-15o-bucket10 | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |
| t20-15s-bucket20 | 135 | 135/135 | 0 | 4.0 | hybrid 15/15, fb 0 | **PASS** |

---

## 4. Per-window gate table (T20.19C)

| Window | Cases | HTTP 200 | Fallback | Avg | Hybrid p95 | Verdict |
|--------|-------|----------|----------|-----|------------|---------|
| 1 | 270 | 270/270 | 0 | 4.0 | 156.2 ms | **PASS** |
| 2 | 270 | 270/270 | 0 | 4.0 | 122.4 ms | **PASS** |
| 3 | 270 | 270/270 | 0 | 4.0 | 108.5 ms | **PASS** |

---

## 5. Aggregate gate table

| Gate | Result |
|------|--------|
| HTTP 200 | **810/810 PASS** |
| Fallback | **0% PASS** (hard max ≤1%) |
| final_tagged_plan | **0/90 fallback PASS** |
| Avg / worst | **4.0 / 4.0 PASS** |
| Hybrid p95 | **119.34 ms PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Telemetry / leakage / RP | **PASS** |

---

## 6. Options

### A. ROLLBACK hybrid canary — **Not selected**

1215/1215 live cases, 0% fallback across four soak batches.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Extended multi-window evidence supports hybrid anchored path; operational scope remains contract seller user.

### C. KEEP broader allowlist — **Not selected**

Technical gates pass for all 6 users across 3 windows, but cohort accounts are dev/staging test identities. No production reason to broaden permanent allowlist.

### D. Recommend T20.20A production-decision design ✅ **RECOMMENDED**

Clean extended soak → optional **T20.20A hybrid production-decision design only** (not rollout).

### E. Approve production default switch — **Rejected**

Vector production default **NOT APPROVED**.

---

## 7. Final env

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

## 8. Next approval phrase

```text
Approved: start T20.20A hybrid production-decision design only
```
