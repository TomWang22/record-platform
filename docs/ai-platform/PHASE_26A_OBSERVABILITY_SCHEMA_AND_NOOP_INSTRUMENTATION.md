# Phase 26A — observability schema and no-op instrumentation

**Phase 26A:** PASS  
**Schema/migration files created:** YES  
**Migrations applied to live DB:** NO  
**No-op feature flags default OFF:** PASS  
**Runtime writes enabled:** NO  
**Live eval:** NOT RUN  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  
**Phase 26B:** NOT STARTED  

---

## Executive verdict

Phase 26A delivers the **schema and no-op instrumentation foundation** for KPI observability. Four `ai_kpi_*` tables are defined in a committed SQL migration. Runtime write paths remain disabled by default via feature flags and no-op stubs. No live eval, production default change, or PERCENT rollout occurred.

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `infra/db/48-ai-kpi-observability.sql` | CREATE TABLE for four KPI tables (idempotent) |
| `services/python-ai-service/app/ai/config.py` | Default-off `AI_KPI_*` flags |
| `services/python-ai-service/app/ai/kpi_observability.py` | No-op write guards |
| `scripts/lib/phase26a-ai-kpi-schema-guard.mjs` | Read-only schema contract validator |
| `scripts/phase26a-ai-kpi-schema-guard-readonly.mjs` | CLI guard |
| `tests/phase26a-ai-kpi-schema-guard.test.mjs` | Node schema guard tests |
| `services/python-ai-service/tests/test_phase26a_kpi_observability.py` | Python flag/no-op tests |
| `make ai-platform-verify-phase26a-schema` | Verifier entrypoint |

---

## Tables created (migration file only)

```text
ai.ai_kpi_ingestion_events
ai.ai_kpi_searchability_checks
ai.ai_kpi_query_observations
ai.ai_kpi_usefulness_observations
```

Field contract source: `PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md`

Forbidden columns absent from migration:

```text
response_body, raw_response_body, message_body, raw_message_body,
jwt, token, password, proxy_max_bid, private_message, authorization_header
```

---

## Default-off feature flags

```text
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
```

`kpi_writes_allowed()` returns false under defaults. No-op stubs return `None` without DB writes.

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

## KPI gap status (unchanged — implementation pending)

| Gap | Phase 26A | Next phase |
| --- | --------- | ---------- |
| ingestion_success_rate per source type | Schema only | 26B |
| data_to_searchable_ms end-to-end | Schema only | 26C |
| H1 full-matrix latency in committed docs | Schema only | 26D |
| usefulness over time time-series | Schema only | 26E |

---

## Verification

```bash
make ai-platform-verify-phase25-design
make ai-platform-verify-phase26a-schema
cd services/python-ai-service && python -m unittest tests.test_phase26a_kpi_observability
```

Migration dry-run (local only, not applied in Phase 26A closeout):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -f infra/db/48-ai-kpi-observability.sql --single-transaction --set ON_ERROR_STOP=1
```

---

## Next allowed step

```text
Approved: start Phase 26B ingestion event instrumentation only after Phase 26A schema/no-op PASS — no live eval, no production default, no PERCENT rollout.
```
