# T20.15AE — 100% hybrid canary eval

**Status:** Eval complete — **PASS** (percent restored to 0)  
**Generated:** 2026-06-30  
**Baseline SHA:** `5155fd0` (T20.15AD)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15AD verification-only

---

## 1. Preflight health

| Check | Result |
|-------|--------|
| Cluster pods | **Ready** |
| Image | **t20-p215f** |
| pgvector / HNSW | **PASS** |
| Starting PERCENT | **0** |
| Telemetry WARNs (pre) | **0** |
| Contracts / RP (pre) | **PASS** |
| Allowlist transcript 3×9 (pre) | **27/27**, fallback **11.11%** |

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
| Percent cohort 60 | t20-15aa-bucket60@record-platform.local | **60** | JWT |
| Percent cohort 75 | t20-15aa-bucket75@record-platform.local | **75** | JWT |
| Percent cohort 95 | t20-15ae-bucket95@record-platform.local | **95** | JWT (created) |

No header spoofing — JWT `sub` drives gating.

---

## 3. Baseline at PERCENT=0

All non-allowlisted cohort users → `keyword` / `keyword_default`. Allowlist → `hybrid_canary` / `allowlist`. Baseline transcript: **27/27**, fallback **11.11%**, hybrid p50/p95 **115.2 / 332.18 ms**, leakage **PASS**.

---

## 4. PERCENT=100 eval

### Proof paths

| Path | Result |
|------|--------|
| Allowlist bucket 15 | hybrid_canary / allowlist **PASS** |
| Cohort buckets 0, 1, 9, 10, 20, 25, 30, 50, 60, 75, 95 | hybrid_canary / percentage **PASS** |
| Unauthenticated | HTTP **401** (no hybrid exposure) **PASS** |
| Invalid UUID gate | keyword_default verified in AD unit tests; live API uses JWT `sub` only |

At PERCENT=100 all valid authenticated cohort UUIDs (buckets 0–99) correctly enter percentage cohort. No separate non-cohort UUID exists at 100%; unauthenticated control proves non-hybrid path.

### Cohort prompt matrix

66 prompts (6 × 11 percentage cohort users): **66/66 HTTP 200**, fallback **0/66** (0%).

Prompt themes: listing advice, negotiation strategy, collector metadata, pricing strategy, auction pressure, daily action plan.

### Allowlist transcript at PERCENT=100 (3×9)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** |
| Fallback rate | **11.11%** (3/27) |
| avg score | **3.78** |
| hybrid p50 / p95 | **110.29 / 345.97 ms** |
| keyword p50 / p95 | **389.22 / 960.61 ms** |
| leakage | **PASS** |
| canary errors | **0** |

### Gate reason counts (PERCENT=100)

| `gate_reason` | Count |
|---------------|-------|
| allowlist | 1 |
| percentage | 78 |
| none | 1 (unauthenticated) |

---

## 5. Shadow timing (post-restore)

pure **8/16** · anchored **16/16** · zero-results **0/16** · embed timeouts **0** · shadow p50/p95 **129.0 / 277.5 ms**

---

## 6. Playwright

| Suite | Result |
|-------|--------|
| seller-intelligence (real allowlist) | **PASS** |
| record RAG (Lane C fake allowlist) | **PASS** |
| longform RAG (Lane C fake allowlist) | **PASS** |

---

## 7. Telemetry / contracts / RP / source diagnostic

| Check | Result |
|-------|--------|
| Telemetry WARNs | **0 PASS** |
| RAG contract | **PASS** |
| Endpoints contract (post-restore) | **PASS** |
| RP | **PASS** |
| Leakage | **PASS** |
| Source diagnostic (Lane C) | **PASS** |

---

## 8. Post-restore proof (PERCENT=0)

| User | retrieval_mode | gate_reason |
|------|----------------|-------------|
| Allowlist contract | hybrid_canary | allowlist |
| All percentage cohort users | keyword | keyword_default |

Env confirmed: `AI_RAG_HYBRID_CANARY_PERCENT=0`.

---

## 9. Gate verdict — **PASS**

| Gate | Result |
|------|--------|
| Allowlist transcript HTTP 200 | **27/27 PASS** |
| Cohort prompts HTTP 200 | **66/66 PASS** |
| Fallback ≤ 15% | **PASS** (11.11% transcript; 0% cohort matrix) |
| Hybrid p95 ≤ 3000 ms | **PASS** (345.97 ms) |
| Telemetry WARNs | **0 PASS** |
| Leakage | **PASS** |
| Anchored overlap | **16/16 PASS** |
| Pure overlap (reported) | **8/16** |
| Percent restored | **PASS** |
| Playwright / source diagnostic / RP | **PASS** |

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
```

---

## 11. Recommendation

Proceed to **T20.15AF decision package**. Do not keep PERCENT=100 active.
