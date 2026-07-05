# Phase 22D — protocol parity rollback drill

**Status:** PASS  
**Validated:** 2026-07-05 (post Phase 22C matrix)

---

## Verdict

```text
Phase 22D: PASS — post-matrix revoke + keyword restore + contract allowlist unchanged
Live matrix: NOT RUN (drill only)
Runtime/env changes: NONE
```

---

## Drill steps (executed by Phase 22C runner post-matrix)

1. Revoke all 5 preview participants via `POST /api/ai/rag/preview/revoke`.
2. Verify all 5 return `keyword` / `keyword_default` on HTTP/1.1 probe.
3. Verify contract control remains `hybrid_canary` / `allowlist`.
4. Verify final env unchanged:
   - `AI_RAG_HYBRID_CANARY=1`
   - `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f`
   - `AI_RAG_HYBRID_CANARY_PERCENT=0`
   - `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`

---

## Result

| Check | Result |
| ----- | ------ |
| Post-revoke keyword_default (5 participants) | PASS |
| Contract allowlist unchanged | PASS |
| PERCENT=0 / ALLOW_PROD_PERCENT=0 | PASS |
| Production default | keyword (unchanged) |

---

## Hard stops respected

No production default switch, no PERCENT rollout, no allowlist broadening, no artifact edits.
