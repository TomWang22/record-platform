# T20.42D — N=5 production-readiness final rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-04  
**Baseline SHA:** `e042731`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Verdict

```text
T20.42D: PASS
UI enroll/revoke: PASS (tom@example.com)
API enroll/revoke: PASS (tw5126@example.com)
Bulk revoke all 5: PASS
CANARY=0 drill: PASS
KEEP restore: PASS
```

---

## 2. UI enroll/revoke

Target: `tom@example.com`

```text
Playwright cohort user — enroll, preview_opt_in RAG, revoke to keyword_default
Result: PASS (1/1)
```

---

## 3. API enroll/revoke

Target: `tw5126@example.com`

```text
API enroll: hybrid_canary / preview_opt_in PASS
API revoke: keyword / keyword_default PASS
```

---

## 4. Bulk revoke

| Email | Result |
|-------|--------|
| tom@example.com | `keyword` / `keyword_default` |
| tw5126@example.com | `keyword` / `keyword_default` |
| seed@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-1@example.com | `keyword` / `keyword_default` |
| phase21-preview-internal-2@example.com | `keyword` / `keyword_default` |
| e2e-contract@record-platform.local | `hybrid_canary` / `allowlist` |

---

## 5. CANARY=0 drill

| User | Result |
|------|--------|
| e2e-contract@record-platform.local | `keyword` / `null` |
| tom@example.com | `keyword` / `null` |

---

## 6. KEEP restore

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

Post-restore probes: contract `hybrid_canary/allowlist`; all five participants `keyword/keyword_default`.
