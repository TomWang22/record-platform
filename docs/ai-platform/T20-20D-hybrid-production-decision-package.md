# T20.20D — Hybrid production-decision package

**Status:** Decision complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `f4d0540` + C-LIVE eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.20C-LIVE — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.20 production-decision: PASS — operational allowlist restored to contract user
T20.21A: NOT STARTED
```

---

## 2. Evidence summary

| Batch | Cases | HTTP 200 | Fallback | Users | Windows |
|-------|-------|----------|----------|-------|---------|
| T20.15 ladder | — | — | — | — | CLOSED |
| T20.16D-LIVE | 45 | 45/45 | 0% | 1 | 1 |
| T20.17C-LIVE | 90 | 90/90 | 0% | 1 | 1 |
| T20.18C-LIVE | 270 | 270/270 | 0% | 6 | 1 |
| T20.19C-LIVE | 810 | 810/810 | 0% | 6 | 3 |
| **T20.20C-LIVE** | **540** | **540/540** | **0%** | **6** | **2** |
| **Combined** | **1755** | **1755/1755** | **0%** | — | — |

---

## 3. Per-user gate table (T20.20C)

| User | Cases | HTTP 200 | Fallback | Avg | final_tagged_plan | Verdict |
|------|-------|----------|----------|-----|-------------------|---------|
| e2e-contract | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |
| t20-15g-cohort0 | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |
| t20-15k-cohort1 | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |
| buyer-contract | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |
| t20-15o-bucket10 | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |
| t20-15s-bucket20 | 90 | 90/90 | 0 | 4.0 | hybrid 10/10, fb 0 | **PASS** |

---

## 4. Per-window gate table (T20.20C)

| Window | Cases | HTTP 200 | Fallback | Avg | Hybrid p95 | Verdict |
|--------|-------|----------|----------|-----|------------|---------|
| 1 | 270 | 270/270 | 0 | 4.0 | 191.25 ms | **PASS** |
| 2 | 270 | 270/270 | 0 | 4.0 | 118.44 ms | **PASS** |

---

## 5. Aggregate gate table

| Gate | Result |
|------|--------|
| HTTP 200 | **540/540 PASS** |
| Fallback | **0% PASS** (hard max ≤1%) |
| final_tagged_plan | **0/60 fallback PASS** |
| Avg / worst | **4.0 / 4.0 PASS** |
| Hybrid p95 | **141.65 ms PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Telemetry / leakage / OCH | **PASS** |

---

## 6. final_tagged_plan (T20.20C)

| User | Window 1 | Window 2 | Total | Fallback |
|------|----------|----------|-------|----------|
| e2e-contract | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |
| t20-15g-cohort0 | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |
| t20-15k-cohort1 | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |
| buyer-contract | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |
| t20-15o-bucket10 | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |
| t20-15s-bucket20 | hybrid 5/5 | hybrid 5/5 | 10/10 | 0 |

---

## 7. Latency (T20.20C)

| Scope | Hybrid p50 | Hybrid p95 | Keyword p50 | Keyword p95 |
|-------|------------|------------|-------------|-------------|
| Window 1 | 45.97 ms | 191.25 ms | 65.10 ms | 371.63 ms |
| Window 2 | 38.27 ms | 118.44 ms | 61.07 ms | 243.12 ms |
| **Aggregate** | **42.53 ms** | **141.65 ms** | **63.09 ms** | **326.34 ms** |

---

## 8. Quality (T20.20C)

| Scope | Avg | Worst |
|-------|-----|-------|
| Per window | 4.0 | 4.0 |
| Per user | 4.0 | 4.0 |
| **Aggregate** | **4.0** | **4.0** |

---

## 9. Shadow pure vs anchored

| Run | Pure | Anchored |
|-----|------|----------|
| 163846 | 8/16 | 16/16 |
| 163909 | 8/16 | 16/16 |
| 163921 | 8/16 | 16/16 |

Pure overlap remains **report-only** — not promotion-ready.

---

## 10. Rollback proof

Post-eval restore verified:

- `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f`
- `AI_RAG_HYBRID_CANARY_PERCENT=0`
- Contract user → `hybrid_canary` / `allowlist`
- Cohort users → `keyword` / `keyword_default`

---

## 11. Production-readiness blocker table

| Blocker | Status |
|---------|--------|
| Pure vector 8/16 | **Open** — report-only, not promotion-ready |
| Hybrid anchor dependency | **Open** — keyword anchors required |
| Production default keyword | **Current** — unchanged |
| No owner/product decision to switch default | **Open** |
| No permanent broad allowlist decision | **Open** — eval windows only |

---

## 12. Decision options

### A. ROLLBACK hybrid canary — **Not selected**

1755/1755 live cases, 0% fallback across five soak/decision batches.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Operational state matches T20.15–T20.19 pattern. Single contract user for production canary evidence without broadening permanent exposure.

### C. KEEP broader dev/staging allowlist — **Not selected**

No operational reason to permanently broaden; all 6 users passed under temporary allowlist but production default remains keyword.

### D. Recommend T20.21A hybrid default RFC / owner sign-off design ✅ **RECOMMENDED**

T20.20C clean. Next step is **design-only** owner sign-off RFC — not rollout.

### E. Approve production default switch — **REJECTED**

Pure vector 8/16, anchor dependency, no owner sign-off, blockers unresolved.

---

## 13. Required verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.21A: NOT STARTED
```
