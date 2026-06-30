# T20.19B — Extended hybrid soak preflight

**Status:** Preflight complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `55b2aff` (T20.19A)  
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
| `audit-rp-ai-endpoints-contract.sh` | **PASS** (RAG + seller); `session_reset` degraded — informational |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=589`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## 4. JWT verification (6/6)

| Email | UUID | JWT sub match |
|-------|------|---------------|
| e2e-contract@record-platform.local | `2ed75568-…` | **PASS** |
| t20-15g-cohort0@record-platform.local | `00000040-…` | **PASS** |
| t20-15k-cohort1@record-platform.local | `0000002a-…` | **PASS** |
| buyer-contract@record-platform.local | `5a68fe88-…` | **PASS** |
| t20-15o-bucket20@record-platform.local | `00000002-…` | **PASS** |
| t20-15o-bucket10@record-platform.local | `000001bc-…` | **PASS** |

---

## 5. Control drills

### 5.1 Original KEEP

| User | Expected | Spot probe (post-rollout) |
|------|----------|---------------------------|
| contract | hybrid_canary / allowlist | allowlist gate; may show fallback before embed warmup |
| cohort users | keyword / keyword_default | **PASS** |

### 5.2 Temporary 6-user allowlist

All 6 users: `gate_reason=allowlist` — **PASS**. Mode hybrid_canary vs keyword_fallback corpus-dependent (T20.18 pattern).

### 5.3 Fake allowlist

All 6 users → `keyword` / `keyword_default` — **PASS**

### 5.4 CANARY=0

All 6 users → `keyword` — **PASS**

### 5.5 KEEP restore

Contract allowlisted; cohort → keyword; `PERCENT=0` — **PASS**

---

## 6. Gate verdict — **PASS**

Proceed to **T20.19C-LIVE** (3 windows × 270 cases). Embed warmup required before live transcript (T20.18 lesson).

---

## 7. Broader allowlist string (C-LIVE)

```text
2ed75568-7deb-4c29-91b0-6919f24a0c9f,00000040-0000-4000-8000-000000000000,0000002a-0000-4000-8000-000000000000,5a68fe88-c134-4166-b145-57534a3656b9,000001bc-0000-4000-8000-000000000000,00000002-0000-4000-8000-000000000000
```
