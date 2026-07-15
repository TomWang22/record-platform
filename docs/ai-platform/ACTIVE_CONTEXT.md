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
- Phase 23A operations-design commit: 2223168
- Phase 23A metadata-sync commit: 0e8e6d2
- Phase 23B context-archive verifier hardening commit: 8316b60
- Phase 23 context-continuity guardrail closeout commit: 210df98
- Phase 24 KPI observability read-only closeout commit: 4d5b11b
- Phase 25 observability instrumentation design closeout commit: 7d054ad
- Phase 26A observability schema/no-op closeout commit: e40683e
- Phase 26B ingestion KPI instrumentation closeout commit: e75b6d2
- Phase 26C searchability verification probe closeout commit: 7746b45
- Phase 26D query observation instrumentation closeout commit: 5d8c82e
- Phase 26E usefulness observation export closeout commit: 6500730

Frozen archive heads:
- Phase 22 archive HEAD: 7257380
- Phase 21 archive checkpoint: 1422152
- Phase 21 pre-archive validation HEAD: 2eb1606

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
Phase 26: CLOSED PASS — observability implementation batch (closeout f09a9ef)
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
Phase 30K: PASS — archive/explainer docs only (no runtime/DB changes)
Phase 30: CLOSED PASS — controlled staging/non-prod KPI enablement batch
Phase 30 archive source of truth: PHASE_30_OBSERVABILITY_STAGING_ENABLEMENT_ARCHIVE.md plus ACTIVE_CONTEXT.md.
Phase 31A: PASS — production KPI enablement RFC
Phase 31B: PASS — preflight and archive verification
Phase 31C: PASS — staging long-soak plan + monitor ownership
Phase 31D: BLOCKED (original) — soak 51840/51840 complete; wrong_gate=8; superseded by 31D-R2
Phase 31D-R2: PASS — repaired soak 51840/51840; all gates clean
Phase 31E: PASS — pipeline durability + failure injection
Phase 31F: PASS — /tmp KPI report (usefulness PASS)
Phase 31G: PASS — latency regression analysis
Phase 31H: PASS — disable-switch rollback
Phase 31I: PASS — STAGING CONTINUE (no production enablement)
Phase 31J: PASS — production enablement decision archive
Phase 31: CLOSED PASS — repaired long-soak evidence under 31D-R2; staging-only continuity (NOT production enablement)
Phase 31K (preview lifecycle): PASS — preview lifecycle gate root-cause analysis (parallel shard enrollment race)
Phase 31O (latency outlier): PASS — latency max outlier ~1,037,645 ms documented; blocks production KPI enablement until RCA
Phase 31L: PASS — shared window coordinator + gate verify + JWT validation
Phase 31M: PASS — targeted replay 3672/3672
Phase 31N: PASS — Decision B full repaired soak required and completed
Phase 32A: PASS — latency RCA design + acceptance gates
Phase 32B: PASS — read-only latency outlier analyzer; output /tmp/phase32-latency-rca/
Phase 32C: PASS — timing attribution instrumentation ready for 32D micro-soak
Phase 32D: PASS — timing attribution micro-soak 3888/3888; 17-minute outlier NOT reproduced
Phase 32E: PASS — slow KPI write durability 1296/1296 × 3 modes; KPI write path fail-open under injected delay/failure
Phase 32F: PASS — RCA narrowed; stall-capture instrumentation + analyzer ready for 32G long soak
Phase 32G: PASS — controlled staging soak 51840/51840; latency readiness BLOCKED pending Phase 32H; REPRODUCED_AND_TRANSPORT_WAIT_LOCALIZED (underlying cause unresolved); production enablement NOT APPROVED
Phase 32H: COMPLETE — transport/runtime PASS for baseline-r9 and protected caffeinate-r1 (8640/8640 each); causal verdict NO_CAUSAL_SEPARATION; underlying historical >=60s cause UNRESOLVED; secondary FULL_SOAK_OR_ADDITIONAL_TARGETED_REPRO_REQUIRED; production enablement NOT APPROVED
Phase 32H closeout: docs/ai-platform/PHASE_32H_R1_CLOSEOUT.md
Phase 33A: COMPLETE — schemas/matrix/fixtures/validator only; gauntlet NOT LAUNCHED
Phase 33B: COMPLETE — data lineage, embedding lineage records, sanitized retrieval corpus, offline evaluator; live gauntlet NOT LAUNCHED; no production embedding writes
Phase 33C: COMPLETE — scarcity/valuation/auction intelligence deterministic engines + routes + 550 scenarios; live gauntlet NOT LAUNCHED; retrieval default remains keyword
Phase 33D: COMPLETE — negotiation/recommendations + coverage/approval hardening; automatic send DISABLED; live gauntlet NOT LAUNCHED
Phase 33E: COMPLETE — market analytics + multi-turn memory (fixture/session only); durable private memory NOT AUTHORIZED; live gauntlet NOT LAUNCHED
Phase 33F: READINESS PACKAGE COMPLETE — canary BLOCKED on semantic_fixture Recall@5 (<0.35); 720-probe canary NOT LAUNCHED; 17280 target NOT LAUNCHED
Phase 33G: NOT LAUNCHED
Phase 31 evidence label: Phase 31D-R2 repaired staging long-soak matrix: 51840/51840 target (NOT merged into 57105/171315 or Phase 30 25920)
Production enablement: NOT APPROVED — latency max outlier ~1,037,645 ms requires RCA before production KPI enablement; Phase 32H did not resolve root cause

Live eval run: NOT RUN
Controlled real inference: RUN (Phase 32G timing-attributed long soak PASS — 51840/51840)
Production/live eval: NOT RUN
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
Phase 32H-R1 COMPLETE with NO_CAUSAL_SEPARATION (do not claim host-suspension remediation). Phase 33A–33E COMPLETE; Phase 33F readiness package present but canary FAIL-CLOSED on semantic_fixture Recall@5 (0.137 < 0.35). Verify with `make ai-platform-verify-phase33a-contracts` … `make ai-platform-verify-phase33f`. Do not create the 720-probe canary root while readiness is BLOCKED; do not launch the 17280 target or Phase 33G without separate owner approval. Production enablement NOT APPROVED; default keyword; PERCENT=0; ALLOW_PROD_PERCENT=0; hybrid/vector default NOT ENABLED; automatic negotiation sending DISABLED. Canonical matrix: `scripts/ai-platform/intelligence-capability-matrix.json`.
