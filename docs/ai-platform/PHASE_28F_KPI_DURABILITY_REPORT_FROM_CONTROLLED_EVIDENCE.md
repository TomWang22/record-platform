# Phase 28F — KPI Durability Report From Controlled Evidence

```text
Phase 28F: PASS — /tmp KPI report
Combined KPI report: /tmp/phase28-kpi-report
Generated reports committed: NO
Live eval run: NOT RUN
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Report output

```text
/tmp/phase28-kpi-report/
/tmp/phase28-controlled-observability-matrix/phase28-kpi-report/
```

Generate:

```bash
node scripts/phase28-generate-kpi-report-readonly.mjs /tmp/phase28-kpi-report
```

## Child KPI statuses (controlled local/dev evidence)

| Child KPI | Status | Notes |
| --------- | ------ | ----- |
| ingestion | PASS | 28C drill rows + matrix durability |
| searchability | PASS | controlled local/dev evidence |
| query_latency | PASS | matrix JSONL 8640/8640 per protocol; /tmp latency tables |
| usefulness | PASS | Phase 28 evidence label rows; response/sentiment/red-team 100% |
| operational_health | PARTIAL | acceptable |
| redaction_status | PASS | no raw prompt/response/JWT in reports |

Combined top-level report status: PASS.
