# T20.37D — Real-participant extension rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-03  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Enroll / revoke

| Step | Participant | Method | Result |
|------|-------------|--------|--------|
| Enroll → revoke | tom@example.com | UI (Playwright) + API verify | `preview_opt_in` → `keyword_default` **PASS** |
| Enroll → revoke | tw5126@example.com | API | `preview_opt_in` → `keyword_default` **PASS** |

## 2. Bulk revoke (all 3 participants)

| Participant | Post-revoke probe |
|-------------|-------------------|
| tom@example.com | `keyword` / `keyword_default` **PASS** |
| tw5126@example.com | `keyword` / `keyword_default` **PASS** |
| seed@example.com | `keyword` / `keyword_default` **PASS** |

Contract control: `hybrid_canary` / `allowlist` **PASS** (unchanged).

## 3. `CANARY=0` drill

| User | Result |
|------|--------|
| e2e-contract@record-platform.local | `keyword` **PASS** |
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
T20.37D: PASS
T20.37E: AUTHORIZED
```
