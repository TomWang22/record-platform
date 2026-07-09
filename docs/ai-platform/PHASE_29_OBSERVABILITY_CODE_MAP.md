# Phase 29 — Observability Code Map

Archive: `PHASE_29_OBSERVABILITY_PRODUCTION_ENABLEMENT_ARCHIVE.md`  
Operator guide: `PHASE_29_OBSERVABILITY_OPERATOR_GUIDE.md`  
Explainer: `PHASE_29K_PRODUCTION_ENABLEMENT_ARCHIVE_EXPLAINER.md`

```text
Phase 29 CLOSED PASS — production-enablement validation track.
25920 matrix: separate evidence label — NOT merged into 57105/171315.
Production enablement: NOT APPROVED.
```

## Matrix (29E)

| Path | Role |
|------|------|
| `scripts/phase29-controlled-observability-matrix-runner.mjs` | 25920-probe runner |
| `scripts/lib/phase29-controlled-matrix-summary.mjs` | Summary + latency |
| `scripts/phase29-summarize-controlled-matrix.mjs` | Merge shards |
| `scripts/phase29-monitor-controlled-matrix.sh` | Cursor-owned monitor |
| `scripts/phase29-extract-controlled-matrix-failures.mjs` | Failure triage |
| `scripts/phase29-finalize-closeout.mjs` | Closeout bundle |

## Drills (29D/29G/29H)

| Path | Role |
|------|------|
| `scripts/phase29-pipeline-durability-drill.py` | Pipeline durability |
| `scripts/phase29-generate-kpi-report-readonly.mjs` | `/tmp` KPI report |
| `scripts/phase29-disable-switch-rollback-drill.py` | Rollback drill |
| `scripts/phase29-write-matrix-kpi-rows.py` | Per-probe KPI writes |

## Guards (29J/29K)

| Path | Role |
|------|------|
| `scripts/lib/phase29-production-enablement-guard.mjs` | Track guard |
| `scripts/lib/phase29-archive-guard.mjs` | Archive guard |
| `scripts/phase29-archive-guard-readonly.mjs` | Archive CLI |
| `tests/phase29-archive-guard.test.mjs` | Archive tests |

Evidence label: `MATRIX_EVIDENCE_LABEL` in `phase29-controlled-matrix-config.mjs`.
