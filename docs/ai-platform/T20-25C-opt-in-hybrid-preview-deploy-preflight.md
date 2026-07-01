# T20.25C — Opt-in hybrid preview deploy and preflight

**Status:** Preflight **PASS**  
**Generated:** 2026-07-01  
**Implementation SHA:** `2f3f11e`  
**Image:** `python-ai-service:t20-p225b`

---

## 1. Deploy

```bash
kubectl -n record-platform set image deployment/python-ai-service app=python-ai-service:t20-p225b
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

Rollout: **SUCCESS** (1/1 Running).

DDL applied: `infra/db/11-ai-rag-preview-enrollment.sql` on `python_ai` (port 5440).

## 2. Env (unchanged constraints)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Production default: **keyword**  
Vector production default: **NOT APPROVED**  
Hybrid production default: **NOT APPROVED**

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

## 4. Control checks (JWT, no header spoofing)

| Check | Expected | Result |
|-------|----------|--------|
| Contract allowlist user | `hybrid_canary` / `allowlist` | **PASS** |
| Cohort non-enrolled | `keyword` / `keyword_default` | **PASS** |
| Cohort after `POST /api/ai/rag/preview/enroll` | `hybrid_canary` / `preview_opt_in` | **PASS** |
| `preview_opt_in` telemetry | `true` when enrolled | **PASS** |
| `PERCENT` | `0` | **PASS** |

## 5. Verdict

```text
T20.25C: PASS
T20.25D-LIVE: AUTHORIZED
```
