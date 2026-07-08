# Phase 27C — controlled KPI flag enablement drill

**Phase 27C:** PASS  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE (process/test env only; no production ConfigMaps)  
**Production enablement:** NOT APPROVED  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Default-off posture (proved)

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
runtime writes enabled by default: NO
```

All four `kpi_writes_allowed(channel)` returned false. All `noop_write_kpi_*` returned `None` without calling insert functions.

## Controlled enablement (proved in local/dev process env only)

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=0
AI_KPI_OBSERVABILITY_ENABLED=1
AI_KPI_INGESTION_EVENTS_ENABLED=1
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=1
AI_KPI_QUERY_OBSERVATIONS_ENABLED=1
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=1
runtime_writes_enabled: true (temporarily, process-local)
```

All four channels allowed under that temporary env. No production ConfigMap / permanent deployment env mutation.

## Evidence

`scripts/phase27-controlled-kpi-enablement-drill.py` → `27C_default_off` + `27C_enabled` PASS.

## Next

Continue Phase 27D row population via implemented write paths.
