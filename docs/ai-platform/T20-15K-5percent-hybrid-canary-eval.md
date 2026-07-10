# T20.15K — 5% hybrid canary eval

**Status:** Eval complete — **PASS** (percent restored to 0)  
**Generated:** 2026-06-29  
**Baseline SHA:** `42fac2b` (T20.15J)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15J verification-only

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

| Role | Email | UUID | Bucket | Auth |
|------|-------|------|--------|------|
| Allowlist contract | e2e-contract@record-platform.local | `2ed75568-…` | **15** | JWT login |
| Percent cohort 0 | t20-15g-cohort0@record-platform.local | `00000040-…` | **0** | JWT (existing) |
| Percent cohort 1 | t20-15k-cohort1@record-platform.local | `0000002a-…` | **1** | JWT (created) |
| Non-cohort control | buyer-contract@record-platform.local | `5a68fe88-…` | **9** | JWT login |

No header spoofing — JWT `sub` drives gating.

---

## 3. Baseline at PERCENT=0

### Spot checks

| User | `retrieval_mode` | `gate_reason` |
|------|------------------|---------------|
| Contract | hybrid_canary | allowlist |
| Cohort0 | keyword | keyword_default |
| Cohort1 | keyword | keyword_default |
| Buyer | keyword | keyword_default |

### Allowlist transcript (3×9)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** |
| hybrid / fallback | **24/27** / **3/27** |
| Fallback rate | **11.11%** |
| avg score | **3.78** |
| hybrid p50 / p95 | **125 / 312 ms** |
| leakage | **PASS** |

---

## 4. PERCENT=5 eval

### Four-path proof

| Path | User | Expected | Actual | Result |
|------|------|----------|--------|--------|
| Allowlist | contract (bucket 15) | hybrid, allowlist | hybrid_canary, allowlist | **PASS** |
| Cohort bucket 0 | cohort0 | hybrid, percentage | hybrid_canary, percentage | **PASS** |
| Cohort bucket 1 | cohort1 | hybrid, percentage | hybrid_canary, percentage | **PASS** |
| Non-cohort bucket ≥5 | buyer (bucket 9) | keyword, keyword_default | keyword, keyword_default | **PASS** |

### Cohort prompt matrix

8 prompts (4 × cohort0, 4 × cohort1): **8/8 HTTP 200**, all `gate_reason=percentage`.

### Allowlist transcript at PERCENT=5 (3×9)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** |
| hybrid / fallback | **24/27** / **3/27** |
| Fallback rate | **11.11%** |
| avg score | **3.78** |
| hybrid p50 / p95 | **128 / 355 ms** |
| leakage | **PASS** |
| canary errors | **0** |

### Gate reason counts (spot + cohort prompts)

| `gate_reason` | Count |
|---------------|-------|
| allowlist | 1 |
| percentage | 10 |
| keyword_default | 1 |

### Request counts

| Path | Requests |
|------|----------|
| Allowlist transcript | 27 |
| Percentage cohort API | 10 (2 spot + 8 prompts) |
| Keyword default control | 1 (buyer spot) |

---

## 5. Shadow timing (post-restore)

| Metric | Value |
|--------|-------|
| shadow p50 / p95 | **200 / 497 ms** |
| pure overlap >0 | **8/16** |
| anchored overlap >0 | **16/16** |
| true zero-results | **0/16** |
| embed timeouts | **0** |

---

## 6. Playwright

| Suite | Mode | Result |
|-------|------|--------|
| seller-intelligence-ui | Real allowlist | **PASS** |
| ai-rag-record-intelligence | Lane C fake allowlist | **PASS** |
| ai-rag-longform-record-session | Lane C fake allowlist | **PASS** |

---

## 7. Telemetry / contracts / OCH

| Check | Result |
|-------|--------|
| Telemetry WARNs | **0** |
| Contracts (post-restore) | **PASS** |
| OCH | **PASS** |
| Leakage | **PASS** |

---

## 8. Gate verdict

| Gate | Threshold | Result |
|------|-----------|--------|
| Allowlist transcript HTTP 200 | 27/27 | **PASS** |
| Cohort prompts HTTP 200 | all | **PASS** (8/8) |
| Fallback rate | ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 | ≤ 3000 ms | **PASS** (355 ms) |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| Anchored overlap | ≥ 10/16 | **PASS** (16/16) |
| True zero-results | 0 | **PASS** |
| Canary errors | 0 | **PASS** |
| Percent restored | 0 | **PASS** |

**Overall: PASS**

---

## 9. Restore verification

| User | PERCENT=0 `retrieval_mode` | `gate_reason` |
|------|---------------------------|---------------|
| Contract | hybrid_canary | allowlist |
| Cohort0 | keyword | keyword_default |
| Buyer | keyword | keyword_default |

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

Proceed to **T20.15L decision package**. Do not keep PERCENT=5 active.

---

## References

- `docs/ai-platform/T20-15J-5percent-gate-implementation.md`
- `docs/ai-platform/T20-15G-1percent-hybrid-canary-eval.md`
