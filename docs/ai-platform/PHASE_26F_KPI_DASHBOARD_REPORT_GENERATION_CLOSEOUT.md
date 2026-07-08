# Phase 26F — KPI dashboard/report generation closeout

**Phase 26F:** PASS  
**Phase 26G:** NOT STARTED  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**DB writes performed:** NO  
**Migrations applied:** NO  
**Report output committed:** NO  
**Raw/private fields in reports:** NO  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED  
**Combined KPI report generation:** PASS  
**No model accuracy claim without ground truth:** YES  
**Child KPI statuses:** PASS/PARTIAL/GAP depending on available `ai_kpi_*` rows and run-level fallbacks  
**Artifact SHA unchanged:** 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa  
**Bench logs committed:** NO  

---

## Executive verdict

Phase 26F implements the **read-only combined AI Platform KPI report generator** that aggregates Phase 26B–26E extractors and Phase 24/25 doc evidence into six Phase 25C JSON contracts. Reports write to `/tmp` (or caller-provided temp output dir) only. No live inference, no DB writes, no migrations, no runtime rollout.

Usefulness/rubric pass rate wording is preserved — not model accuracy without ground truth.

---

## Deliverables

| Artifact | Purpose |
| -------- | ------- |
| `scripts/lib/phase26f-combined-kpi-report-readonly.mjs` | Combined report builder + redaction guards |
| `scripts/phase26f-combined-kpi-report-readonly.mjs` | CLI: SELECT-only DB reads, writes JSON to `/tmp` |
| `scripts/lib/phase26f-dashboard-report-guard.mjs` | Read-only closeout guard |
| `make ai-platform-verify-phase26f-kpi-report` | Verifier entrypoint |

Generated artifacts (not committed):

```text
phase25_ingestion_kpis.json
phase25_searchability_kpis.json
phase25_query_latency_kpis.json
phase25_usefulness_kpis.json
phase25_operational_health_kpis.json
phase25_combined_ai_platform_kpi_report.json
```

---

## Evidence labels preserved

```text
H1 baseline: 57105/57105 HTTP/1.1
H2 replay: 57105/57105 HTTP/2 PASS
H3 replay: 57105/57105 HTTP/3 PASS
Combined labeled full-protocol evidence: 171315/171315
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
171315/171315 is labeled H1+H2+H3 only
```

---

## Child KPI status rules (honest)

```text
Ingestion: PASS when ai_kpi_ingestion_events rows exist; PARTIAL/GAP with run-level fallback or no rows
Searchability: PASS when check rows exist; GAP when absent
Query latency: PASS/PARTIAL/GAP from ai_kpi_query_observations rows; H1 committed-doc matrix remains GAP
Usefulness: PASS/PARTIAL/GAP from ai_kpi_usefulness_observations rows
Operational health: PARTIAL from readonly verifier posture locks
```

Default-off KPI write paths mean operational rows may be absent even though instrumentation exists.

---

## Verification

```bash
make ai-platform-verify-phase26f-kpi-report
```

---

## Next allowed step

```text
Approved: start Phase 26G observability disable-switch drill and implementation closeout only after Phase 26F KPI report PASS — no live eval, no production default, no PERCENT rollout.
```
