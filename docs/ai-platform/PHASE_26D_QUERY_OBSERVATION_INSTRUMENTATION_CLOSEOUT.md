# Phase 26D — query observation instrumentation closeout

**Phase 26D:** PASS  
**Phase 26E:** NOT STARTED  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Query observation writes default enabled:** NO  
**Runtime writes enabled by default:** NO  
**Raw/private fields stored:** NO  
**H1/H2/H3 protocol capture tested:** YES  
**H1 query observation smoke:** NOT RUN  
**H2 query observation smoke:** NOT RUN  
**H3 query observation smoke:** NOT RUN  
**H1 full-matrix latency summary in committed docs:** GAP  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Executive verdict

Phase 26D implements the **query observation write path** for `ai.ai_kpi_query_observations` behind default-off flags, with a **default-off hook on `/ai/rag/query`** that records redacted latency metrics and HTTP protocol labels (HTTP/1.1, HTTP/2, HTTP/3) without storing questions, answers, or response bodies. Usefulness observations remain Phase 26E.

No live eval, no 57105 replay, no Phase 22C matrix, and no retrieval behavior changes.

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `services/python-ai-service/app/ai/kpi_query_observations.py` | Protocol normalization, redacted payload builder, safe RAG emit |
| `services/python-ai-service/app/ai/kpi_observability.py` | Query channel wired |
| `services/python-ai-service/app/ai/routes.py` | Default-off observation hook on RAG query |
| `scripts/lib/phase26d-query-observation-kpi-readonly.mjs` | Query latency aggregator |
| `scripts/lib/phase26d-query-observation-guard.mjs` | Read-only closeout guard |
| `tests/test_phase26d_kpi_query_observations.py` | Python unit tests (mocked) |
| `make ai-platform-verify-phase26d-query-observations` | Verifier entrypoint |

---

## Query observation write behavior

```text
default flags OFF / master disabled:
  emit_rag_query_observation_safe → None, no DB call
  kpi_writes_allowed("query") == false

flags enabled (tests/dev only):
  validates payload; stores allowed fields only
  writes one row to ai.ai_kpi_query_observations
  RAG response unchanged if write fails (catch/log/continue)
```

---

## Protocol capture

```text
request.scope["http_version"] == "1.1" → HTTP/1.1
request.scope["http_version"] == "2"   → HTTP/2
request.scope["http_version"] == "3"   → HTTP/3
missing/unknown                        → unknown
```

`X-Forwarded-Proto` is not used for HTTP version (scheme only).

---

## Optional smoke (not run)

```text
H1 query observation smoke: NOT RUN
H2 query observation smoke: NOT RUN
H3 query observation smoke: NOT RUN
Smoke probes are not added to 57105/57105 or 171315/171315 evidence.
```

---

## KPI gap status

| Gap | Phase 26D status | Next phase |
| --- | ---------------- | ---------- |
| Query latency from `ai_kpi_query_observations` | Write path + extractor PASS/PARTIAL/GAP when rows exist/absent | Operational population in controlled environments |
| H1 full-matrix latency in committed docs | GAP (no committed H1 p50/p95/max doc source) | Doc policy only; not backfilled from observation rows |
| data_to_searchable_ms | 26C write path (default-off) | — |
| ingestion_success_rate per source type | 26B write path (default-off) | — |
| usefulness over time time-series | NOT STARTED | 26E |

---

## Evidence labels preserved

```text
H1 baseline: 57105/57105
H2 replay: 57105/57105
H3 replay: 57105/57105
Combined labeled full-protocol evidence: 171315/171315 (labeled sum only)
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
```

---

## Verification

```bash
make ai-platform-verify-phase26d-query-observations
```

---

## Next allowed step

```text
Approved: start Phase 26E usefulness observation export only after Phase 26D query observation PASS — no live eval, no production default, no PERCENT rollout.
```
