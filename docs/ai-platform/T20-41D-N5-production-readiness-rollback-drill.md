# T20.41D — N=5 production-readiness rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-04  
**Baseline SHA:** `70257a7`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.41D: PASS
UI enroll/revoke: PASS
API enroll/revoke: PASS
Bulk revoke all 5: PASS
CANARY=0 drill: PASS
KEEP restore: PASS
```

No production default, percent rollout, permanent allowlist, or image change was made.

---

## 2. UI enroll/revoke

Target user: `tom@example.com`

```text
Playwright: cohort user — enroll, preview_opt_in RAG, revoke to keyword_default
Result: PASS (1/1)
```

The UI flow was driven through `/insights` via the existing opt-in hybrid preview UI smoke test.

---

## 3. API enroll/revoke

Target user: `tw5126@example.com`

```text
pre-api gate: keyword / keyword_default
API enroll: PASS
enrolled gate: hybrid_canary / preview_opt_in
API revoke: PASS
post-api gate: keyword / keyword_default
```

---

## 4. Bulk revoke

After bulk revoke, all five counted participants returned to keyword default:

| Email | Result |
|-------|--------|
| tom@example.com | `keyword` / `keyword_default` |
| tw5126@example.com | `keyword` / `keyword_default` |
| seed@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-1@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-2@example.com | `keyword` / `keyword_default` |

Contract control remained unchanged:

```text
e2e-contract@record-platform.local hybrid_canary / allowlist
```

---

## 5. CANARY=0 drill

Temporary drill:

```text
kubectl -n record-platform set env deployment/python-ai-service AI_RAG_HYBRID_CANARY=0
```

Verified after rollout:

| User | Result |
|------|--------|
| e2e-contract@record-platform.local | `keyword` / `null` |
| tom@example.com | `keyword` / `null` |

The drill confirmed disabling the canary forces keyword retrieval even for the contract allowlist control.

---

## 6. KEEP restore

Restored env:

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Verified after restore:

| User | Result |
|------|--------|
| e2e-contract@record-platform.local | `hybrid_canary` / `allowlist` |
| tom@example.com | `keyword` / `keyword_default` |
| tw5126@example.com | `keyword` / `keyword_default` |
| seed@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-1@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-2@example.com | `keyword` / `keyword_default` |

Final deployed state:

```text
python-ai-service:t20-p225b
webapp:t20-p227b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
Preview UI/API: KEEP
```
