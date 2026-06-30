# T20.16D-LIVE — Hybrid production-readiness eval

**Status:** Eval complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `39c708e` (T20.16D)  
**Eval SHA:** `39c708e`  
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

## 2. Preflight

| Check | Result |
|-------|--------|
| Cluster / image `t20-p216b` | **Ready** |
| RAG contract | **PASS** |
| Endpoints contract | **PASS** |
| Provider readiness | **PASS** |
| pgvector readiness | **PASS** |
| OCH | **PASS** |
| Telemetry WARNs (pre) | **0** |

---

## 3. Live transcript — 5 runs (45 cases)

| Run | HTTP 200 | Fallback | Avg score | Worst | Hybrid p95 (ms) |
|-----|----------|----------|-----------|-------|-----------------|
| 160729 | 9/9 | 0 | 4.0 | 4.0 | ~439 |
| 160738 | 9/9 | 0 | 4.0 | 4.0 | — |
| 160744 | 9/9 | 0 | 4.0 | 4.0 | — |
| 160748 | 9/9 | 0 | 4.0 | 4.0 | — |
| 160753 | 9/9 | 0 | 4.0 | 4.0 | — |
| **Aggregate** | **45/45** | **0 (0%)** | **4.0** | **4.0** | **438.85** |

### Retrieval mode counts (45 cases)

| `retrieval_mode` | Count |
|------------------|-------|
| hybrid_canary | **45** |
| keyword_fallback_from_hybrid | **0** |

### Latency (aggregate)

| Metric | Value |
|--------|-------|
| Hybrid p50 / p95 | **104.71 / 438.85 ms** |
| Keyword p50 / p95 | **303.72 / 775.50 ms** |
| Canary errors | **0** |
| Leakage | **PASS** (45/45) |

### `final_tagged_plan` lineage

| Stage | Mode | Fallback | Score | refs |
|-------|------|----------|-------|------|
| T20.15 ladder (pre-B) | keyword_fallback_from_hybrid | yes | 2.0 | 0 |
| T20.16B (post-fix) | hybrid_canary | no | 4.0 | 9 |
| **D-LIVE (5 runs)** | **hybrid_canary** | **0/5** | **4.0** | **9** |

---

## 4. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Overlap anchors | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|-----------------|--------------|----------|------------|
| 120923 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 135.2 ms |
| 120938 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 143.5 ms |
| 120950 | 8/16 | 16/16 | 8/16 | 0/16 | 0 | 142.5 ms |

candidate_fetch p95: **~62–74 ms** across runs.

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL (20 issues)** — owner-visible OBO / route-weight diagnostic class on contract user corpus. **Non-blocking** for D-LIVE: does not affect live transcript gates, leakage, or anchored overlap. Failure class: diagnostic corpus coverage vs weighted-route expectations (same class noted in T20.16C C0).

---

## 5. Lane C controls

| Control | Result |
|---------|--------|
| Fake allowlist (`00000000-…`) | All cases **`keyword`** |
| `AI_RAG_HYBRID_CANARY=0` | All cases **`keyword`** |
| KEEP restore | **`hybrid_canary`** on allowlist transcript |

---

## 6. Playwright

| Suite | Env | Result |
|-------|-----|--------|
| seller-intelligence | KEEP allowlist | **PASS** |
| record RAG | Lane C fake allowlist | **PASS** (avg 3.86, leakage PASS) |
| longform RAG | Lane C fake allowlist | **PASS** (12/12, avg 3.67) |
| Telemetry (post) | KEEP | **0 WARNs** |

---

## 7. Rollback drill

| Step | Proof |
|------|-------|
| `CANARY=0` | Contract user → **`keyword`** all 9 cases |
| KEEP restore | → **`hybrid_canary`** restored |

---

## 8. Gate verdict — **PASS**

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 | 45/45 | **PASS** |
| Fallback rate | ≤5% | **PASS** (0%) |
| `final_tagged_plan` fallback | 0 | **PASS** |
| Avg / worst score | ≥3.5 / ≥3.0 | **PASS** (4.0 / 4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (438.85 ms) |
| Canary errors | 0 | **PASS** |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| OCH | PASS | **PASS** |
| Anchored overlap | ≥10/16 | **PASS** (16/16) |
| True zero-results | 0 | **PASS** |
| Embed timeouts | 0 | **PASS** |
| Playwright | PASS | **PASS** |

---

## 9. Recommendation for E

Proceed to **T20.16E decision package**: select **B** (KEEP allowlist, percent=0); recommend **C** (future scoped soak design only) if owner approves — **reject D** (production default switch).
