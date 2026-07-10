# T20.20B — Hybrid production-decision preflight

**Status:** Preflight complete — **PASS**  
**Generated:** 2026-06-30  
**Plan SHA:** `2de1fe2` (T20.20A)  
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
| `audit-rp-ai-endpoints-contract.sh` | **PASS** (RAG + seller) |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## 4. Evidence audit

| Doc | Status |
|-----|--------|
| `T20-15AG-hybrid-canary-ladder-closeout.md` | **Present** |
| `T20-16F-hybrid-production-readiness-closeout.md` | **Present** |
| `T20-17E-scoped-hybrid-soak-closeout.md` | **Present** |
| `T20-18E-broader-hybrid-soak-closeout.md` | **Present** |
| `T20-19E-extended-hybrid-soak-closeout.md` | **Present** |
| `PHASE_21_COPILOT_CONTEXT.md` | **Reflects T20.19E** (combined 1215/1215) |
| Stale `T20.15AD NOT STARTED` | **Not present** in locked takeaway |
| Stale `t20-p215f` as current image | **Not present** — current image `t20-p216b` |
| Production default | **keyword** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** |

---

## 5. JWT verification (6/6)

| Email | UUID | JWT sub match |
|-------|------|---------------|
| e2e-contract@record-platform.local | `2ed75568-…` | **PASS** |
| t20-15g-cohort0@record-platform.local | `00000040-…` | **PASS** |
| t20-15k-cohort1@record-platform.local | `0000002a-…` | **PASS** |
| buyer-contract@record-platform.local | `5a68fe88-…` | **PASS** |
| t20-15o-bucket10@record-platform.local | `000001bc-…` | **PASS** |
| t20-15s-bucket20@record-platform.local | `00000002-…` | **PASS** |

---

## 6. Control drills

### 6.1 Original KEEP

| User | Mode | gate_reason |
|------|------|-------------|
| contract | hybrid_canary | allowlist |
| cohort users | keyword | keyword_default |

### 6.2 Temporary 6-user allowlist

All 6 users: `hybrid_canary` / `gate_reason=allowlist` — **PASS**

### 6.3 Fake allowlist

All 6 users → `keyword` / `keyword_default` — **PASS**

### 6.4 CANARY=0

All 6 users → `keyword` — **PASS**

### 6.5 KEEP restore

Contract → hybrid_canary / allowlist; cohort → keyword / keyword_default; `PERCENT=0` — **PASS**

---

## 7. Gate verdict — **PASS**

Proceed to **T20.20C-LIVE** (2 windows × 270 cases = 540 target). Embed warmup required before live transcript.

---

## 8. Broader allowlist string (C-LIVE)

```text
2ed75568-7deb-4c29-91b0-6919f24a0c9f,00000040-0000-4000-8000-000000000000,0000002a-0000-4000-8000-000000000000,5a68fe88-c134-4166-b145-57534a3656b9,000001bc-0000-4000-8000-000000000000,00000002-0000-4000-8000-000000000000
```
