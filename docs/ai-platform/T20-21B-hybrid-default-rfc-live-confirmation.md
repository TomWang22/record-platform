# T20.21B — Hybrid default RFC live confirmation

**Status:** Preflight + live confirmation complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `efd2845` (T20.21A)  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Git status (pre-commit)

Only intended docs committed per ticket; `bench_logs/`, screenshots, and scratch scripts remain untracked.

---

## 2. Cluster snapshot

| Check | Result |
|-------|--------|
| Image | `python-ai-service:t20-p216b` |
| Pod | **Running** 1/1 |
| Service | **Ready** |

### Original KEEP env

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

## 3. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

### Context audit

| Check | Result |
|-------|--------|
| `PHASE_21_COPILOT_CONTEXT.md` reflects T20.20E | **Yes** (pre-T20.21E update pending) |
| Stale `t20-p215f` as current image | **Not present** |
| Combined live 1755/1755 | **Present** |

---

## 4. JWT verification (6/6)

| Email | UUID | JWT sub match |
|-------|------|---------------|
| e2e-contract@record-platform.local | `2ed75568-…` | **PASS** |
| t20-15g-cohort0@record-platform.local | `00000040-…` | **PASS** |
| t20-15k-cohort1@record-platform.local | `0000002a-…` | **PASS** |
| buyer-contract@record-platform.local | `5a68fe88-…` | **PASS** |
| t20-15o-bucket10@record-platform.local | `000001bc-…` | **PASS** |
| t20-15s-bucket20@record-platform.local | `00000002-…` | **PASS** |

---

## 5. Control drills

### 5.1 Original KEEP

Contract → hybrid_canary / allowlist; cohort → keyword / keyword_default — **PASS**

### 5.2 Temporary 6-user allowlist

All 6 users → hybrid_canary / allowlist — **PASS**

### 5.3 Fake allowlist

All 6 users → keyword / keyword_default — **PASS** (during Lane C Playwright)

### 5.4 CANARY=0

All 6 users → keyword — **PASS** (prior batches; not re-run this session)

### 5.5 KEEP restore

Contract → hybrid_canary / allowlist; cohort → keyword; `PERCENT=0` — **PASS**

---

## 6. Live confirmation — 6 users × 5 runs × 9 cases (270)

### Per-user aggregate

| User | Cases | HTTP 200 | Fallback | Avg | Worst | Hybrid p95 | final_tagged_plan |
|------|-------|----------|----------|-----|-------|------------|-------------------|
| e2e-contract | 45 | 45/45 | 0 | 4.0 | 4.0 | 250.94 ms | hybrid 5/5, fb 0 |
| t20-15g-cohort0 | 45 | 45/45 | 0 | 4.0 | 4.0 | 100.05 ms | hybrid 5/5, fb 0 |
| t20-15k-cohort1 | 45 | 45/45 | 0 | 4.0 | 4.0 | 63.93 ms | hybrid 5/5, fb 0 |
| buyer-contract | 45 | 45/45 | 0 | 4.0 | 4.0 | 78.51 ms | hybrid 5/5, fb 0 |
| t20-15o-bucket10 | 45 | 45/45 | 0 | 4.0 | 4.0 | 68.26 ms | hybrid 5/5, fb 0 |
| t20-15s-bucket20 | 45 | 45/45 | 0 | 4.0 | 4.0 | 67.83 ms | hybrid 5/5, fb 0 |

### Aggregate

| Metric | Value |
|--------|-------|
| Total cases | **270** |
| HTTP 200 | **270/270** |
| Fallback | **0 (0%)** |
| Avg / worst score | **4.0 / 4.0** |
| Hybrid p50 / p95 | **40.34 / 155.20 ms** |
| Keyword p50 / p95 | **62.10 / 360.90 ms** |
| `retrieval_mode` | hybrid_canary **270/270** |
| `final_tagged_plan` | hybrid_canary **30/30**, fallback **0** |
| Canary errors | **0** |
| Leakage | **PASS** |

### Combined live (prior + T20.21B)

| Batch | Cases |
|-------|-------|
| T20.16D–T20.20C | 1755 |
| **T20.21B** | **270** |
| **Combined** | **2025/2025** HTTP 200, **0%** fallback |

---

## 7. Shadow supplementary — 3 runs

| Run | Pure | Anchored | Zero-results | Embed TO | Shadow p95 |
|-----|------|----------|--------------|----------|------------|
| 200016 | 8/16 | 16/16 | 0/16 | 0 | 469.8 ms |
| 200047 | 8/16 | 16/16 | 0/16 | 0 | 171.2 ms |
| 200100 | 8/16 | 16/16 | 0/16 | 0 | 237.2 ms |

### Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **PASS (0 issues)** during fake-allowlist window.

---

## 8. Playwright

| Suite | Env | Result |
|-------|-----|--------|
| seller-intelligence | Broader allowlist | **PASS** (4/4) |
| record RAG | Lane C fake allowlist | **PASS** (7/7, avg 3.86) |
| longform RAG | Lane C fake allowlist | **PASS** (12/12, avg 3.67) |
| Telemetry (post-restore) | KEEP restored | **0 WARNs** |

---

## 9. Post-eval restore

| Check | Result |
|-------|--------|
| Single contract allowlist | **Restored** |
| PERCENT=0 | **Verified** |
| Contract → hybrid_canary | **PASS** |
| Cohort → keyword | **PASS** |

---

## 10. Gate verdict — **PASS**

Proceed to **T20.21C** RFC / owner sign-off decision package.
