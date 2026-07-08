Agent ACTIVE CONTEXT — AI Platform

Do not use chat memory as source of truth.
Before any future AI-platform work, run:

make ai-platform-verify-phase26-observability

Then read:
- docs/ai-platform/ACTIVE_CONTEXT.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_CODE_MAP.md
- docs/ai-platform/PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md
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

Live eval: NOT RUN
DB writes (26J/27A): NO
Migrations applied (26J/27A): NO

Local/dev KPI schema:
- Applied to python_ai @ 127.0.0.1:5440 (Phase 26C preflight)
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

KPI truth after Phase 26 closeout:
- KPI observability implementation is complete behind default-off gates
- Operational KPI row population remains disabled by default
- KPI reports show PASS/PARTIAL/GAP based on available rows
- ingestion_success_rate per source type: 26B write path (default-off; extractor PASS when rows exist)
- data_to_searchable_ms end-to-end: 26C write path + extractor PASS when check rows exist; GAP when absent
- query latency from ai_kpi_query_observations: 26D write path + extractor PASS/PARTIAL/GAP when rows exist/absent
- H1 full-matrix latency summary in committed docs: GAP — not backfilled from observation rows
- usefulness over time time-series: 26E write path + extractor PASS/PARTIAL/GAP when rows exist/absent
- combined Phase 25C JSON report generation: 26F read-only PASS
- disable-switch drill: 26G PASS — all channels blocked under master disable and global off

Locked production posture:
- Production default: keyword
- Preview UI/API: KEEP
- PERCENT=0
- ALLOW_PROD_PERCENT=0
- Hybrid/vector production default: NOT APPROVED
- Runtime/env/default/allowlist changes: NONE
- AI_KPI_* observability flags: default OFF, master disable ON

Explainer docs (Phase 26H) + supersession guard (26J) + roadmap (27A):
- docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md
- docs/ai-platform/PHASE_26_OBSERVABILITY_CODE_MAP.md
- docs/ai-platform/PHASE_26J_ARCHIVE_SUPERSESSION_GUARD.md
- docs/ai-platform/PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md

Next allowed step:
Approved: start Phase 27B local/dev KPI schema apply verification only after Phase 27A roadmap PASS — no live DB migration, no live eval, no production default, no PERCENT rollout.
