# T20.17D — Scoped hybrid soak decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-30  
**Baseline SHA:** `ad59260` + C-LIVE eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.17C-LIVE — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.17 scoped soak: evidence strengthened; default rollout NOT APPROVED
```

---

## 2. Evidence summary (T20.16D-LIVE + T20.17C-LIVE)

| Batch | Cases | HTTP 200 | Fallback | Avg score | Hybrid p95 | final_tagged_plan |
|-------|-------|----------|----------|-----------|------------|-------------------|
| T20.16D-LIVE | 45 | 45/45 | 0% | 4.0 | 438.85 ms | hybrid_canary 5/5 |
| **T20.17C-LIVE** | **90** | **90/90** | **0%** | **4.0** | **223.12 ms** | **hybrid_canary 10/10** |

Combined live evidence: **135/135** HTTP 200, **0%** fallback across D-LIVE + C-LIVE.

---

## 3. Gate verdict table

| Gate | T20.16D | T20.17C | Verdict |
|------|---------|---------|---------|
| HTTP 200 | 45/45 | 90/90 | **PASS** |
| Fallback | 0% | 0% | **PASS** |
| final_tagged_plan fallback | 0/5 | 0/10 | **PASS** |
| Avg / worst score | 4.0 / 4.0 | 4.0 / 4.0 | **PASS** |
| Hybrid p95 | 438.85 ms | 223.12 ms | **PASS** |
| Anchored overlap | 16/16 | 16/16 | **PASS** |
| Pure overlap | 8/16 | 8/16 | report-only |
| Telemetry WARNs | 0 | 0 | **PASS** |
| Leakage / OCH | PASS | PASS | **PASS** |
| Playwright | PASS | PASS | **PASS** |

---

## 4. Fallback table

| Scenario | T20.16D (5 runs) | T20.17C (10 runs) |
|----------|------------------|-------------------|
| Total fallback | 0/45 | 0/90 |
| `final_tagged_plan` fallback | 0/5 | 0/10 |
| `keyword_fallback_from_hybrid` | 0 | 0 |

T20.16B remediation holds under **2×** soak volume.

---

## 5. Latency

| Metric | T20.16D | T20.17C |
|--------|---------|---------|
| Hybrid p50 | 104.71 ms | 103.03 ms |
| Hybrid p95 | 438.85 ms | 223.12 ms |
| Keyword p50 | 303.72 ms | 223.32 ms |
| Keyword p95 | 775.50 ms | 759.25 ms |

---

## 6. Shadow pure vs anchored

| Run (C-LIVE) | Pure | Anchored |
|--------------|------|----------|
| 150110 | 8/16 | 16/16 |
| 150127 | 8/16 | 16/16 |
| 150144 | 8/16 | 16/16 |

Pure vector remains **report-only**. Anchored hybrid **16/16** stable.

---

## 7. Rollback proof

From T20.17B + post-eval verification:

| Step | Proof |
|------|-------|
| Fake allowlist | Contract user → **keyword** 9/9 |
| `CANARY=0` | Contract user → **keyword** 9/9 |
| KEEP restore | → **hybrid_canary** 9/9; PERCENT=**0** |

---

## 8. Options

### A. ROLLBACK hybrid canary entirely — **Not selected**

135/135 live cases with 0% fallback; anchored 16/16; no leakage or error spike.

### B. KEEP allowlist canary only, percent=0 ✅ **SELECTED**

Operational state unchanged; soak evidence supports continued allowlist-only hybrid.

### C. Recommend longer / broader scoped soak design ✅ **RECOMMENDED**

All gates passed cleanly at 2× D-LIVE volume. If owner approves **T20.18A** (design-only broader soak), define extended windows or additional scoped cohorts — **not** default rollout.

### D. Approve production default switch — **Rejected**

Vector production default **NOT APPROVED**. Pure overlap **8/16**. Hybrid depends on keyword anchors.

---

## 9. Final env

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

## 10. Next step

**T20.17E** closeout. Optional future: **T20.18A broader hybrid soak design** (owner approval required).

```text
Approved: start T20.18A broader hybrid soak design only
```
