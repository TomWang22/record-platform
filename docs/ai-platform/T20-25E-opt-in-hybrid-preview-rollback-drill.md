# T20.25E — Opt-in hybrid preview rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-01  
**Image:** `python-ai-service:t20-p225b`

---

## 1. Revoke all preview enrollments

| User | `POST /api/ai/rag/preview/revoke` | Result |
|------|-----------------------------------|--------|
| t20-15g-cohort0 | revoked | **PASS** |
| t20-15k-cohort1 | revoked | **PASS** |
| buyer-contract | revoked | **PASS** |
| t20-15o-bucket10 | revoked | **PASS** |
| t20-15s-bucket20 | revoked | **PASS** |

## 2. Post-revoke RAG probes

| User | `retrieval_mode` | `gate_reason` | Expected |
|------|------------------|---------------|----------|
| e2e-contract | hybrid_canary | allowlist | **PASS** |
| cohort0 | keyword | keyword_default | **PASS** |
| cohort1 | keyword | keyword_default | **PASS** |
| buyer-contract | keyword | keyword_default | **PASS** |
| bucket10 | keyword | keyword_default | **PASS** |
| bucket20 | keyword | keyword_default | **PASS** |

## 3. Temporary `AI_RAG_HYBRID_CANARY=0`

All 6 users → `keyword` / no canary gate — **PASS**

## 4. KEEP restore

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Post-restore:

| User | Mode | Gate | Result |
|------|------|------|--------|
| contract | hybrid_canary | allowlist | **PASS** |
| cohort0 | keyword | keyword_default | **PASS** |

## 5. Verdict

```text
T20.25E: PASS
T20.25F: AUTHORIZED
```

Rollback target under 5 minutes. Preview enrollments cleared; API endpoints remain available for future owner opt-in.
