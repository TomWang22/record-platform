# T20.21C — Hybrid default RFC / owner sign-off decision

**Status:** Decision complete (docs only — **not** rollout approval)  
**Generated:** 2026-06-30  
**Baseline SHA:** `efd2845` + T20.21B eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.21B — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Default switch: REJECTED (owner sign-off absent)
T20.22A: NOT STARTED
```

---

## 2. Evidence summary

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| T20.19C-LIVE | 810 | 810/810 | 0% |
| T20.20C-LIVE | 540 | 540/540 | 0% |
| **T20.21B-LIVE** | **270** | **270/270** | **0%** |
| **Combined** | **2025** | **2025/2025** | **0%** |

---

## 3. Per-user gate table (T20.21B)

| User | Cases | HTTP 200 | Fallback | Avg | final_tagged_plan | Verdict |
|------|-------|----------|----------|-----|-------------------|---------|
| e2e-contract | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |
| t20-15g-cohort0 | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |
| t20-15k-cohort1 | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |
| buyer-contract | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |
| t20-15o-bucket10 | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |
| t20-15s-bucket20 | 45 | 45/45 | 0 | 4.0 | hybrid 5/5, fb 0 | **PASS** |

---

## 4. Aggregate gate table

| Gate | Result |
|------|--------|
| HTTP 200 | **270/270 PASS** |
| Fallback | **0% PASS** (hard max ≤1%) |
| final_tagged_plan | **0/30 fallback PASS** |
| Avg / worst | **4.0 / 4.0 PASS** |
| Hybrid p95 | **155.20 ms PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap | **8/16** report-only |
| Telemetry / leakage / RP / contracts / Playwright | **PASS** |

---

## 5. final_tagged_plan (T20.21B)

| User | hybrid_canary | Fallback | Score |
|------|---------------|----------|-------|
| All 6 users | **5/5 each** | **0** | **4.0** |
| **Total** | **30/30** | **0** | **4.0** |

---

## 6. Latency (T20.21B)

| Scope | Hybrid p50 | Hybrid p95 | Keyword p50 | Keyword p95 |
|-------|------------|------------|-------------|-------------|
| **Aggregate** | **40.34 ms** | **155.20 ms** | **62.10 ms** | **360.90 ms** |

---

## 7. Quality (T20.21B)

| Scope | Avg | Worst |
|-------|-----|-------|
| **Aggregate** | **4.0** | **4.0** |

---

## 8. Shadow pure vs anchored

| Run | Pure | Anchored |
|-----|------|----------|
| 200016 | 8/16 | 16/16 |
| 200047 | 8/16 | 16/16 |
| 200100 | 8/16 | 16/16 |

---

## 9. Rollback proof

Post-eval restore verified:

- `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f`
- `AI_RAG_HYBRID_CANARY_PERCENT=0`
- Contract user → `hybrid_canary` / `allowlist`
- Cohort users → `keyword` / `keyword_default`

---

## 10. Sign-off checklist

| Item | Status |
|------|--------|
| Owner/product sign-off | **ABSENT** |
| Engineering sign-off | **ABSENT** |
| Privacy/leakage sign-off | Evidence **PASS**; formal sign-off **ABSENT** |
| Ops rollback sign-off | Runbook documented; formal sign-off **ABSENT** |
| Observability sign-off | Telemetry 0 WARNs; formal sign-off **ABSENT** |

**Conclusion:** Default switch cannot proceed. Owner sign-off is required and not present in this batch.

---

## 11. Blocker table

| Blocker | Status |
|---------|--------|
| Pure vector 8/16 | **Open** |
| Hybrid anchor dependency | **Open** |
| Production default switch requires owner decision | **Open** |
| Permanent broader allowlist | **Not selected** |

---

## 12. Decision options

### A. ROLLBACK hybrid canary — **Not selected**

2025/2025 live cases, 0% fallback across six evidence batches.

### B. KEEP single-user allowlist canary, percent=0 ✅ **SELECTED**

Operational state unchanged. RFC evidence supports continued allowlist canary, not default switch.

### C. KEEP broader dev/staging allowlist — **Not selected**

No operational reason for permanent broader allowlist.

### D. Recommend T20.22A production-rollout design only — **Not recommended now**

Owner/product sign-off **absent**. T20.22A requires explicit approval phrase and documented sign-off path.

### E. Approve default switch now — **REJECTED**

Sign-off absent; pure vector 8/16; hybrid anchor dependency; blockers unresolved.

---

## 13. Required verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
Default switch: REJECTED
T20.22A: NOT STARTED
```
