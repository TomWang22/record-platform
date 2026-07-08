# Phase 27F — combined KPI report from controlled rows

**Phase 27F:** PASS  
**Live eval:** NOT RUN  
**Generated KPI reports committed:** NO  
**Report output path:** `/tmp/phase27f-kpi-report` only  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  
**Redaction status:** PASS  

---

## Command

```bash
node scripts/phase26f-combined-kpi-report-readonly.mjs --out /tmp/phase27f-kpi-report
```

## Child KPI statuses (from real local/dev rows)

```text
ingestion: PASS
searchability: PASS
query_latency: PASS
usefulness: PASS
operational_health: PARTIAL
redaction_status: PASS
```

Expected and observed: operational_health remains PARTIAL (broader ops signals not claimed complete from this drill).

## Hygiene

```text
Reports written under /tmp only
Generated JSON not staged/committed
No forbidden private fields in report JSON
Evidence labels preserved in combined report
```

## Next

Continue Phase 27G disable-switch rollback.
