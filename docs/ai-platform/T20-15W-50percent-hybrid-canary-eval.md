# T20.15W — 50% hybrid canary eval

**Status:** Eval complete — **PASS** (percent restored to 0)  
**Generated:** 2026-06-29  
**Baseline SHA:** `517d85f` (T20.15V)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15V verification-only

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

---

## 2. Cohort user table

| Role | Email | UUID | Bucket | Auth |
|------|-------|------|--------|------|
| Allowlist contract | e2e-contract@record-platform.local | `2ed75568-…` | **15** | JWT login |
| Percent cohort 0 | t20-15g-cohort0@record-platform.local | `00000040-…` | **0** | JWT (existing) |
| Percent cohort 1 | t20-15k-cohort1@record-platform.local | `0000002a-…` | **1** | JWT (existing) |
| Percent cohort 9 | buyer-contract@record-platform.local | `5a68fe88-…` | **9** | JWT login |
| Percent cohort 10 | t20-15o-bucket10@record-platform.local | `000001bc-…` | **10** | JWT (existing) |
| Percent cohort 20 | t20-15s-bucket20@record-platform.local | `00000002-…` | **20** | JWT (existing) |
| Percent cohort 25 | t20-15s-bucket25@record-platform.local | `0000003b-…` | **25** | JWT (existing) |
| Percent cohort 30 | t20-15w-bucket30@record-platform.local | `000000f4-…` | **30** | JWT (created) |
| Non-cohort ≥50 | t20-15w-bucket50@record-platform.local | `0000017b-…` | **50** | JWT (created) |

No header spoofing — JWT `sub` drives gating.

---

## 3. Baseline at PERCENT=0

All non-allowlisted users → `keyword` / `keyword_default`. Allowlist transcript: **27/27**, fallback **11.11%**, hybrid p50/p95 **~124 / 515 ms**, leakage **PASS**.

---

## 4. PERCENT=50 eval

### Proof paths

| Path | User | Expected | Actual | Result |
|------|------|----------|--------|--------|
| Allowlist | contract (bucket 15) | hybrid, allowlist | hybrid_canary, allowlist | **PASS** |
| Cohort buckets 0–49 | cohort0/1/9/10/20/25/30 | hybrid, percentage | hybrid_canary, percentage | **PASS** |
| Non-cohort bucket ≥50 | bucket50 | keyword, keyword_default | keyword, keyword_default | **PASS** |

### Cohort prompt matrix

28 prompts (4 × each of 7 percentage cohort users): **28/28 HTTP 200**, all `gate_reason=percentage`.

### Allowlist transcript at PERCENT=50 (3×9)

| Metric | Value |
|--------|-------|
| HTTP 200 | **27/27** |
| hybrid / fallback | **24/27** / **3/27** |
| Fallback rate | **11.11%** |
| avg score | **3.78** |
| hybrid p50 / p95 | **123.62 / 514.96 ms** |
| leakage | **PASS** |
| canary errors | **0** |

### Gate reason counts (spot + cohort prompts)

| `gate_reason` | Count |
|---------------|-------|
| allowlist | 1 |
| percentage | 35 |
| keyword_default | 1 |

### Request counts

| Path | Requests |
|------|----------|
| Allowlist transcript | 27 |
| Percentage cohort API | 37 (9 spot + 28 prompts) |
| Keyword default control | 1 (bucket50 spot) |

---

## 5. Shadow timing (post-restore)

| Metric | Value |
|--------|-------|
| shadow p50 / p95 | **161.5 / 292.8 ms** |
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

## 7. Telemetry / contracts / RP / source diagnostic

| Check | Result |
|-------|--------|
| Telemetry WARNs | **0** |
| Contracts (post-restore) | **PASS** |
| RP | **PASS** |
| Leakage | **PASS** |
| Source diagnostic | **PASS** (Lane C fake allowlist) |

---

## 8. Gate verdict

| Gate | Threshold | Result |
|------|-----------|--------|
| Allowlist transcript HTTP 200 | 27/27 | **PASS** |
| Cohort prompts HTTP 200 | all | **PASS** (28/28) |
| Fallback rate | ≤ 15% | **PASS** (11.11%) |
| Hybrid p95 | ≤ 3000 ms | **PASS** (514.96 ms) |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| Anchored overlap | ≥ 10/16 | **PASS** (16/16) |
| True zero-results | 0 | **PASS** |
| Canary errors | 0 | **PASS** |
| Percent restored | 0 | **PASS** |
| Playwright | PASS | **PASS** |
| Source diagnostic | PASS | **PASS** (Lane C) |

**Overall: PASS**

---

## 9. Restore verification

All percentage cohort users and bucket50 → `keyword` / `keyword_default`. Contract user → `hybrid_canary` / `allowlist`. `PERCENT=0` in env.

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

Proceed to **T20.15X decision package**. Do not keep PERCENT=50 active.

---

## References

- `docs/ai-platform/T20-15V-50percent-gate-implementation.md`
- `docs/ai-platform/T20-15S-25percent-hybrid-canary-eval.md`
- `docs/ai-platform/T20-15U-50percent-hybrid-canary-design.md`
