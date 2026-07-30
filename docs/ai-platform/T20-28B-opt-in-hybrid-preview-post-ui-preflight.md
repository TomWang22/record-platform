# T20.28B — Opt-in hybrid preview post-UI preflight

**Status:** **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b` (unchanged)

---

## 1. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=589`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 2. Env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## 3. UI/JWT control checks

| Check | Result |
|-------|--------|
| Guest: preview card hidden | **PASS** (Playwright) |
| Contract: card visible; RAG `allowlist` | **PASS** (Playwright) |
| Cohort before enroll: not enrolled + `keyword_default` | **PASS** (Playwright) |
| Cohort UI enroll → `preview_opt_in` | **PASS** (Playwright) |
| Cohort UI revoke → `keyword_default` | **PASS** (Playwright) |
| PERCENT=0 | **PASS** |
| No allowlist broadening | **PASS** |

## 4. Verdict

```text
T20.28B: PASS
T20.28C-LIVE: AUTHORIZED
```
