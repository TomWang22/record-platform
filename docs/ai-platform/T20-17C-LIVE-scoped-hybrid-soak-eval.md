# T20.17C-LIVE — Scoped hybrid soak eval

**Status:** Eval complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `83769d7` (T20.17B preflight)  
**Eval SHA:** `83769d7`  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Environment

| Phase | State |
|-------|-------|
| Before | KEEP env, `t20-p216b`, PERCENT=0 |
| During | Same (no percent window) |
| After | KEEP restored; PERCENT=0 verified |

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

## 2. Live transcript — 10 runs (90 cases)

| Run | HTTP 200 | Fallback | Avg score | Worst | Hybrid p95 (ms) |
|-----|----------|----------|-----------|-------|-----------------|
| 190004 | 9/9 | 0 | 4.0 | 4.0 | 463.9 |
| 190011 | 9/9 | 0 | 4.0 | 4.0 | 147.4 |
| 190016 | 9/9 | 0 | 4.0 | 4.0 | 150.1 |
| 190021 | 9/9 | 0 | 4.0 | 4.0 | 195.6 |
| 190025 | 9/9 | 0 | 4.0 | 4.0 | 197.6 |
| 190035 | 9/9 | 0 | 4.0 | 4.0 | 172.8 |
| 190039 | 9/9 | 0 | 4.0 | 4.0 | 170.3 |
| 190042 | 9/9 | 0 | 4.0 | 4.0 | 168.1 |
| 190046 | 9/9 | 0 | 4.0 | 4.0 | 286.8 |
| 190054 | 9/9 | 0 | 4.0 | 4.0 | 129.3 |
| **Aggregate** | **90/90** | **0 (0%)** | **4.0** | **4.0** | **223.12** |

### Retrieval mode counts (90 cases)

| `retrieval_mode` | Count |
|------------------|-------|
| hybrid_canary | **90** |
| keyword_fallback_from_hybrid | **0** |

### Latency (90-case aggregate)

| Metric | Value |
|--------|-------|
| Hybrid p50 / p95 | **103.03 / 223.12 ms** |
| Keyword p50 / p95 | **223.32 / 759.25 ms** |
| Canary errors | **0** |
| Leakage | **PASS** (90/90) |

### `final_tagged_plan` lineage

| Stage | Mode | Fallback | Score | refs |
|-------|------|----------|-------|------|
| T20.15 ladder (pre-B) | keyword_fallback_from_hybrid | yes | 2.0 | 0 |
| T20.16D-LIVE | hybrid_canary | 0/5 | 4.0 | 9 |
| **T20.17C (10 runs)** | **hybrid_canary** | **0/10** | **4.0** | **9** |

---

## 3. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Overlap anchors | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|-----------------|--------------|----------|------------|
| 150110 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 352.5 ms |
| 150127 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 135.2 ms |
| 150144 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 123.5 ms |

candidate_fetch p95: **~60–70 ms** across runs.

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL (20 issues)** — owner-visible OBO / route-weight diagnostic class on contract user corpus. **Non-blocking** for C-LIVE: live gates, leakage, Lane C controls, and anchored overlap all PASS. Same failure class as T20.16D-LIVE / T20.16C.

---

## 4. Lane C controls (post-eval)

| Control | Result |
|---------|--------|
| Playwright record RAG (fake allowlist) | **keyword** assertions **PASS** (7/7, avg 3.86) |
| Playwright longform RAG (fake allowlist) | **keyword** assertions **PASS** (12/12, avg 3.67) |
| KEEP restore (`190440`) | **`hybrid_canary`** 9/9; `final_tagged_plan` score **4.0** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** verified |

Rollback drill from T20.17B: `CANARY=0` → keyword 9/9; KEEP restore → hybrid_canary **PASS**.

---

## 5. Playwright

| Suite | Env | Result |
|-------|-----|--------|
| seller-intelligence | KEEP allowlist | **PASS** (4/4 panels, seller-ready 950ms) |
| record RAG | Lane C fake allowlist | **PASS** (7/7, avg 3.86, leakage PASS) |
| longform RAG | Lane C fake allowlist | **PASS** (12/12, avg 3.67, final 4.0) |
| Telemetry (post) | KEEP | **0 WARNs** |

---

## 6. Gate verdict — **PASS**

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 | 90/90 | **PASS** |
| Fallback rate | ≤2/90 | **PASS** (0/90) |
| `final_tagged_plan` fallback | 0/10 | **PASS** |
| Avg / worst score | ≥3.5 / ≥3.0 | **PASS** (4.0 / 4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (223.12 ms) |
| Canary errors | 0 | **PASS** |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| OCH | PASS | **PASS** |
| Anchored overlap | ≥10/16 | **PASS** (16/16) |
| Pure overlap | report-only | **8/16** (no promotion) |
| True zero-results | 0 | **PASS** |
| Embed timeouts | 0 | **PASS** |
| Playwright | PASS | **PASS** |
| Rollback drill | PASS | **PASS** (T20.17B) |

---

## 7. Recommendation for D

Proceed to **T20.17D decision package**: select **B** (KEEP allowlist, percent=0); recommend **C** (broader scoped soak design → T20.18A) if owner approves — **reject D** (production default switch).
