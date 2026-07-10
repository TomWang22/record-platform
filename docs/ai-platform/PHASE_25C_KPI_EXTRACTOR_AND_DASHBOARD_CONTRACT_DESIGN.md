# Phase 25C — KPI extractor and dashboard contract design

**Phase 25C:** COMPLETE — JSON schemas as design contracts only  
**Implementation:** Phase 26F

---

## Executive verdict

Phase 25C defines **six JSON artifact contracts** and **six dashboard sections**. Extractors are not implemented in Phase 25.

Every artifact shares this envelope:

```json
{
  "generated_at": "2026-07-07T18:00:00Z",
  "git_sha": "4d5b11b",
  "artifact_sha": "1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa",
  "environment": "readonly-design",
  "source": "phase25-design-contract",
  "status": "PASS | PARTIAL | GAP | BLOCKED",
  "metrics": {},
  "gaps": [],
  "redaction_status": "PASS"
}
```

`status` semantics:

| Status | Meaning |
| ------ | ------- |
| PASS | Metric fully instrumented and extracted |
| PARTIAL | Some data available; per Phase 24 honesty rules |
| GAP | Not instrumented; design path only |
| BLOCKED | Preflight or posture lock prevents extraction |

---

## Contract: `phase25_ingestion_kpis.json`

**Closes gap:** ingestion_success_rate per source type (Phase 26B).

```json
{
  "generated_at": "ISO-8601",
  "git_sha": "string",
  "artifact_sha": "1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa",
  "environment": "prod | preview | lab | readonly-design",
  "source": "ai_kpi_ingestion_events | ai_ingestion_runs_fallback",
  "status": "PARTIAL",
  "metrics": {
    "by_source_type": {
      "listing": {
        "records_received": 0,
        "records_indexed": 0,
        "ingestion_success_rate": null,
        "embedding_jobs_started": 0,
        "embedding_jobs_completed": 0,
        "embedding_jobs_failed": 0,
        "index_upsert_success": 0,
        "index_upsert_failed": 0,
        "dead_letter_count": 0,
        "retry_count": 0
      }
    },
    "run_level": {
      "completed_runs": 0,
      "failed_runs": 0
    }
  },
  "gaps": ["per-record ingestion_success_rate requires Phase 26B events"],
  "redaction_status": "PASS"
}
```

**Phase 25 honest status:** GAP/PARTIAL until Phase 26B.

---

## Contract: `phase25_searchability_kpis.json`

**Closes gap:** data_to_searchable_ms end-to-end (Phase 26C).

```json
{
  "status": "GAP",
  "metrics": {
    "arrival_to_searchable_ms": {
      "p50": null,
      "p95": null,
      "max": null,
      "sample_count": 0
    },
    "embedding_duration_ms": { "p50": null, "p95": null, "max": null },
    "index_upsert_duration_ms": { "p50": null, "p95": null, "max": null }
  },
  "gaps": ["searchability_checks table not deployed"]
}
```

---

## Contract: `phase25_query_latency_kpis.json`

**Closes gap:** H1 full-matrix latency in committed docs (Phase 26D + doc policy).

```json
{
  "status": "PARTIAL",
  "metrics": {
    "by_protocol": {
      "HTTP/1.1": { "p50_ms": null, "p95_ms": null, "max_ms": null, "evidence_label": "H1 baseline 57105/57105", "note": "GAP in committed docs until 26D" },
      "HTTP/2": { "p50_ms": null, "p95_ms": null, "max_ms": null, "evidence_label": "H2 replay 57105/57105" },
      "HTTP/3": { "p50_ms": null, "p95_ms": null, "max_ms": null, "evidence_label": "H3 replay 57105/57105" }
    },
    "by_gate_reason": {},
    "by_workflow": {},
    "fallback_count": 0,
    "canary_error_count": 0
  },
  "gaps": ["H1 full-matrix p50/p95/max not in committed docs"]
}
```

---

## Contract: `phase25_usefulness_kpis.json`

**Closes gap:** usefulness over time time-series (Phase 26E).

```json
{
  "status": "GAP",
  "metrics": {
    "time_series": [],
    "by_protocol": {
      "HTTP/1.1": { "response_pass_rate": null, "evidence_label": "H1 baseline 57105/57105" },
      "HTTP/2": { "response_pass_rate": null, "evidence_label": "H2 replay 57105/57105" },
      "HTTP/3": { "response_pass_rate": null, "evidence_label": "H3 replay 57105/57105" }
    },
    "rubric": {
      "response_pass": null,
      "sentiment_pass": null,
      "red_team_safety_pass": null,
      "leakage_failures": null,
      "quality_score_avg": null
    }
  },
  "gaps": ["usefulness_observations time-series not deployed"]
}
```

---

## Contract: `phase25_operational_health_kpis.json`

```json
{
  "status": "PARTIAL",
  "metrics": {
    "uptime_ratio": null,
    "http_4xx_rate": null,
    "http_5xx_rate": null,
    "timeout_rate": null,
    "fallback_rate": null,
    "canary_error_rate": null,
    "telemetry_warn_count": null,
    "production_posture": {
      "default_retrieval": "keyword",
      "PERCENT": 0,
      "ALLOW_PROD_PERCENT": 0,
      "hybrid_vector_production_default": "NOT APPROVED"
    }
  },
  "gaps": ["unified uptime/error budget requires Phase 26F Prometheus wiring"]
}
```

---

## Contract: `phase25_combined_ai_platform_kpi_report.json`

Aggregator referencing all five artifacts plus evidence labels.

```json
{
  "status": "PARTIAL",
  "metrics": {
    "evidence_labels": {
      "H1_baseline": "57105/57105",
      "H2_replay": "57105/57105",
      "H3_replay": "57105/57105",
      "labeled_sum_only": "171315/171315",
      "Phase_22C": "7200/7200 sample only",
      "Phase_22B": "15/15 smoke only"
    },
    "ingestion": { "$ref": "phase25_ingestion_kpis.json" },
    "searchability": { "$ref": "phase25_searchability_kpis.json" },
    "query_latency": { "$ref": "phase25_query_latency_kpis.json" },
    "usefulness": { "$ref": "phase25_usefulness_kpis.json" },
    "operational_health": { "$ref": "phase25_operational_health_kpis.json" }
  },
  "gaps": ["see child artifacts"],
  "redaction_status": "PASS"
}
```

---

## Dashboard sections (Phase 26F UI or Grafana)

| # | Section | Primary artifact | Phase 26 owner |
| - | ------- | ---------------- | -------------- |
| 1 | Usefulness over time | phase25_usefulness_kpis.json | 26E + 26F |
| 2 | Retrieval latency by protocol/workflow | phase25_query_latency_kpis.json | 26D + 26F |
| 3 | Ingestion success by source type | phase25_ingestion_kpis.json | 26B + 26F |
| 4 | Data-to-searchable p50/p95/max | phase25_searchability_kpis.json | 26C + 26F |
| 5 | Operational health and error budget | phase25_operational_health_kpis.json | 26F |
| 6 | Production posture locks | embedded in operational_health | existing verifiers |

---

## Evidence label preservation (mandatory)

```text
H1 baseline: 57105/57105
H2 replay: 57105/57105
H3 replay: 57105/57105
171315 labeled sum only — never unlabeled cumulative
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
```

---

## Related documents

- `PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md`
- `PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md`
