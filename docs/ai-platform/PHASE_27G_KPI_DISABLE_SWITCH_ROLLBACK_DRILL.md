# Phase 27G — KPI disable-switch rollback drill

**Phase 27G:** PASS  
**Disable switch rollback:** PASS  
**Live eval:** NOT RUN  
**Production enablement:** NOT APPROVED  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Rollback posture restored (process-local)

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
```

## Proved blocked

```text
ingestion blocked
searchability blocked
query observation blocked
usefulness blocked
runtime writes enabled: NO
```

All `noop_write_kpi_*` returned `None` without invoking insert functions after reload under disable env.

## Evidence

`scripts/phase27-controlled-kpi-enablement-drill.py` → `27G_disable_switch.status=PASS`.

Defaults in committed `config.py` remain OFF / master disable ON. This drill did not permanently enable production writes.

## Next

Continue Phase 27H closeout/archive.
