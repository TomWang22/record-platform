# T20.25B — Opt-in hybrid preview implementation

**Status:** Implementation complete  
**Generated:** 2026-07-01  
**Baseline SHA:** `16981ca` (owner sign-off)  
**Image:** `python-ai-service:t20-p225b`

---

## 1. Summary

API-only opt-in hybrid preview enrollment with owner-scoped JWT persistence. Allowlist gate remains highest priority; `AI_RAG_HYBRID_CANARY_PERCENT=0` unchanged.

## 2. Persistence

Table `ai.ai_rag_preview_enrollment` (DDL: `infra/db/11-ai-rag-preview-enrollment.sql`):

| Column | Type |
|--------|------|
| `user_id` | UUID PK |
| `owner_user_id` | UUID NOT NULL |
| `enrolled_at` | timestamptz NOT NULL |
| `enrolled_by` | UUID NOT NULL |
| `revoked_at` | timestamptz NULL |
| `source` | text NOT NULL DEFAULT `owner_opt_in` |

Runtime also applies idempotent DDL via `preview_enrollment.ensure_enrollment_table()`.

## 3. API endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/ai/rag/preview/status` | JWT `x-user-id` |
| POST | `/ai/rag/preview/enroll` | JWT `x-user-id` |
| POST | `/ai/rag/preview/revoke` | JWT `x-user-id` |

Gateway: `/api/ai/rag/preview/*` (existing python-ai proxy).

## 4. Gate behavior

| User | Expected mode | `gate_reason` |
|------|---------------|---------------|
| Non-enrolled authenticated | keyword | `keyword_default` |
| Preview enrolled | hybrid_canary | `preview_opt_in` |
| Allowlist contract user | hybrid_canary | `allowlist` |
| Revoked enrollment | keyword | `keyword_default` |
| Anonymous / invalid UUID | keyword or denied | `keyword_default` |

## 5. Code changes

| File | Change |
|------|--------|
| `app/ai/preview_enrollment.py` | New — persistence + status/enroll/revoke |
| `app/ai/hybrid_canary.py` | `preview_opt_in` gate after allowlist |
| `app/ai/insights.py` | Enrollment lookup in `rag_query`; preview routes |
| `app/ai/routes.py` | Preview HTTP endpoints |
| `infra/db/11-ai-rag-preview-enrollment.sql` | Schema DDL |
| `tests/test_t20_25_preview_enrollment.py` | Gate + rag_query tests |

## 6. Telemetry

`hybrid_canary` diagnostics include: `preview_opt_in`, `preview_source`, `gate_reason`, `retrieval_mode`, `hybrid_fallback_reason`, `source_refs_count` (via envelope), latency fields, leakage via existing sanitization.

## 7. Tests

```text
tests.test_t20_25_preview_enrollment — 8/8 PASS (container)
```

Hard constraints verified in tests:

- PERCENT=0 unchanged
- No vector/hybrid production default
- Allowlist beats preview
- Message bodies absent from responses

## 8. Image

```bash
docker build -f services/python-ai-service/Dockerfile -t python-ai-service:t20-p225b .
```

Deploy in T20.25C.
