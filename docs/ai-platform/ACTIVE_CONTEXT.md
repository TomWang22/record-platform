Agent ACTIVE CONTEXT — AI Platform

Do not use chat memory as source of truth.
Before any future AI-platform work, run:

make ai-platform-verify-phase26b-ingestion

Then read:
- docs/ai-platform/ACTIVE_CONTEXT.md
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
Phase 26C: NOT STARTED

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

KPI gaps — ingestion write path in Phase 26B; remaining in 26C–26E:
- ingestion_success_rate per source type: extractor PASS when event rows exist; operational population default-off
- data_to_searchable_ms end-to-end: GAP — Phase 26C
- H1 full-matrix latency summary in committed docs: GAP — Phase 26D
- usefulness over time time-series: GAP — Phase 26E

Locked production posture:
- Production default: keyword
- Preview UI/API: KEEP
- PERCENT=0
- ALLOW_PROD_PERCENT=0
- Hybrid/vector production default: NOT APPROVED
- Runtime/env/default/allowlist changes: NONE
- AI_KPI_* observability flags: default OFF, master disable ON

Next allowed step:
Approved: start Phase 26C searchability verification probe implementation only after Phase 26B ingestion instrumentation PASS — no live eval, no production default, no PERCENT rollout.
