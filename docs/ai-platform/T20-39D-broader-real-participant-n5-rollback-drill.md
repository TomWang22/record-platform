# T20.39D — Broader real-participant N=5 rollback drill

**Status:** Rollback drill **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `a50e7de`  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Enroll / revoke proof

| Step | Participant | Method | Result |
|------|-------------|--------|--------|
| Enroll → revoke | tom@example.com | UI | `preview_opt_in` → `keyword_default` **PASS** |
| Enroll → revoke | tw5126@example.com | API | `preview_opt_in` → `keyword_default` **PASS** |

The UI rollback proof used the `/insights` preview card for `tom@example.com`. The API rollback proof used `/api/ai/rag/preview/{enroll,revoke}` for `tw5126@example.com`.

---

## 2. Bulk revoke

All five preview participants were revoked and probed:

| Participant | Post-revoke probe |
|-------------|-------------------|
| tom@example.com | `keyword` / `keyword_default` **PASS** |
| tw5126@example.com | `keyword` / `keyword_default` **PASS** |
| seed@example.com | `keyword` / `keyword_default` **PASS** |
| phase21-preview-internal-1@example.com | `keyword` / `keyword_default` **PASS** |
| phase21-preview-internal-2@example.com | `keyword` / `keyword_default` **PASS** |

Contract control: `hybrid_canary` / `allowlist` **PASS**.

---

## 3. `CANARY=0` drill

Temporarily set:

```text
AI_RAG_HYBRID_CANARY=0
```

| User | Result |
|------|--------|
| e2e-contract@record-platform.local | `keyword` **PASS** |
| tom@example.com | `keyword` **PASS** |

---

## 4. KEEP restore

Restored:

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

The first immediate post-rollout contract probe returned `keyword_fallback_from_hybrid` / `allowlist`, consistent with transient hybrid cold-start fallback after pod replacement. A settled retry passed with no fallback or canary error.

| User | Post-restore | Result |
|------|--------------|--------|
| Contract | `hybrid_canary` / `allowlist` | **PASS** |
| tom@example.com | `keyword` / `keyword_default` | **PASS** |
| tw5126@example.com | `keyword` / `keyword_default` | **PASS** |
| seed@example.com | `keyword` / `keyword_default` | **PASS** |
| phase21-preview-internal-1@example.com | `keyword` / `keyword_default` | **PASS** |
| phase21-preview-internal-2@example.com | `keyword` / `keyword_default` | **PASS** |

---

## 5. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
```

No permanent allowlist broadening, percentage rollout, image change, or production-default change was made.

## 6. Verdict

```text
T20.39D: PASS
T20.39E/T20.39F: AUTHORIZED
```

