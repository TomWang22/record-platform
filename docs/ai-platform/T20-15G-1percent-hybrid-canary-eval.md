# T20.15G — 1% hybrid canary eval window

**Status:** Eval complete — **PASS** (percent restored to 0)  
**Generated:** 2026-06-29  
**Baseline SHA:** `75fd3f7` (T20.15F)  
**Image:** `python-ai-service:t20-p215f`  
**Parent:** T20.15F — percentage gate deployed at percent=0

---

## Purpose

Prove **three independent hybrid canary paths** during a bounded `AI_RAG_HYBRID_CANARY_PERCENT=1` eval window, then **restore percent to 0**.

```text
Hybrid canary evidence collection — NOT vector production rollout.
```

---

## 1. Preflight health (G0)

| Check | Result |
|-------|--------|
| Colima/k3s pods | **Running** (all core services Ready) |
| Image | **python-ai-service:t20-p215f** |
| HNSW / pgvector readiness | **PASS** (`rp-ai-pgvector-readiness.sh`) |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** (pre-eval) |
| Contract user bucket | **15** (`2ed75568-7deb-4c29-91b0-6919f24a0c9f`) |
| PERCENT=1 excludes contract user via percentage | **Confirmed** (bucket 15 ≥ 1) |

### Contract / readiness scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** |

### Python-ai tests (docker)

| Suite | Result |
|-------|--------|
| Hybrid canary (15B + 15F) | **27/27 PASS** |
| Full unittest | **282 PASS**, **4 ERROR** (unchanged from T20.15F) |

Pre-existing errors (signatures unchanged):

- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_messages_absent_without_opt_in`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_no_proxy_max_in_retrieval`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_owner_doc_not_visible_to_other_user`
- `test_rag_retrieval.TestRetrievalPrivacyIntegration.test_source_refs_always_present_when_chunks`

---

## 2. Cohort user selection proof (G1)

**Problem:** Allowlisted contract user is bucket **15**; `PERCENT=1` cannot prove percentage cohort via contract user alone.

**Solution:** Created dedicated dev/staging cohort user with deterministic bucket **0**.

| Field | Value |
|-------|-------|
| `cohort_user_id` | `00000040-0000-4000-8000-000000000000` |
| `cohort_email` | `t20-15g-cohort0@record-platform.local` |
| `percentage_bucket` | **0** |
| Auth | `/api/auth/login` with `ContractPass123!` (JWT `sub` matches fixed UUID) |
| Created | **Yes** — idempotent `INSERT` into `auth.users` (dev auth DB) |
| Not allowlisted | **Confirmed** |
| Cleanup | User retained as reusable T20.15G test utility; no data mutation beyond auth row |

**No header spoofing** — JWT identity drives gating (T20.15C/D-T lesson preserved).

### Bucket reference table

| User | UUID | Bucket | Allowlisted | PERCENT=0 | PERCENT=1 |
|------|------|--------|-------------|-----------|-----------|
| e2e-contract | `2ed75568-…` | **15** | yes | hybrid (allowlist) | hybrid (allowlist) |
| t20-15g-cohort0 | `00000040-…` | **0** | no | keyword | **hybrid (percentage)** |
| buyer-contract | `5a68fe88-…` | **9** | no | keyword | keyword |

---

## 3. Baseline at percent=0 (G2)

### Spot checks

| Case | `retrieval_mode` | `gate_reason` | Result |
|------|------------------|---------------|--------|
| Allowlisted contract user | `hybrid_canary` | `allowlist` | **PASS** |
| Fake allowlist control | `keyword` | `keyword_default` | **PASS** |
| Cohort bucket-0 user | `keyword` | `keyword_default` | **PASS** |
| Buyer non-cohort (bucket 9) | `keyword` | `keyword_default` | **PASS** |

### Allowlist transcript (3×9)

| Metric | Baseline |
|--------|----------|
| HTTP 200 | **27/27** |
| hybrid_canary | **24/27** |
| keyword_fallback | **3/27** (`final_tagged_plan`) |
| avg / worst score | **3.78 / 2.0** |
| hybrid p50 / p95 | **108 / 229 ms** |
| keyword p50 / p95 | **285 / 503 ms** |
| leakage | **PASS** |

### Shadow timing (post-restore snapshot)

| Metric | Value |
|--------|-------|
| shadow p50 / p95 | **139 / 418 ms** |
| pure doc/entity overlap >0 | **8/16** |
| anchored doc/entity overlap >0 | **16/16** |
| true zero-results | **0/16** |
| embed timeouts | **0** |

### Telemetry

| Metric | Value |
|--------|-------|
| WARNs | **0** |

---

## 4. Percent=1 eval window (G3–G4)

```bash
kubectl -n record-platform set env deployment/python-ai-service AI_RAG_HYBRID_CANARY_PERCENT=1
# allowlist unchanged; ALLOW_PROD_PERCENT=0
```

`KUBERNETES_NAMESPACE` not set in pod → **no `prod_percent_blocked`** during eval.

### Three-path proof (G4)

| Case | Expected | Actual | Result |
|------|----------|--------|--------|
| A. Allowlisted contract user | `hybrid_canary`, `allowlist` | `hybrid_canary`, `allowlist` | **PASS** |
| B. Cohort bucket-0 user | `hybrid_canary`, `percentage`, bucket=0 | `hybrid_canary`, `percentage`, bucket=0, cohort=true | **PASS** |
| C. Buyer non-cohort (bucket 9) | `keyword`, `keyword_default` | `keyword`, `keyword_default` | **PASS** |

Cohort user — 3 additional RAG prompts at PERCENT=1: **3/3 HTTP 200**, all `gate_reason=percentage`.

### Allowlist transcript at PERCENT=1 (3×9)

| Metric | PERCENT=1 |
|--------|-----------|
| HTTP 200 | **27/27** |
| hybrid_canary | **24/27** |
| keyword_fallback | **3/27** (11.1%) |
| avg / worst score | **3.78 / 2.0** |
| hybrid p50 / p95 | **93 / 223 ms** |
| keyword p50 / p95 | **229 / 472 ms** |
| leakage | **PASS** |
| canary errors | **0** |

### Gate reason counts (spot + cohort prompts)

| `gate_reason` | Count |
|---------------|-------|
| `allowlist` | 1 |
| `percentage` | 4 |
| `keyword_default` | 1 |
| `prod_percent_blocked` | 0 |

### Cohort stats

| Stat | Value |
|------|-------|
| Allowlist users exercised | 1 (contract) |
| Percentage cohort users exercised | 1 (`t20-15g-cohort0`) |
| Keyword-default non-cohort users exercised | 1 (buyer-contract) |
| Allowlist transcript requests | 27 |
| Percentage cohort API requests | 4 (1 spot + 3 prompts) |
| Fallback count (allowlist transcript) | 3 |
| Error count | 0 |

### Required gates

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 (allowlist transcript) | 27/27 | **PASS** |
| Percentage cohort API | all 200 | **PASS** |
| Canary errors | 0 | **PASS** |
| Fallback rate | ≤ 15% | **PASS** (11.1%) |
| Hybrid p95 | ≤ 3000 ms | **PASS** (223 ms) |
| Telemetry WARNs | 0 | **PASS** |
| Leakage | PASS | **PASS** |
| Anchored overlap | ≥ 10/16 | **PASS** (16/16) |
| True zero-results | 0 | **PASS** |
| Pure overlap | report only | **8/16** |

### Playwright

| Suite | Mode | Result |
|-------|------|--------|
| `seller-intelligence-ui.spec.ts` | Real allowlist, percent=0 restored | **PASS** (4/4 panels) |
| `ai-rag-record-intelligence.spec.ts` | **Lane C:** fake allowlist → keyword control | **PASS** |
| `ai-rag-longform-record-session.spec.ts` | **Lane C:** fake allowlist → keyword control | **PASS** |

Record/longform assert `retrieval_mode=keyword`; run with temporary fake allowlist (D-T pattern), then KEEP restored.

---

## 5. Restore (G5)

```bash
kubectl -n record-platform set env deployment/python-ai-service AI_RAG_HYBRID_CANARY_PERCENT=0
kubectl -n record-platform rollout restart deployment/python-ai-service
```

### Post-restore verification

| Case | `retrieval_mode` | `gate_reason` | Result |
|------|------------------|---------------|--------|
| Allowlisted contract user | `hybrid_canary` | `allowlist` | **PASS** |
| Cohort bucket-0 user | `keyword` | `keyword_default` | **PASS** |
| Fake allowlist control | `keyword` | `keyword_default` | **PASS** |

**PERCENT not kept at 1** — default restore to **0** applied.

---

## 6. Final cluster env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Image: `python-ai-service:t20-p215f`

---

## 7. Verdict

```text
T20.15G 1% hybrid canary eval: PASS
Three paths proven: allowlist | percentage cohort | keyword_default
Percent restored to 0
Vector production default: NOT APPROVED
T20.15H: NOT STARTED
```

---

## 8. Decision input for T20.15H

| Option | Evidence |
|--------|----------|
| KEEP allowlist + percent=0 | All gates PASS; percentage cohort proven for bucket-0 user; contract user unaffected by PERCENT=1 |
| Extend percentage | Requires new owner approval; prod namespace blocks percent unless `ALLOW_PROD_PERCENT=1` |
| ROLLBACK | Not indicated — no gate failures |

---

## Required next approval phrase

```text
Approved: start T20.15H hybrid canary decision package
```

---

## References

- `docs/ai-platform/T20-15F-hybrid-percentage-gate-implementation.md`
- `docs/ai-platform/T20-15E-limited-percentage-hybrid-canary-design.md`
- `docs/ai-platform/T20-15D-T-hybrid-canary-control-and-rollback-drill.md`
