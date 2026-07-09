Agent ACTIVE CONTEXT — AI Platform

Do not use chat memory as source of truth.
Before any future AI-platform work, run:

make ai-platform-verify-phase28-production-readiness

Then read:
- docs/ai-platform/ACTIVE_CONTEXT.md
- docs/ai-platform/PHASE_28A_OBSERVABILITY_PRODUCTION_READINESS_TEST_ARCHITECTURE.md
- docs/ai-platform/PHASE_28B_OBSERVABILITY_DURABILITY_HARNESS_AND_GUARDS.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_CODE_MAP.md
- docs/ai-platform/PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md
- docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md

Current repo tip:
- Compute live with: git rev-parse --short HEAD
- Do not infer current repo tip from this file.

Phase handoff lineage:
- Phase 23A operations-design commit: 77af124
- Phase 23A metadata-sync commit: 6442d87
- Phase 23B context-archive verifier hardening commit: 304277a
- Phase 23 context-continuity guardrail closeout commit: 6f3d2bd
- Phase 24 KPI observability read-only closeout commit: c21c2ae
- Phase 25 observability instrumentation design closeout commit: 3fc3be4
- Phase 26A observability schema/no-op closeout commit: edb7570
- Phase 26B ingestion KPI instrumentation closeout commit: b243699
- Phase 26C searchability verification probe closeout commit: eb7079a
- Phase 26D query observation instrumentation closeout commit: 104979c
- Phase 26E usefulness observation export closeout commit: 883cb61

Frozen archive heads:
- Phase 22 archive HEAD: 5588779
- Phase 21 archive checkpoint: 328161d
- Phase 21 pre-archive validation HEAD: bd76875

Phase 21: CLOSED PASS / ARCHIVED
Phase 22: CLOSED PASS — full labeled protocol parity
Phase 23: CLOSED PASS — context continuity and long-run replay guardrails
Phase 24: CLOSED PASS — KPI observability read-only extraction and gap inventory
Phase 25: CLOSED PASS — observability instrumentation design batch
Phase 26A: PASS — observability schema and no-op instrumentation foundation
Phase 26B: PASS — ingestion KPI event instrumentation (default-off)
Phase 26C: PASS — searchability verification probe (default-off)
Phase 26D: PASS — query observation instrumentation (default-off)
Phase 26E: PASS — usefulness observation export (default-off)
Phase 26F: PASS — KPI dashboard/report generation (read-only)
Phase 26G: PASS — observability disable-switch drill and closeout
Phase 26H: PASS — archive/explainer docs only (no runtime changes)
Phase 26H: archive/explainer docs PASS — current Phase 26 source of truth is PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 26I: PASS — archive consistency / supersession notes (historical closeouts clarified; no runtime changes)
Phase 26J: PASS — archive supersession guard (read-only; prevents historical-snapshot drift)
Phase 26: CLOSED PASS — observability implementation batch (closeout 4409ffc)
Phase 27A: PASS — observability operational enablement roadmap (design only)
Phase 27B: PASS — local/dev KPI schema apply verification
Phase 27C: PASS — controlled KPI flag enablement drill (process env only)
Phase 27D: PASS — controlled KPI row population via write paths (real local/dev DB rows)
Phase 27E: PASS — controlled query/usefulness observation smoke (no 57105)
Phase 27F: PASS — combined KPI report from controlled rows (/tmp only)
Phase 27G: PASS — KPI disable-switch rollback drill
Phase 27H: PASS — observability operational enablement closeout
Phase 27I: PASS — archive/explainer docs only (no runtime/DB changes)
Phase 27: CLOSED PASS — controlled local/dev operational enablement batch
Phase 27 archive source of truth: PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 28A: PASS — observability production-readiness test architecture (docs + acceptance matrix)
Phase 28B: PASS — offline durability harness + strict guards (fixtures only; no network)
Phase 28C: PASS — local/dev KPI pipeline durability drill
Phase 28D: PASS — controlled real-inference observability matrix 25920/25920
Phase 28D-R: PASS — recovery/retry infrastructure (15 transient 502/504 retried clean)
Phase 28E: PASS — H1/H2/H3 protocol verification
Phase 28F: PASS — /tmp combined KPI report
Phase 28G: PASS — disable-switch rollback drill
Phase 28H: PASS — observability production-readiness closeout
Phase 28I: PASS — archive/explainer docs only (no runtime/DB changes)
Phase 28: CLOSED PASS — controlled observability production-readiness batch
Phase 28 archive source of truth: PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 29A: PASS — observability production enablement RFC
Phase 29B: PASS — preflight verification (Phase 21/22/27/28 archive verifiers + posture locks)
Phase 29C: PASS — controlled env readiness (local/dev python_ai @ 127.0.0.1:5440)
Phase 29D: PASS — pipeline durability drill
Phase 29E: PASS — controlled real-inference observability matrix 25920/25920 (2 preview lifecycle retries clean)
Phase 29F: PASS — Cursor-owned monitor loop completed
Phase 29G: PASS — /tmp combined KPI report (usefulness PARTIAL acceptable)
Phase 29H: PASS — disable-switch rollback drill
Phase 29I: PASS — CANDIDATE CONTROLLED ENABLEMENT (staging/non-prod only; no production enablement performed)
Phase 29J: PASS — production enablement archive
Phase 29K: PASS — archive/explainer docs only (no runtime/DB changes)
Phase 29: CLOSED PASS — controlled observability production-enablement batch
Phase 29 archive source of truth: PHASE_29_OBSERVABILITY_PRODUCTION_ENABLEMENT_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 30A: PASS — controlled staging KPI enablement plan
Phase 30B: PASS — staging preflight verification
Phase 30C: PASS — staging schema apply verification (python_ai @ 127.0.0.1:5440, AI_KPI_ENVIRONMENT=staging)
Phase 30D: PASS — staging KPI flag enablement drill
Phase 30E: PASS — pipeline durability soak
Phase 30F: PASS — real-inference H1/H2/H3 soak 25920/25920 (4 preview lifecycle retries clean)
Phase 30G: PASS — /tmp combined KPI report (usefulness PARTIAL acceptable)
Phase 30H: PASS — disable-switch rollback drill
Phase 30I: PASS — staging-only continue (no production enablement)
Phase 30J: PASS — staging enablement archive
Phase 30: CLOSED PASS — controlled staging/non-prod KPI enablement batch
Phase 30 archive source of truth: PHASE_30J_CONTROLLED_STAGING_KPI_ENABLEMENT_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 30 evidence label: Phase 30 controlled staging KPI enablement matrix: 25920/25920 target (NOT merged into 57105/171315 or Phase 29 25920)
Phase 30 staging target: controlled staging/non-prod — k8s record-platform / python-ai-service / https://record-platform.test / python_ai@127.0.0.1:5440

Live eval run: NOT RUN
Controlled real inference run: PASS (Phase 30F matrix 25920/25920)
Production DB migration: NOT RUN
Local/dev schema apply: PASS (python_ai @ 127.0.0.1:5440; Phase 27 only — no new writes in 28A/28B)
DB writes: controlled matrix KPI rows on local/dev only during 28D run; flags rolled back after 28G
Migrations applied to live: NO
Real inference run: NOT RUN (controlled matrix only)
Pipeline durability harness: PASS (offline fixtures)
H1/H2/H3 real protocol smoke: PASS (25920/25920 controlled matrix)
Bench logs committed: NO
Generated reports committed: NO

Local/dev KPI schema:
- Applied to python_ai @ 127.0.0.1:5440 (Phase 26C preflight + Phase 27B verify)
- Production/live DB migration: NOT APPLIED

Artifact SHA256:
1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa

Labeled evidence:
- H1 baseline: 57105/57105 HTTP/1.1
- H2 replay: 57105/57105 HTTP/2 PASS
- H3 replay: 57105/57105 HTTP/3 PASS
- Combined labeled full-protocol evidence: 171315/171315
- Phase 22C: 7200/7200 sample only
- Phase 22B: 15/15 smoke only

Evidence label rules:
- H1 baseline is Phase 21 historical HTTP/1.1 matrix.
- H2 replay is Phase 22I full HTTP/2 replay.
- H3 replay is Phase 22J full HTTP/3 replay.
- 171315/171315 is labeled H1+H2+H3 only; never call it an unlabeled cumulative total.
- Phase 22C 7200/7200 is sample only; never call it full parity.
- Phase 22B 15/15 is smoke only; never call it matrix evidence.

KPI truth after Phase 27 closeout:
- KPI observability implementation is complete behind default-off gates
- Operational KPI row population remains disabled by default
- Phase 27 proved controlled local/dev enablement can populate redacted rows and report on them
- Combined /tmp reports from controlled rows: ingestion/searchability/query/usefulness PASS; operational_health PARTIAL
- Disable-switch rollback PASS after the drill
- H1 full-matrix latency summary in committed docs: GAP — not backfilled
- No production rollout is approved

Locked production posture:
- Production default: keyword
- Preview UI/API: KEEP
- PERCENT=0
- ALLOW_PROD_PERCENT=0
- Hybrid/vector production default: NOT APPROVED
- Runtime/env/default/allowlist changes: NONE
- AI_KPI_* observability flags: default OFF, master disable ON
- Production enablement: NOT APPROVED

Phase 28 docs:
- docs/ai-platform/PHASE_28A_OBSERVABILITY_PRODUCTION_READINESS_TEST_ARCHITECTURE.md
- docs/ai-platform/PHASE_28B_OBSERVABILITY_DURABILITY_HARNESS_AND_GUARDS.md
- docs/ai-platform/PHASE_28I_PRODUCTION_READINESS_ARCHIVE_EXPLAINER.md
- docs/ai-platform/PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md
- docs/ai-platform/PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_28_OBSERVABILITY_CODE_MAP.md

Phase 27 docs:
- docs/ai-platform/PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md
- docs/ai-platform/PHASE_27B_LOCAL_DEV_KPI_SCHEMA_APPLY_VERIFICATION.md
- docs/ai-platform/PHASE_27C_CONTROLLED_KPI_FLAG_ENABLEMENT_DRILL.md
- docs/ai-platform/PHASE_27D_CONTROLLED_KPI_ROW_POPULATION_DRILL.md
- docs/ai-platform/PHASE_27E_CONTROLLED_QUERY_USEFULNESS_OBSERVATION_SMOKE.md
- docs/ai-platform/PHASE_27F_COMBINED_KPI_REPORT_FROM_CONTROLLED_ROWS.md
- docs/ai-platform/PHASE_27G_KPI_DISABLE_SWITCH_ROLLBACK_DRILL.md
- docs/ai-platform/PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md
- docs/ai-platform/PHASE_27I_OPERATIONAL_ENABLEMENT_ARCHIVE_EXPLAINER.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_27_OBSERVABILITY_CODE_MAP.md

Explainer docs (Phase 26H) + supersession guard (26J):
- docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_CODE_MAP.md
- docs/ai-platform/PHASE_26J_ARCHIVE_SUPERSESSION_GUARD.md

Next allowed step:
Phase 30 CLOSED PASS — controlled staging/non-prod KPI enablement complete. No production enablement performed. Future production decision requires explicit owner approval.
