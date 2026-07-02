# T20.32D — Broader opt-in hybrid preview readiness rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-02

---

## 1. UI enroll / revoke (Playwright)

Participant A (cohort0): UI enroll → `preview_opt_in` → UI revoke → `keyword_default` — **PASS** (`e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts`).

## 2. API/UI consistency

| Step | Result |
|------|--------|
| API enroll participant B (seller-contract) | **PASS** |
| Status reflects enrolled | **PASS** |
| API revoke participant B | **PASS** |
| Status reflects not enrolled | **PASS** |
| Bulk enroll 11 participants | **PASS** |
| Bulk revoke 11 participants | **PASS** |
| All non-allowlist → `keyword_default` | **PASS** |

## 3. `CANARY=0` drill

All users (contract + cohort) → `keyword` — **PASS**

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
T20.32D: PASS
T20.32E: AUTHORIZED
```
