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
Phase 28D: IN_PROGRESS — controlled real-inference observability matrix (25920 target)
Phase 28E: IN_PROGRESS — H1/H2/H3 protocol verification (blocked on 28D)
Phase 28F: NOT STARTED
Phase 28G: NOT STARTED
Phase 28H: BLOCKED
Phase 28: BLOCKED — matrix must reach 25920/25920 with zero fallback/wrong_protocol/wrong_gate/leakage before closeout

Live eval run: NOT RUN
Controlled real inference run: IN_PROGRESS
Production DB migration: NOT RUN
Local/dev schema apply: PASS (python_ai @ 127.0.0.1:5440; Phase 27 only — no new writes in 28A/28B)
DB writes: NO (28A/28B offline harness only; Phase 27 historical rows remain on local/dev)
Migrations applied to live: NO
Real inference run: NOT RUN
Pipeline durability harness: PASS (offline fixtures)
H1/H2/H3 real protocol smoke: NOT RUN
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
Approved: start Phase 28C local/dev KPI pipeline durability drill only after Phase 28B harness PASS — no live eval, no production DB migration, no production default, no PERCENT rollout.
