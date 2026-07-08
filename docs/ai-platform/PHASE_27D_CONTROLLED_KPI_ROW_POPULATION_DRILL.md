# Phase 27D — controlled KPI row population drill

**Phase 27D:** PASS  
**Live eval:** NOT RUN  
**DB writes:** YES (synthetic local/dev KPI rows only via implemented write paths)  
**Target:** real local/dev DB rows on `python_ai@127.0.0.1:5440`  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  
**Raw/private fields stored:** NO  

---

## Method

Used official write paths (not ad hoc table inserts for KPI payloads):

```text
write_kpi_ingestion_event(...)
write_kpi_searchability_check(...)
```

via `scripts/phase27-controlled-kpi-enablement-drill.py` with flags temporarily enabled in process env and `POSTGRES_URL_PYTHON_AI=postgresql://postgres:postgres@127.0.0.1:5440/python_ai`.

## Rows populated

```text
1 ingestion event row (source_type=phase27_controlled, source_id_hash only)
1 searchability check row (probe_status=PASS, sha256 probe hash)
```

Plus an `ai.ai_ingestion_runs` parent row for FK integrity (status=completed, synthetic `phase27` source_counts).

## Rules honored

```text
source_id_hash only, no raw source IDs
no raw message bodies
no raw response bodies
no JWTs/passwords/private data/proxy max bids
no reindex
no backfill
no live matrix
```

## Counts after drill (local/dev)

```text
ingestion: >= 1
searchability: >= 1
```

Combined report later confirmed ingestion/searchability child statuses from these real rows.

## Next

Continue Phase 27E query/usefulness smoke (still no 57105 replay).
