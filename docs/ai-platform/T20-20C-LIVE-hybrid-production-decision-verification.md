# T20.20C-LIVE — Hybrid production-decision verification

**Status:** Eval complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `f4d0540` (T20.20B)  
**Eval SHA:** `f4d0540`  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Environment

| Phase | State |
|-------|-------|
| During eval | Temporary **6-user** allowlist, PERCENT=0, 2 windows |
| After eval | **Single contract-user** allowlist restored |

---

## 2. Live transcript — 2 windows × 6 users × 5 runs (540 cases)

### Per-window aggregate

| Window | Cases | HTTP 200 | Fallback | Avg | Worst | Hybrid p95 |
|--------|-------|----------|----------|-----|-------|------------|
| 1 | 270 | 270/270 | 0 | 4.0 | 4.0 | 191.25 ms |
| 2 | 270 | 270/270 | 0 | 4.0 | 4.0 | 118.44 ms |
| **Total** | **540** | **540/540** | **0 (0%)** | **4.0** | **4.0** | **141.65 ms** |

### Per-user aggregate (both windows)

| User | Cases | HTTP 200 | Fallback | Avg | Worst | final_tagged_plan |
|------|-------|----------|----------|-----|-------|-------------------|
| e2e-contract | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |
| t20-15g-cohort0 | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |
| t20-15k-cohort1 | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |
| buyer-contract | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |
| t20-15o-bucket10 | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |
| t20-15s-bucket20 | 90 | 90/90 | 0 | 4.0 | 4.0 | hybrid_canary 10/10, fb 0 |

### Retrieval mode (540 cases)

| `retrieval_mode` | Count |
|------------------|-------|
| hybrid_canary | **540** |
| keyword_fallback_from_hybrid | **0** |

### Latency (aggregate)

| Metric | Value |
|--------|-------|
| Hybrid p50 / p95 | **42.53 / 141.65 ms** |
| Keyword p50 / p95 | **63.09 / 326.34 ms** |
| Canary errors | **0** |
| Leakage | **PASS** (540/540) |

---

## 3. Combined live evidence

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| T20.19C-LIVE | 810 | 810/810 | 0% |
| **T20.20C-LIVE** | **540** | **540/540** | **0%** |
| **Combined** | **1755** | **1755/1755** | **0%** |

---

## 4. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|--------------|----------|------------|
| 163846 | 8/16 | 16/16 | 0/16 | 0 | 449.8 ms |
| 163909 | 8/16 | 16/16 | 0/16 | 0 | 135.8 ms |
| 163921 | 8/16 | 16/16 | 0/16 | 0 | 144.2 ms |

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **PASS (0 issues)** during fake-allowlist Playwright window.

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
| HTTP 200 | 540/540 | **PASS** |
| Fallback rate | ≤1% | **PASS** (0%) |
| final_tagged_plan fallback | 0 | **PASS** (0/60) |
| Avg / worst score | ≥3.5 / ≥3.0 | **PASS** (4.0 / 4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (141.65 ms) |
| Anchored overlap | ≥10/16 | **PASS** (16/16) |
| Telemetry / leakage / OCH | PASS | **PASS** |
| Playwright | PASS | **PASS** |

Proceed to **T20.20D** formal production-decision package.
