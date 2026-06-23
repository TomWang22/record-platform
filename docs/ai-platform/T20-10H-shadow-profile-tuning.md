# T20.10H — Shadow profile tuning and deploy worker hardening

**Generated:** 2026-06-22  
**Baseline SHA:** `04d3ab512896e5eb797cd1d1e3ff59e71f38df18` (T20.10G)  
**Mode:** shadow-only tuning + runtime stability — no vector default flip

## Executive summary

T20.10H adds shadow query profile inference, seller-sales source quotas/weights, keyword-alignment boost (debug overlap mode), shared-source-type alignment diagnostics, and `WEB_CONCURRENCY=4` worker hardening. Vector rollout remains **NOT APPROVED**.

| Gate | T20.10G (before) | T20.10H (after) |
|------|-----------------:|----------------:|
| Zero chunk overlap | 12/16 | **11/16** |
| Zero doc overlap | 12/16 | **11/16** |
| Zero entity overlap | 12/16 | **11/16** |
| `source_type_mismatch` | 4 | **2** |
| `same_source_type_different_chunks` | 7 | **6** |
| Doc/entity overlap >0 runs | 4/16 | **5/16** |
| Owner OBO selected mix | 6+2 | **6+2** (preserved) |
| Shadow p50 / p95 | 969 / 5713 ms | **1987 / 5605 ms** |
| Embed p95 | 5270 ms | **5347 ms** (3 cold-start outliers) |
| Source diagnostic | PASS | **PASS** |
| Pod OOM on deploy | yes (manual patch) | **no** (`WEB_CONCURRENCY=4`) |

## Part A — Profile / source tuning

### Changes

- `infer_shadow_profile_from_query()` — shadow-only routing when no explicit `shadow_profile`
- `seller_sales_summary` fixed weights + query-aware quotas (OBO / revision / notification slots)
- Expanded `vector_fetch_extra_types()` for seller prompts
- Unprofiled shadow (`shadow_default` benchmark case) now uses inferred `seller_sales_summary` for seller prompts

### Mismatch reduction

`source_type_mismatch` dropped **4 → 2** (pricing/revision and notifications prompts still mismatch on `shadow_default`; explicit `obo_helper` profile aligns on several cases).

## Part B — Same-source-type alignment

### Changes

- Keyword entity/document/chunk alignment boost during weighted fill (when `shadow_debug` provides keyword chunks)
- `shared_source_alignment` in overlap explanation (per shared source type: entity/doc overlap counts)
- `same_source_type_different_chunks` **7 → 6**

## Part C — Embed outliers

Three embed timeouts on the first two benchmark prompts (cold start after rollout). Subsequent runs were sub-second embed. No sustained embed regression once Ollama URL restored.

## Part D — Deploy worker hardening

| Item | Value |
|------|-------|
| `WEB_CONCURRENCY` | **4** in `infra/k8s/base/python-ai-service/deploy.yaml` |
| `gunicorn.conf.py` | reads `WEB_CONCURRENCY`, default cap **4** without env |
| Pod after deploy | **Running / Ready**, **0 restarts** |
| OOM recurrence | **none** on rollout |

Also fixed: removed stale `OLLAMA_BASE_URL` override in deploy manifest (was pointing at non-existent `ollama.ollama` namespace; `app-config` value is authoritative).

## Validation

| Check | Result |
|-------|--------|
| python-ai tests | **119 passed**, 91.42% line cov |
| enforce-service-coverage | **PASS** |
| RAG contract | **PASS** |
| OCH scan | **PASS** |
| Shadow source diagnostic | **PASS** (OBO owner-visible **18**) |

**Artifact:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260622-212447.md`

## Rollout verdict

**Vector retrieval default: NOT APPROVED.**

- Coverage still **7.62%**
- Chunk overlap still poor (**11/16** zero)
- Embed p95 still has cold-start outliers

## Files changed

| File | Change |
|------|--------|
| `services/python-ai-service/app/ai/shadow_profiles.py` | inference, seller weights/quotas |
| `services/python-ai-service/app/ai/rag_retrieval.py` | inferred profile route, alignment boost, shared-source diagnostics |
| `services/python-ai-service/app/gunicorn.conf.py` | `WEB_CONCURRENCY` worker cap |
| `infra/k8s/base/python-ai-service/deploy.yaml` | `WEB_CONCURRENCY=4`, drop wrong Ollama override |
| `scripts/rp-ai-shadow-real-query-timing.sh` | T20.10H summary label |
| Tests | shadow diagnostics, routes, coverage focus |

## Next recommended ticket

**T20.10I** — continue profile tuning on remaining `shadow_default` mismatches and cold-start embed warmup, or bounded corpus repair if keyword-OBO vs shadow-listing mismatch is unfixable by ranking alone. **No new embedding tranche** until overlap gate re-evaluated.
