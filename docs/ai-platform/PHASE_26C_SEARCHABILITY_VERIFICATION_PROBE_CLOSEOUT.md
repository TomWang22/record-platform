# Phase 26C — searchability verification probe closeout

**Phase 26C:** PASS  
**Phase 26D:** NOT STARTED  
**Schema SQL applied to local/dev python_ai DB:** YES  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Searchability writes default enabled:** NO  
**Runtime writes enabled by default:** NO  
**Raw/private fields stored:** NO  
**Reindex/backfill run:** NO  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Executive verdict

Phase 26C applies the Phase 26A KPI schema to **local/dev `python_ai` on port 5440** and implements the **searchability verification probe write path** for `ai.ai_kpi_searchability_checks` behind default-off flags. Query and usefulness channels remain Phase 26D/26E stubs.

---

## Local/dev schema apply proof

Applied:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai \
  --single-transaction --set ON_ERROR_STOP=1 \
  -f infra/db/48-ai-kpi-observability.sql
```

Verified tables:

```text
ai.ai_kpi_ingestion_events
ai.ai_kpi_query_observations
ai.ai_kpi_searchability_checks
ai.ai_kpi_usefulness_observations
```

Forbidden columns in `ai_kpi_*` tables: **none**

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `services/python-ai-service/app/ai/kpi_searchability_checks.py` | Redacted payload builder + async insert |
| `services/python-ai-service/app/ai/kpi_observability.py` | Searchability channel wired |
| `scripts/lib/phase26c-searchability-kpi-readonly.mjs` | `data_to_searchable_ms` aggregator |
| `scripts/lib/phase26c-searchability-guard.mjs` | Read-only closeout guard |
| `tests/test_phase26c_kpi_searchability.py` | Python unit tests (mocked) |
| `make ai-platform-verify-phase26c-searchability` | Verifier entrypoint |

---

## Searchability write behavior

```text
default flags OFF / master disabled:
  noop_write_kpi_searchability_check → None, no DB call

flags enabled (tests/dev only):
  validates payload; stores source_id_hash and probe_query_hash only
  writes one row to ai.ai_kpi_searchability_checks
  returns inserted id when insert_fn/async DB available
```

---

## KPI gap status

| Gap | Phase 26C status | Next phase |
| --- | ---------------- | ---------- |
| data_to_searchable_ms end-to-end | Write path + extractor PASS when check rows exist; GAP when absent | Operational probe population in controlled environments |
| ingestion_success_rate per source type | 26B write path (default-off) | — |
| H1 full-matrix latency in committed docs | NOT STARTED | 26D |
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
make ai-platform-verify-phase26b-ingestion
make ai-platform-verify-phase26c-searchability
```

---

## Next allowed step

```text
Approved: start Phase 26D query observation instrumentation only after Phase 26C searchability verification PASS — no live eval, no production default, no PERCENT rollout.
```
