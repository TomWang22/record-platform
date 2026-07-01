# T20.27D — Opt-in hybrid preview UI deploy preflight

**Status:** **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b` (unchanged)

---

## 1. Deploy

```bash
docker build -f webapp/Dockerfile -t webapp:t20-p227b .
kubectl -n record-platform set image deployment/webapp webapp=webapp:t20-p227b
kubectl -n record-platform rollout status deployment/webapp --timeout=180s
```

Rollout: **SUCCESS**

## 2. Preflight scripts

| Script | Result |
|--------|--------|
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

## 3. Env (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

## 4. JWT + UI control checks

| Check | Result |
|-------|--------|
| Contract: preview card + RAG `allowlist` | **PASS** (Playwright) |
| Cohort before enroll: not enrolled + `keyword_default` | **PASS** |
| Cohort UI enroll → `preview_opt_in` | **PASS** (Playwright) |
| Cohort UI revoke → `keyword_default` | **PASS** (Playwright) |
| PERCENT=0 | **PASS** |
| No allowlist broadening | **PASS** |
| Enrollments revoked post-audit | **PASS** |

## 5. Verdict

```text
T20.27D: PASS
T20.27E-LIVE: AUTHORIZED
```
