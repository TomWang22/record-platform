# Phase 27B — local/dev KPI schema apply verification

**Phase 27B:** PASS  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production DB migration:** NOT RUN  
**Local/dev schema apply:** PASS (`python_ai` @ `127.0.0.1:5440`)  
**DB writes (schema DDL only):** YES (idempotent local/dev APPLY)  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## What ran

```bash
PGPASSWORD=postgres \
psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai \
  -f infra/db/48-ai-kpi-observability.sql \
  --single-transaction --set ON_ERROR_STOP=1
```

Idempotent apply succeeded (CREATE TABLE IF NOT EXISTS / indexes already present where applicable).

## Introspection

Tables present:

```text
ai.ai_kpi_ingestion_events
ai.ai_kpi_searchability_checks
ai.ai_kpi_query_observations
ai.ai_kpi_usefulness_observations
```

Forbidden columns absent:

```text
response_body, raw_response_body, message_body, raw_message_body,
jwt, token, password, proxy_max_bid, private_message, authorization_header
```

## Evidence

- Drill script: `scripts/phase27-controlled-kpi-enablement-drill.py` (`27B_schema.status=PASS`)
- Target: local/dev only — not production

## Next

Continue Phase 27C in the same execution batch.
