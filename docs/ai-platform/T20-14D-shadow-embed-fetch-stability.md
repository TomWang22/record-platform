# T20.14D — Shadow embed-stability and fetch-trim implementation

**Status:** IMPLEMENTED  
**Generated:** 2026-06-28  
**Baseline SHA:** `aaf4a82` (pre-implementation)  
**Implementation SHA:** verify at commit time

---

## Summary

T20.14C Option A + lightweight Option B implemented in **shadow/diagnostic code only**. Production keyword retrieval and Phase 21 synthesis unchanged.

### D1 — Embed timeout classification and retry

- Shadow path: one bounded retry after Ollama embed timeout (`AI_RAG_SHADOW_EMBED_RETRY_ON_TIMEOUT`, default on).
- Diagnostics record `embed_retry_attempted`, `embed_retry_succeeded`, `embed_timeout_before_fetch`.
- `zero_result_reason=embed_timeout_before_fetch` when fetch never runs (distinct from true zero-result after fetch).
- `shadow_fetch_attempted=false` when embed fails before fetch.

### D2 — Shadow-only candidate fetch trim

- Global fetch cap: `max_chunks * 2` via `shadow_global_fetch_limit()` (was `*3` for non-OBO routes).
- Skip redundant `listing` extra fetch when listing quota already satisfied in typed pool.
- Typed-first / diversity top-ups unchanged; overlap flags remain default off.

### D3 — Harness reporting

`scripts/rp-ai-shadow-real-query-timing.sh` now separates:

- `embed_timeout_before_fetch`
- `true_zero_result` / `zero_result_after_fetch`
- `shadow_fetch_attempted`
- `embed_retry_attempted` / `embed_retry_succeeded`
- `request_error`

---

## Changed files

| File | Change |
| ---- | ------ |
| `services/python-ai-service/app/ai/config.py` | `AI_RAG_SHADOW_EMBED_RETRY_ON_TIMEOUT` |
| `services/python-ai-service/app/ai/rag_retrieval.py` | Embed retry, diagnostics, fetch trim, zero-result classification |
| `services/python-ai-service/app/ai/shadow_profiles.py` | `shadow_global_fetch_limit()` |
| `scripts/rp-ai-shadow-real-query-timing.sh` | Harness classification fields |
| `services/python-ai-service/tests/test_t20_14d_shadow_embed_fetch.py` | New tests |
| `services/python-ai-service/tests/test_shadow_diagnostics.py` | Retry assertion update |

---

## Tests

```bash
cd services/python-ai-service && source .venv/bin/activate
PYTHONPATH=. python -m pytest tests/test_t20_14d_shadow_embed_fetch.py tests/ -q
```

Coverage:

- Embed timeout → retry success → vector proceeds
- Embed timeout → retry failure → `embed_timeout_before_fetch`, not true zero-result
- Global fetch limit `max_chunks * 2`
- Keyword retrieval import unchanged
- Full suite: 222+ passed at implementation time

---

## Validation (pre-commit)

```bash
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Deploy required before cluster shadow timing reflects D changes:

```bash
docker build -f services/python-ai-service/Dockerfile -t python-ai-service:dev .
kubectl -n record-platform rollout restart deployment/python-ai-service
kubectl -n record-platform rollout status deployment/python-ai-service --timeout=180s
```

---

## Explicit non-goals

- No vector / hybrid production default
- No ANN index or DB migration
- No embedding tranches
- No default-on overlap flags
- No keyword retrieval or synthesis changes
- No T20.15 / rollout approval

---

## Final verdict

```text
T20.14D shadow embed/fetch stability: IMPLEMENTED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
```

**Next:** T20.14E — 3-run warm shadow latency re-eval (read-only).
