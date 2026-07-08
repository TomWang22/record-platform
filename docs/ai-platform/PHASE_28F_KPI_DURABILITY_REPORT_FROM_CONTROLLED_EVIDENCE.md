# Phase 28F — KPI Durability Report From Controlled Evidence

```text
Phase 28F: NOT STARTED (requires 28D/E matrix PASS)
Combined KPI report: /tmp only
Generated reports committed: NO
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Report output

```text
/tmp/phase28-kpi-report/
/tmp/phase28-controlled-observability-matrix/phase28-kpi-report/
```

Generate after matrix completion:

```bash
node scripts/phase28-generate-kpi-report-readonly.mjs /tmp/phase28-kpi-report
node scripts/phase28-finalize-closeout.mjs
```

## Child KPI statuses required

- ingestion/searchability: from 28C drill rows + matrix durability
- query_latency: PASS when H1/H2/H3 each have 8640 observations
- usefulness: PASS when Phase 28 evidence label rows present per protocol
- operational_health: PARTIAL acceptable
