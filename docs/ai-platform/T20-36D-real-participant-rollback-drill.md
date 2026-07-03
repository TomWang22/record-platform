# T20.36D — Real-participant rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-03  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. API enroll / revoke (real participants)

| Step | Participant | Result |
|------|-------------|--------|
| API enroll | tom@example.com | `preview_opt_in` **PASS** |
| API revoke | tom@example.com | `keyword_default` **PASS** |
| API enroll | tw5126@example.com | `preview_opt_in` **PASS** |
| API revoke | tw5126@example.com | `keyword_default` **PASS** |

UI enroll/revoke: covered by Playwright C-suite (`ai-rag-opt-in-hybrid-preview-ui.spec.ts` **4/4 PASS**).

## 2. Bulk revoke

| Participant | Post-revoke probe |
|-------------|-------------------|
| tom@example.com | `keyword` / `keyword_default` **PASS** |
| tw5126@example.com | `keyword` / `keyword_default` **PASS** |
| seed@example.com | `keyword` / `keyword_default` **PASS** |

## 3. `CANARY=0` drill

| User | Result |
|------|--------|
| Contract | `keyword` **PASS** |
| tom@example.com | `keyword` **PASS** |

## 4. KEEP restore

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

| User | Post-restore | Result |
|------|--------------|--------|
| Contract | `hybrid_canary` / `allowlist` | **PASS** |
| tom@example.com | `keyword` / `keyword_default` | **PASS** |
| tw5126@example.com | `keyword` / `keyword_default` | **PASS** |
| seed@example.com | `keyword` / `keyword_default` | **PASS** |

## 5. Verdict

```text
T20.36D: PASS
T20.36E: AUTHORIZED
```
