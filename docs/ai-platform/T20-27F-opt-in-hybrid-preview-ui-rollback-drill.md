# T20.27F — Opt-in hybrid preview UI rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-01  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. UI enroll / revoke (Playwright)

| Step | Result |
|------|--------|
| Cohort UI enroll | **PASS** |
| RAG → `hybrid_canary` / `preview_opt_in` | **PASS** |
| Cohort UI revoke | **PASS** |
| RAG → `keyword` / `keyword_default` | **PASS** |

Spec: `e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts` (cohort user test).

## 2. API/UI consistency

| Step | Result |
|------|--------|
| API re-enroll cohort | `preview_opt_in` **PASS** |
| API revoke cohort | `keyword_default` **PASS** |

## 3. Revoke all + `CANARY=0`

| Step | Result |
|------|--------|
| All cohort revoked | **PASS** |
| `AI_RAG_HYBRID_CANARY=0` → all users keyword | **PASS** |

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

| User | Post-restore | Result |
|------|--------------|--------|
| Contract | `hybrid_canary` / `allowlist` | **PASS** |
| Cohort | `keyword` / `keyword_default` | **PASS** |

## 5. Verdict

```text
T20.27F: PASS
T20.27G: AUTHORIZED
```
