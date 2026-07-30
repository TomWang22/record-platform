# T20.18C-LIVE — Broader hybrid soak eval

**Status:** Eval complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `1c60701` (T20.18B)  
**Eval SHA:** `1c60701`  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Environment

| Phase | State |
|-------|-------|
| During eval | Temporary **6-user** allowlist, PERCENT=0 |
| After eval | **Single contract-user** allowlist restored |

### Broader allowlist (eval window only)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-…,00000040-…,0000002a-…,5a68fe88-…,000001bc-…,00000002-…
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## 2. Live transcript — 6 users × 5 runs (270 cases)

| User | Cases | HTTP 200 | Fallback | Avg | Worst | Hybrid p95 | final_tagged_plan |
|------|-------|----------|----------|-----|-------|------------|-------------------|
| e2e-contract | 45 | 45/45 | 0 | 4.0 | 4.0 | 271.0 ms | hybrid_canary 5/5, score 4.0 |
| t20-15g-cohort0 | 45 | 45/45 | 0 | 4.0 | 4.0 | 84.6 ms | hybrid_canary 5/5, score 4.0 |
| t20-15k-cohort1 | 45 | 45/45 | 0 | 4.0 | 4.0 | 49.4 ms | hybrid_canary 5/5, score 4.0 |
| buyer-contract | 45 | 45/45 | 0 | 4.0 | 4.0 | 141.4 ms | hybrid_canary 5/5, score 4.0 |
| t20-15o-bucket10 | 45 | 45/45 | 0 | 4.0 | 4.0 | 54.4 ms | hybrid_canary 5/5, score 4.0 |
| t20-15s-bucket20 | 45 | 45/45 | 0 | 4.0 | 4.0 | 56.7 ms | hybrid_canary 5/5, score 4.0 |
| **Aggregate** | **270** | **270/270** | **0 (0%)** | **4.0** | **4.0** | **145.78 ms** | **hybrid_canary 30/30**, fallback **0** |

### Retrieval mode counts (270 cases)

| `retrieval_mode` | Count |
|------------------|-------|
| hybrid_canary | **270** |
| keyword_fallback_from_hybrid | **0** |

### Latency (aggregate)

| Metric | Value |
|--------|-------|
| Hybrid p50 / p95 | **39.86 / 145.78 ms** |
| Keyword p50 / p95 | **60.78 / 368.46 ms** |
| Canary errors | **0** |
| Leakage | **PASS** (270/270) |

Auth: JWT login for all 6 users; JWT `sub` matched expected UUID (no header spoofing).

---

## 3. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|--------------|----------|------------|
| 153200 | 8/16 | 16/16 | 0/16 | 0 | 327.5 ms |
| 153222 | 8/16 | 16/16 | 0/16 | 0 | 219.2 ms |
| 153234 | 8/16 | 16/16 | 0/16 | 0 | 150.5 ms |

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL (21 issues)** — known OBO/route diagnostic class. **Non-blocking** (live gates, leakage, Lane C controls PASS).

---

## 4. Lane C controls (post-eval)

| Control | Result |
|---------|--------|
| Original KEEP restore | Contract → **hybrid_canary**; cohort → **keyword** |
| Fake allowlist (Playwright window) | record + longform **PASS** (keyword assertions) |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** verified |

---

## 5. Playwright

| Suite | Env | Result |
|-------|-----|--------|
| seller-intelligence | Broader allowlist | **PASS** (4/4, seller-ready 950ms) |
| record RAG | Lane C fake allowlist | **PASS** (7/7, avg 3.86) |
| longform RAG | Lane C fake allowlist | **PASS** (12/12, avg 3.67) |
| Telemetry (post) | KEEP restored | **0 WARNs** |

---

## 6. Combined live evidence (D + C + C18)

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| **T20.18C-LIVE** | **270** | **270/270** | **0%** |
| **Total** | **405** | **405/405** | **0%** |

---

## 7. Gate verdict — **PASS**

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 | 270/270 | **PASS** |
| Fallback rate | ≤2% | **PASS** (0%) |
| `final_tagged_plan` fallback | 0 | **PASS** (0/30) |
| Avg / worst score | ≥3.5 / ≥3.0 | **PASS** (4.0 / 4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (145.78 ms) |
| Authenticated users | ≥3 | **PASS** (6/6) |
| Anchored overlap | ≥10/16 | **PASS** (16/16) |
| Telemetry / leakage / RP | PASS | **PASS** |
| Playwright | PASS | **PASS** |

---

## 8. Recommendation for D

Proceed to **T20.18D**: select **B** (restore single contract-user allowlist operationally); recommend **D** (extended soak / production-readiness design). Technical multi-user pass is clean; operational canary scope remains contract seller user.
