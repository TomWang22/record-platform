# Phase 26B — ingestion instrumentation closeout

**Phase 26B:** PASS  
**Phase 26C:** NOT STARTED  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Migrations applied to live DB:** NO  
**Ingestion events implementation:** PASS  
**Default flags OFF:** PASS  
**Runtime writes enabled by default:** NO  
**Raw/private fields stored:** NO  
**Reindex/backfill run:** NO  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Executive verdict

Phase 26B implements the **ingestion KPI event write path** for `ai.ai_kpi_ingestion_events` behind default-off flags. Payload validation enforces aggregate/redacted fields only. Searchability, query, and usefulness channels remain Phase 26C/26D/26E stubs.

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `services/python-ai-service/app/ai/kpi_ingestion_events.py` | Redacted payload builder + async insert |
| `services/python-ai-service/app/ai/kpi_observability.py` | Ingestion channel wired; other channels stubbed |
| `scripts/lib/phase26b-ingestion-kpi-readonly.mjs` | Per-source_type ingestion KPI aggregator |
| `scripts/lib/phase26b-ingestion-guard.mjs` | Read-only Phase 26B closeout guard |
| `tests/test_phase26b_kpi_ingestion.py` | Python unit tests (mocked, no live DB) |
| `tests/phase26b-ingestion-kpi-readonly.test.mjs` | Extractor unit tests |
| `tests/phase26b-ingestion-guard.test.mjs` | Closeout guard tests |
| `make ai-platform-verify-phase26b-ingestion` | Verifier entrypoint |

---

## Ingestion write behavior

```text
default flags OFF / master disabled:
  noop_write_kpi_ingestion_event → None, no DB call

flags enabled (tests/dev only):
  validates payload, rejects forbidden/raw fields
  hashes source identifiers via source_id_hash only
  writes one row to ai.ai_kpi_ingestion_events when insert_fn/async DB available

DB unavailable while enabled:
  raises KpiIngestionWriteError with clear message
```

---

## Privacy rules enforced

```text
No raw source id, response body, message body, JWT, token, password,
proxy max bid, private message, authorization header, or DB dump in payload.
```

---

## KPI gap status

| Gap | Phase 26B status | Next phase |
| --- | ---------------- | ---------- |
| ingestion_success_rate per source type | Write path + extractor PASS when event rows exist; PARTIAL/GAP fallback preserved | Operational data population in controlled environments only |
| data_to_searchable_ms end-to-end | NOT STARTED | 26C |
| H1 full-matrix latency in committed docs | NOT STARTED | 26D |
| usefulness over time time-series | NOT STARTED | 26E |

---

## Locked production posture (unchanged)

```text
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

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
make ai-platform-verify-phase26b-ingestion
```

---

## Next allowed step

```text
Approved: start Phase 26C searchability verification probe implementation only after Phase 26B ingestion instrumentation PASS — no live eval, no production default, no PERCENT rollout.
```
