# T20.15AA — 75% hybrid canary eval

**Status:** Eval complete — **PASS** (percent restored to 0)  
**Generated:** 2026-06-29  
**Baseline SHA:** `b178160` (T20.15Z)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15Z verification-only

---

## 1. Preflight health

| Check | Result |
|-------|--------|
| Cluster pods | **Ready** |
| Image | **t20-p215f** |
| pgvector / HNSW | **PASS** |
| Starting PERCENT | **0** |
| Telemetry WARNs (pre) | **0** |
| Contracts / OCH (pre) | **PASS** |

---

## 2. Cohort user table

| Role | Email | Bucket | Auth |
|------|-------|--------|------|
| Allowlist contract | e2e-contract@record-platform.local | **15** | JWT |
| Percent cohort 0 | t20-15g-cohort0@record-platform.local | **0** | JWT |
| Percent cohort 1 | t20-15k-cohort1@record-platform.local | **1** | JWT |
| Percent cohort 9 | buyer-contract@record-platform.local | **9** | JWT |
| Percent cohort 10 | t20-15o-bucket10@record-platform.local | **10** | JWT |
| Percent cohort 20 | t20-15s-bucket20@record-platform.local | **20** | JWT |
| Percent cohort 25 | t20-15s-bucket25@record-platform.local | **25** | JWT |
| Percent cohort 30 | t20-15w-bucket30@record-platform.local | **30** | JWT |
| Percent cohort 50 | t20-15w-bucket50@record-platform.local | **50** | JWT |
| Percent cohort 60 | t20-15aa-bucket60@record-platform.local | **60** | JWT (created) |
| Non-cohort ≥75 | t20-15aa-bucket75@record-platform.local | **75** | JWT (created) |

No header spoofing — JWT `sub` drives gating.

---

## 3. Baseline at PERCENT=0

All non-allowlisted → `keyword` / `keyword_default`. Allowlist transcript: **27/27**, fallback **11.11%**, hybrid p50/p95 **125 / 264 ms**, leakage **PASS**.

---

## 4. PERCENT=75 eval

### Proof paths

| Path | Result |
|------|--------|
| Allowlist bucket 15 | hybrid_canary / allowlist **PASS** |
| Cohort buckets 0–74 (9 users) | hybrid_canary / percentage **PASS** |
| Non-cohort bucket ≥75 | keyword / keyword_default **PASS** |

### Cohort prompt matrix

36 prompts (4 × 9 percentage cohort users): **36/36 HTTP 200**.

### Allowlist transcript at PERCENT=75 (3×9)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** |
| Fallback rate | **11.11%** (3/27) |
| avg score | **3.78** |
| hybrid p50 / p95 | **110.98 / 472.88 ms** |
| leakage | **PASS** |
| canary errors | **0** |

### Gate reason counts

| `gate_reason` | Count |
|---------------|-------|
| allowlist | 1 |
| percentage | 45 |
| keyword_default | 1 |

---

## 5. Shadow timing (post-restore)

pure **8/16** · anchored **16/16** · zero-results **0** · embed timeouts **0** · shadow p50/p95 **101.5 / 326 ms**

---

## 6. Playwright

seller-intelligence **PASS** · record RAG (Lane C) **PASS** · longform RAG (Lane C) **PASS**

---

## 7. Telemetry / contracts / OCH / source diagnostic

Telemetry WARNs **0** · contracts **PASS** · OCH **PASS** · leakage **PASS** · source diagnostic **PASS** (Lane C)

---

## 8. Gate verdict — **PASS**

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
```

---

## 10. Recommendation

Proceed to **T20.15AB decision package**. Do not keep PERCENT=75 active.
