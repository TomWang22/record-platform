# Phase 28 — Observability Code Map

Map from Phase 28 documents → code → drills → guards → operational status. Phase 28 closed at `4132d01`; this doc is explanatory only.

Archive: `PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md`  
Operator guide: `PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md`  
Explainer: `PHASE_28I_PRODUCTION_READINESS_ARCHIVE_EXPLAINER.md`

```text
Operational status: Phase 28 CLOSED PASS for controlled observability production-readiness validation.
25920 matrix: separate evidence label — NOT merged into 57105/57105 or 171315/171315.
Production enablement: NOT APPROVED.
KPI write paths default enabled: NO (rolled back after 28G).
```

---

## Offline harness (28A/28B)

| Path | Role |
|------|------|
| `scripts/phase28-observability-durability-harness-readonly.mjs` | Offline fixture harness CLI |
| `scripts/lib/phase28-observability-durability-harness.mjs` | 16-scenario pipeline simulation |
| `scripts/lib/phase28-observability-production-readiness-guard.mjs` | 28A/28B doc guard |
| `scripts/phase28-observability-production-readiness-guard-readonly.mjs` | CLI |
| `tests/phase28-observability-durability-harness.test.mjs` | Harness unit tests |
| `tests/phase28-observability-production-readiness-guard.test.mjs` | Guard unit tests |

---

## Local/dev durability (28C)

| Path | Role |
|------|------|
| `scripts/phase28-local-dev-kpi-pipeline-durability-drill.py` | KPI pipeline durability on local/dev DB |

---

## Controlled matrix (28D/E)

| Path | Role |
|------|------|
| `scripts/phase28-controlled-observability-matrix-runner.mjs` | 25920-probe matrix runner (`/tmp` only) |
| `scripts/lib/phase28-controlled-matrix-summary.mjs` | Summary, latency tables, PASS gates |
| `scripts/phase28-summarize-controlled-matrix.mjs` | Merge shards + retry overrides |
| `scripts/phase28-extract-controlled-matrix-failures.mjs` | Failure triage (28D-R) |
| `scripts/phase28-write-matrix-kpi-rows.py` | Official KPI write path helper per probe |
| `scripts/lib/phase22-full-replay-common.mjs` | Shared curl/users/preview enroll helpers |
| `tests/phase28-controlled-matrix-summary.test.mjs` | Summary unit tests |

Evidence label constant: `MATRIX_EVIDENCE_LABEL` in `phase28-controlled-matrix-summary.mjs`.

---

## Closeout bundle (28F–28H)

| Path | Role |
|------|------|
| `scripts/phase28-generate-kpi-report-readonly.mjs` | `/tmp` combined KPI report |
| `scripts/phase28-disable-switch-rollback-drill.py` | Disable-switch rollback |
| `scripts/phase28-finalize-closeout.mjs` | Merge + report + rollback |
| `scripts/lib/phase28-production-readiness-closeout-guard.mjs` | 28H closeout doc guard |
| `scripts/phase28-production-readiness-closeout-guard-readonly.mjs` | CLI |
| `tests/phase28-production-readiness-closeout-guard.test.mjs` | Closeout guard tests |

---

## Archive layer (28I)

| Path | Role |
|------|------|
| `scripts/lib/phase28-archive-guard.mjs` | 28I archive/explainer guard |
| `scripts/phase28-archive-guard-readonly.mjs` | CLI |
| `tests/phase28-archive-guard.test.mjs` | Archive guard tests |

---

## KPI write paths (used during 28D matrix only; default OFF after 28G)

| Path | Channel |
|------|---------|
| `services/python-ai-service/app/ai/kpi_query_observations.py` | query |
| `services/python-ai-service/app/ai/kpi_usefulness_observations.py` | usefulness |
| `services/python-ai-service/app/ai/kpi_observability.py` | gate layer |

---

## Makefile targets

```text
ai-platform-verify-phase28-production-readiness
ai-platform-verify-phase28-controlled-matrix
ai-platform-verify-phase28-closeout
ai-platform-verify-phase28-archive
```

---

## Ticket closeouts (historical)

```text
docs/ai-platform/PHASE_28A_OBSERVABILITY_PRODUCTION_READINESS_TEST_ARCHITECTURE.md
docs/ai-platform/PHASE_28B_OBSERVABILITY_DURABILITY_HARNESS_AND_GUARDS.md
docs/ai-platform/PHASE_28C_LOCAL_DEV_KPI_PIPELINE_DURABILITY_DRILL.md
docs/ai-platform/PHASE_28D_CONTROLLED_REAL_INFERENCE_OBSERVABILITY_MATRIX.md
docs/ai-platform/PHASE_28D_CONTROLLED_MATRIX_RECOVERY_AND_TRIAGE.md
docs/ai-platform/PHASE_28E_H1_H2_H3_QUERY_OBSERVATION_PROTOCOL_VERIFICATION.md
docs/ai-platform/PHASE_28F_KPI_DURABILITY_REPORT_FROM_CONTROLLED_EVIDENCE.md
docs/ai-platform/PHASE_28G_DISABLE_SWITCH_ROLLBACK_DRILL.md
docs/ai-platform/PHASE_28H_OBSERVABILITY_PRODUCTION_READINESS_CLOSEOUT.md
docs/ai-platform/PHASE_28I_PRODUCTION_READINESS_ARCHIVE_EXPLAINER.md
docs/ai-platform/PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md
docs/ai-platform/PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md
docs/ai-platform/PHASE_28_OBSERVABILITY_CODE_MAP.md
```
