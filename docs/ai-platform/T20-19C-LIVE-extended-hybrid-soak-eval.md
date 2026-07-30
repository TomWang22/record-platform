# T20.19C-LIVE — Extended hybrid soak eval

**Status:** Eval complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `2b35ee3` (T20.19B)  
**Eval SHA:** `2b35ee3`  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Environment

| Phase | State |
|-------|-------|
| During eval | Temporary **6-user** allowlist, PERCENT=0, 3 windows |
| After eval | **Single contract-user** allowlist restored |

---

## 2. Live transcript — 3 windows × 6 users × 5 runs (810 cases)

### Per-window aggregate

| Window | Cases | HTTP 200 | Fallback | Avg | Worst | Hybrid p95 |
|--------|-------|----------|----------|-----|-------|------------|
| 1 | 270 | 270/270 | 0 | 4.0 | 4.0 | 156.2 ms |
| 2 | 270 | 270/270 | 0 | 4.0 | 4.0 | 122.4 ms |
| 3 | 270 | 270/270 | 0 | 4.0 | 4.0 | 108.5 ms |
| **Total** | **810** | **810/810** | **0 (0%)** | **4.0** | **4.0** | **119.34 ms** |

One transient JSON error on bucket20 W2 run 1 was **retried** (9 cases recovered); final count **810/810**.

### Per-user aggregate (all windows)

| User | Cases | HTTP 200 | Fallback | Avg | Worst | final_tagged_plan |
|------|-------|----------|----------|-----|-------|-------------------|
| e2e-contract | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |
| t20-15g-cohort0 | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |
| t20-15k-cohort1 | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |
| buyer-contract | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |
| t20-15o-bucket10 | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |
| t20-15s-bucket20 | 135 | 135/135 | 0 | 4.0 | 4.0 | hybrid_canary 15/15, fb 0 |

### Retrieval mode (810 cases)

| `retrieval_mode` | Count |
|------------------|-------|
| hybrid_canary | **810** |
| keyword_fallback_from_hybrid | **0** |

### Latency (aggregate)

| Metric | Value |
|--------|-------|
| Hybrid p50 / p95 | **37.34 / 119.34 ms** |
| Keyword p50 / p95 | **59.92 / 254.19 ms** |
| Canary errors | **0** |
| Leakage | **PASS** (810/810) |

---

## 3. Combined live evidence

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| **T20.19C-LIVE** | **810** | **810/810** | **0%** |
| **Combined** | **1215** | **1215/1215** | **0%** |

---

## 4. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|--------------|----------|------------|
| 155328 | 8/16 | 16/16 | 0/16 | 0 | 353.2 ms |
| 155349 | 8/16 | 16/16 | 0/16 | 0 | 206.0 ms |
| 155402 | 8/16 | 16/16 | 0/16 | 0 | 135.8 ms |

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL (38 issues)** during fake-allowlist Playwright window — known OBO/route diagnostic class. **Non-blocking**: live gates, leakage, anchored overlap, Lane C controls **PASS**.

---

## 5. Playwright

| Suite | Env | Result |
|-------|-----|--------|
| seller-intelligence | Broader allowlist | **PASS** (4/4) |
| record RAG | Lane C fake allowlist | **PASS** (7/7, avg 3.86) |
| longform RAG | Lane C fake allowlist | **PASS** (12/12, avg 3.67) |
| Telemetry (post) | KEEP restored | **0 WARNs** |

---

## 6. Post-eval restore

| Check | Result |
|-------|--------|
| Single contract allowlist | **Restored** |
| PERCENT=0 | **Verified** |
| Contract → hybrid_canary | **PASS** |
| Cohort → keyword | **PASS** |

---

## 7. Gate verdict — **PASS**

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 | 810/810 | **PASS** |
| Fallback rate | ≤1% | **PASS** (0%) |
| final_tagged_plan fallback | 0 | **PASS** (0/90) |
| Avg / worst score | ≥3.5 / ≥3.0 | **PASS** (4.0 / 4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (119.34 ms) |
| Anchored overlap | ≥10/16 | **PASS** (16/16) |
| Telemetry / leakage / RP | PASS | **PASS** |
| Playwright | PASS | **PASS** |

Proceed to **T20.19D** decision package.
