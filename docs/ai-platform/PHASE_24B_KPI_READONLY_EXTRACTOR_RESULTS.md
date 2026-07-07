# Phase 24B — KPI read-only extractor results

**Status:** PASS — read-only extraction and gap inventory  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Bench logs committed:** NO

---

## Extractor commands

```bash
node scripts/phase24b-ai-kpi-readonly-report.mjs
node scripts/phase24b-ingestion-kpi-readonly.mjs
bash scripts/phase24b-operational-health-readonly.sh
```

Local summary output (optional, not committed):

```bash
PHASE24_KPI_WRITE_SUMMARY=/tmp/phase24-kpi-report.json node scripts/phase24b-ai-kpi-readonly-report.mjs
```

---

## Recommendation usefulness (from committed docs)

| Label | Count | Response pass | Sentiment pass | Red-team safety | Leakage |
| ----- | ----- | ------------- | -------------- | --------------- | ------- |
| H1 baseline | 57105/57105 HTTP/1.1 | archive summary | archive summary | archive summary | 0 |
| H2 replay | 57105/57105 HTTP/2 | 100% | 100% | 100% | 0 |
| H3 replay | 57105/57105 HTTP/3 | 100% | 100% | 100% | 0 |
| Phase 22C sample | 7200/7200 | 100% | 100% | 100% | 0 |
| Combined labeled | 171315 (H1+H2+H3) | labeled sum only | — | — | — |

---

## Retrieval latency (from committed docs)

| Label | p50 ms | p95 ms | max ms | Status |
| ----- | -----: | -----: | -----: | ------ |
| H1 baseline full matrix | — | — | — | **GAP** |
| H2 replay | 118.9 | 670.1 | 7192 | PASS |
| H3 replay | 130.9 | 785.8 | 8652.5 | PASS |
| Phase 22C sample H1/H2/H3 | see Phase 22C doc | see Phase 22C doc | see Phase 22C doc | PASS (sample only) |

---

## Ingestion pipeline (read-only DB probe)

Extractor behavior:

```text
SELECT-only against ai.ai_ingestion_runs, ai.ai_documents, ai.ai_document_chunks
If DB unreachable: status GAP
If reachable: run-level completed/failed/running counts + corpus counts + last run started_at/finished_at
ingestion_success_rate at per-record granularity: GAP unless last_run.source_counts supports approximation
```

---

## Data-to-searchable

```text
status: GAP
started_at/finished_at: reported when last ingestion run exists
arrival_to_searchable_ms: null (not instrumented end-to-end)
```

---

## Operational health

```text
Archive verifiers: read via phase24b-operational-health-readonly.sh
Phase 23 dry-run resume validation: read via same script
Production posture locks: keyword, PERCENT=0, ALLOW_PROD_PERCENT=0, hybrid/vector NOT APPROVED
Telemetry WARN audit: not re-run; reference Phase 22E doc
```

---

## Redaction policy

```text
No raw response bodies
No JWTs
No passwords
No DB dumps
No bench JSONL in committed output
```

---

## Open gaps after Phase 24B

1. `ingestion_success_rate` per source type — **GAP / PARTIAL**
2. `data_to_searchable_ms` end-to-end — **GAP**
3. H1 full-matrix latency summary in committed docs — **GAP**
4. Usefulness over time time-series — **GAP**
