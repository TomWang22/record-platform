# T20.18B — Broader hybrid soak preflight

**Status:** Preflight complete — **PASS** (controls verified)  
**Generated:** 2026-06-30  
**Plan SHA:** `607fb33` (T20.18A)  
**Image:** `python-ai-service:t20-p216b`

---

## 1. Cluster snapshot

| Check | Result |
|-------|--------|
| Image | `python-ai-service:t20-p216b` |
| Pod | **Running** 1/1 |
| Service | **Ready** |

### Original KEEP env (verified)

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

## 2. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** (RAG + seller); `session_reset` degraded — no active session (informational) |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## 3. Cohort JWT verification (6/6)

| Email | UUID | JWT sub match | Auth |
|-------|------|---------------|------|
| e2e-contract@record-platform.local | `2ed75568-…` | **yes** | **PASS** |
| t20-15g-cohort0@record-platform.local | `00000040-…` | **yes** | **PASS** |
| t20-15k-cohort1@record-platform.local | `0000002a-…` | **yes** | **PASS** |
| buyer-contract@record-platform.local | `5a68fe88-…` | **yes** | **PASS** |
| t20-15o-bucket10@record-platform.local | `000001bc-…` | **yes** | **PASS** |
| t20-15s-bucket20@record-platform.local | `00000002-…` | **yes** | **PASS** |

At original KEEP (contract-only allowlist): contract → `hybrid_canary`/`allowlist`; cohort users → `keyword`/`keyword_default`. **PASS**.

---

## 4. Control drills

### 4.1 Original KEEP — contract user

| Metric | Result |
|--------|--------|
| Contract user | `hybrid_canary` / `allowlist` |
| Cohort users (not allowlisted) | `keyword` / `keyword_default` |

### 4.2 Temporary broader allowlist (6 UUIDs)

Allowlist: contract + 5 cohort UUIDs (comma-separated).

Spot probe (listing_advice prompt, post-rollout):

| User | retrieval_mode | gate_reason | Note |
|------|----------------|-------------|------|
| e2e-contract | keyword_fallback_from_hybrid | allowlist | seller corpus; hybrid path attempted |
| t20-15g-cohort0 | keyword_fallback_from_hybrid | allowlist | sparse seller data expected |
| t20-15k-cohort1 | keyword_fallback_from_hybrid | allowlist | sparse seller data expected |
| buyer-contract | **hybrid_canary** | allowlist | hybrid path clean |
| t20-15o-bucket10 | keyword_fallback_from_hybrid | allowlist | sparse seller data expected |
| t20-15s-bucket20 | keyword_fallback_from_hybrid | allowlist | sparse seller data expected |

**Control PASS:** all allowlisted users show `gate_reason=allowlist` (gating correct). Fallback vs hybrid_canary is corpus-dependent — scored honestly in C-LIVE.

### 4.3 Fake allowlist

`AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=00000000-…`

| User | Result |
|------|--------|
| contract | `keyword` / `keyword_default` |
| buyer-contract | `keyword` / `keyword_default` |

**PASS**

### 4.4 CANARY=0 rollback

| User | Result |
|------|--------|
| contract | `keyword` |
| buyer-contract | `keyword` |

**PASS**

### 4.5 KEEP restore

Original single contract-user allowlist restored; `PERCENT=0` verified.

---

## 5. Gate verdict — **PASS**

Proceed to **T20.18C-LIVE** multi-user soak (broader allowlist during eval window).

---

## 6. Cohort allowlist string (C-LIVE)

```text
2ed75568-7deb-4c29-91b0-6919f24a0c9f,00000040-0000-4000-8000-000000000000,0000002a-0000-4000-8000-000000000000,5a68fe88-c134-4166-b145-57534a3656b9,000001bc-0000-4000-8000-000000000000,00000002-0000-4000-8000-000000000000
```

Password for all cohort users: `ContractPass123!` (T20.15 pattern).
