# Phase 25D — observability implementation rollout plan

**Phase 25D:** COMPLETE — plans Phase 26 only  
**Phase 25:** design batch — NO implementation

---

## Executive verdict

Phase 25 closes with an **implementation-ready observability plan**. Phase 26 executes in seven gated sub-phases (26A–26G). **Phase 25 does not implement Phase 26.**

---

## Future phase overview

```text
Phase 26A → schema/migration (no-op safe gates)
Phase 26B → ingestion event instrumentation
Phase 26C → searchability verification probe
Phase 26D → query observation instrumentation
Phase 26E → usefulness observation export
Phase 26F → KPI dashboard/report generation
Phase 26G → rollback/disable switch and closeout
```

---

## Phase 26A — schema/migration implementation

| Item | Definition |
| ---- | ---------- |
| **Scope** | CREATE TABLE for four `ai_kpi_*` tables per Phase 25B; Prisma schema + migration files |
| **Allowed changes** | Migration SQL, Prisma schema, feature-flag env vars default OFF, no-op write stubs |
| **Forbidden changes** | Live eval, production default change, PERCENT rollout, allowlist edits, participant artifact |
| **Preflight gates** | `make ai-platform-verify-phase25-design` PASS; `make ai-platform-verify-phase24-kpis` PASS |
| **Rollback** | `migrate resolve` + DROP TABLE or `AI_KPI_EVENTS_ENABLED=0` |
| **Tests** | Schema contract test; migration dry-run in CI |
| **Docs** | `PHASE_26A_OBSERVABILITY_SCHEMA_CLOSEOUT.md` |
| **Expected output** | Empty tables deployed; zero production traffic impact |

---

## Phase 26B — ingestion event instrumentation

| Item | Definition |
| ---- | ---------- |
| **Scope** | Write `ai_kpi_ingestion_events` from ingestion pipeline and ollama-worker |
| **Allowed changes** | Ingestion hooks, worker counters → DB inserts, read-only extractor update |
| **Forbidden changes** | Reindex/backfill without approval, live matrix, bench log commits |
| **Preflight gates** | 26A PASS; redaction test PASS |
| **Rollback** | Disable `AI_KPI_INGESTION_EVENTS_ENABLED`; stop writes |
| **Tests** | Ingestion KPI partial/gap handling; per-source_type counters |
| **Docs** | `PHASE_26B_INGESTION_INSTRUMENTATION_CLOSEOUT.md` |
| **Expected output** | `phase25_ingestion_kpis.json` with per-source_type metrics (PARTIAL→PASS) |

---

## Phase 26C — searchability verification probe

| Item | Definition |
| ---- | ---------- |
| **Scope** | Post-index probe writing `ai_kpi_searchability_checks`; compute `arrival_to_searchable_ms` |
| **Allowed changes** | Probe job/cron, searchability extractor |
| **Forbidden changes** | Production retrieval default change, live eval matrix |
| **Preflight gates** | 26B PASS or parallel if ingestion events optional |
| **Rollback** | Disable probe cron |
| **Tests** | data-to-searchable timing calculation; p50/p95/max percentiles |
| **Docs** | `PHASE_26C_SEARCHABILITY_PROBE_CLOSEOUT.md` |
| **Expected output** | `phase25_searchability_kpis.json` with non-null percentiles when data exists |

---

## Phase 26D — query observation instrumentation

| Item | Definition |
| ---- | ---------- |
| **Scope** | RAG middleware writes `ai_kpi_query_observations` (latency, protocol, gate_reason) |
| **Allowed changes** | python-ai observation hook, query latency extractor |
| **Forbidden changes** | Storing raw response bodies; JWT/password fields |
| **Preflight gates** | Redaction test PASS; 26A schema exists |
| **Rollback** | `AI_KPI_QUERY_OBSERVATIONS_ENABLED=0` |
| **Tests** | Query latency percentile calculation; no raw body in DB |
| **Docs** | `PHASE_26D_QUERY_OBSERVATION_CLOSEOUT.md` |
| **Expected output** | `phase25_query_latency_kpis.json`; optional H1 doc backfill policy |

---

## Phase 26E — usefulness observation export

| Item | Definition |
| ---- | ---------- |
| **Scope** | Rubric results → `ai_kpi_usefulness_observations`; time-series aggregation |
| **Allowed changes** | Eval export job (lab/preview only unless approved), usefulness extractor |
| **Forbidden changes** | Raw response bodies; unlabeled 171315 merges |
| **Preflight gates** | Evidence-label preservation test PASS |
| **Rollback** | Disable export job |
| **Tests** | usefulness time-series contract; evidence labels preserved |
| **Docs** | `PHASE_26E_USEFULNESS_EXPORT_CLOSEOUT.md` |
| **Expected output** | `phase25_usefulness_kpis.json` with `time_series[]` |

---

## Phase 26F — KPI dashboard/report generation

| Item | Definition |
| ---- | ---------- |
| **Scope** | Combined report script, Grafana panels or internal dashboard, Makefile verifier |
| **Allowed changes** | `make ai-platform-verify-phase26-kpis`, six JSON artifacts committed to CI artifacts only |
| **Forbidden changes** | Bench logs in git; production default change |
| **Preflight gates** | 26B–26E each PASS or honestly GAP |
| **Rollback** | Disable report cron |
| **Tests** | Combined JSON schema; operational health partial metrics |
| **Docs** | `PHASE_26F_KPI_DASHBOARD_CLOSEOUT.md` |
| **Expected output** | `phase25_combined_ai_platform_kpi_report.json` |

---

## Phase 26G — rollback/disable switch and closeout

| Item | Definition |
| ---- | ---------- |
| **Scope** | Master kill switch, closeout doc, ACTIVE_CONTEXT update |
| **Allowed changes** | `AI_KPI_OBSERVABILITY_MASTER_DISABLE=1`, closeout, context docs |
| **Forbidden changes** | PERCENT rollout; hybrid production default |
| **Preflight gates** | All 26A–26F docs complete |
| **Rollback** | Documented disable path verified in drill |
| **Tests** | Full verifier suite; production posture lock preservation |
| **Docs** | `PHASE_26G_OBSERVABILITY_IMPLEMENTATION_CLOSEOUT.md` |
| **Expected output** | Phase 26 CLOSED PASS or honest PARTIAL with gap inventory |

---

## Global forbidden across Phase 26

```text
Live eval / full matrix without explicit approval
Production default: keyword → hybrid/vector
PERCENT > 0 or ALLOW_PROD_PERCENT > 0
Participant artifact edits
Bench logs / JWTs / DB dumps / traces committed
Migrations without 26A gate
```

---

## Next allowed step after Phase 25 PASS

```text
Approved: start Phase 26A observability schema and no-op instrumentation implementation only after Phase 25 design PASS — no live eval, no production default, no PERCENT rollout.
```
