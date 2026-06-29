# T20.15B — Hybrid canary implementation

**Status:** Implemented  
**SHA:** (see commit)  
**Image:** `python-ai-service:t20-p215b2`

## Summary

Allowlist-only hybrid canary gates added to `rag_query`. Keyword retrieval always runs first; hybrid vector path (G3R pipeline with diagnostics) runs only when all gates pass. Non-allowlisted users and disabled canary retain existing keyword behavior unchanged.

## Env gates (defaults)

| Variable | Default |
| -------- | ------- |
| `AI_RAG_HYBRID_CANARY` | `0` |
| `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST` | empty |
| `AI_RAG_HYBRID_CANARY_PERCENT` | `0` |
| `AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK` | `1` |
| `AI_RAG_HYBRID_LOG_PURE_VECTOR` | `1` |
| `AI_RAG_HYBRID_ANCHOR_MAX` | `1` |

## Changed files

- `services/python-ai-service/app/ai/config.py` — hybrid env vars
- `services/python-ai-service/app/ai/hybrid_canary.py` — gate evaluation + diagnostics
- `services/python-ai-service/app/ai/insights.py` — `rag_query` hybrid path
- `services/python-ai-service/tests/test_t20_15b_hybrid_canary.py` — unit tests

## retrieval_mode values

| Mode | When |
| ---- | ---- |
| `keyword` | Default / canary off / non-allowlisted |
| `hybrid_canary` | Allowlisted + hybrid succeeded |
| `keyword_fallback_from_hybrid` | Allowlisted + hybrid failed + fallback required |

## Tests

270 passed (`pytest tests/ -q`).

## Verdict

```text
Vector rollout: NOT APPROVED
Production default remains keyword
T20.15B hybrid canary implementation: COMPLETE (allowlist-only)
T20.15C eval: pending
```
