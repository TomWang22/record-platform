# Phase 21 — Copilot / agent context (Record Platform AI)

**Last updated:** 2026-07-08 (Phase 26F KPI dashboard/report generation PASS)  
**Current repo tip:** compute live with `git rev-parse --short HEAD` (see `docs/ai-platform/ACTIVE_CONTEXT.md`)  
**Phase 22 archive HEAD:** `5588779`  
**Phase 21 archive checkpoint:** `328161d`  
**Release tag:** `rp-ai-phase-21-non-vector-seller-intelligence-20260628` @ `d0e4c58`  
**Final validation SHA (P21.7B):** `13bc0ad`  
**Phase 21 status:** **CLOSED PASS** — N=5 opt-in hybrid preview production-readiness **ARCHIVED** @ `328161d`; no further T20 live eval unless explicitly approved  
**Phase 22 status:** **CLOSED PASS / ARCHIVED** — full labeled protocol parity H1/H2/H3 each **57105/57105** (see `PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md`)  
**Phase 23 status:** **CLOSED PASS** — context continuity and long-run replay guardrails.  
**Phase 24 status:** **CLOSED PASS** — KPI observability read-only extraction and gap inventory. **24A COMPLETE** (design). **24B PASS** (read-only extractors). **24C PASS** (guard tests/Makefile). **24D PASS** (closeout). Phase 24 live work: **NOT APPROVED.**  
**Phase 25 status:** **CLOSED PASS** — observability instrumentation design batch. **25A–25D COMPLETE** (architecture, schema contracts, extractor/dashboard contracts, rollout plan). **25E PASS** (design guard + tests). **25F PASS** (closeout). No runtime/schema/live changes.  
**Phase 26A status:** **PASS** — observability schema and no-op instrumentation foundation. Migration SQL committed; live DB not migrated. **AI_KPI_* flags default OFF.** Runtime writes disabled.  
**Phase 26B status:** **PASS** — ingestion KPI event instrumentation behind default-off flags. Per-source_type extractor PASS when event rows exist; run-level PARTIAL fallback preserved.  
**Phase 26C status:** **PASS** — searchability verification probe behind default-off flags. Local/dev python_ai schema applied @ 127.0.0.1:5440.  
**Phase 26D status:** **PASS** — query observation instrumentation behind default-off flags. H1/H2/H3 protocol capture unit-tested. Optional 3-probe smoke NOT RUN.  
**Phase 26E status:** **PASS** — usefulness observation export behind default-off flags. H1/H2/H3 evidence labels unit-tested. No live eval.  
**Phase 26F status:** **PASS** — combined read-only KPI dashboard/report generation. Output to `/tmp` only; not committed. **26G NOT STARTED.**  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

Use this document as the **source of truth** for Phase 21 state. For Phase 20 vector/shadow history, see `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`.

---

## Locked takeaway

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED @ d0e4c58

Production path:
- retrieval: keyword (default for all non-allowlisted users)
- synthesis: rule-engine (rag_synthesis.py templates)
- model_used: rule-engine
- vector default: OFF
- AI_RAG_SHADOW_VECTOR: 0 (must remain off unless explicitly approved)

T20.15A–AG complete. Hybrid canary ladder: CLOSED.
T20.16A–F complete. Hybrid production-readiness batch: CLOSED.
T20.16B final_tagged_plan fallback: fixed (0% fallback on D-LIVE 45/45).
T20.16C pure vector: 8/16 report-only; anchored 16/16.
T20.16D-LIVE: PASS — 45/45 HTTP 200, avg score 4.0, hybrid p95 439 ms.
T20.16E: B selected (KEEP allowlist); C recommended (future soak design).
T20.17A–E complete. Scoped hybrid soak batch: CLOSED.
T20.17C-LIVE: PASS — 90/90 HTTP 200, 0% fallback, avg score 4.0, hybrid p95 223 ms.
T20.17D: B selected (KEEP allowlist); C recommended (broader soak → T20.18A).
T20.18A–E complete. Broader multi-user soak batch: CLOSED.
T20.18C-LIVE: PASS — 270/270 HTTP 200 (6 users), 0% fallback, hybrid p95 146 ms.
T20.18D: B selected (single contract-user allowlist); D recommended (T20.19A).
T20.19A–E complete. Extended multi-window soak batch: CLOSED.
T20.19C-LIVE: PASS — 810/810 HTTP 200 (6 users, 3 windows), 0% fallback, hybrid p95 119 ms.
T20.19D: B selected (single contract-user allowlist); D recommended (T20.20A).
T20.20A–E complete. Hybrid production-decision batch: CLOSED.
T20.20C-LIVE: PASS — 540/540 HTTP 200 (6 users, 2 windows), 0% fallback, hybrid p95 142 ms.
T20.20D: B selected (single contract-user allowlist); D recommended (T20.21A).
T20.21A–D complete. Hybrid default RFC / owner sign-off batch: CLOSED.
T20.21B-LIVE: PASS — 270/270 HTTP 200 (6 users), 0% fallback, hybrid p95 155 ms.
T20.21C: B selected (single contract-user allowlist); E rejected (default switch).
T20.22A–D complete. Hybrid production rollout design batch: CLOSED.
T20.22B audit: PASS (no new live inference).
T20.22C: B selected (single contract-user allowlist); D rejected (rollout NOT APPROVED).
T20.23A–D complete. Opt-in hybrid preview design batch: CLOSED.
T20.23B audit: PASS (no new live inference).
T20.23C: B selected (single contract-user allowlist); D and E rejected (preview NOT APPROVED).
T20.24A–D complete. Opt-in hybrid preview implementation design batch: CLOSED.
T20.24B audit: PASS (no new live inference).
T20.24C: B selected (single contract-user allowlist); D and E rejected (implementation NOT APPROVED).
T20.25A–G complete. Opt-in hybrid preview implementation batch: CLOSED.
T20.25D-LIVE: PASS — 540/540 HTTP 200 (6 users, 2 windows), 0% fallback, hybrid p95 214 ms.
T20.25F: C selected (API-only preview enabled); E rejected (production default).
T20.26A–E complete. Opt-in hybrid preview UI design batch: CLOSED.
T20.26C-LIVE: PASS — 270/270 HTTP 200 (UI-readiness smoke), 0% fallback.
T20.26D: B selected (KEEP API runtime, no UI); C recommended (T20.27A).
T20.27A–H complete. Opt-in hybrid preview UI implementation batch: CLOSED.
T20.27E-LIVE: PASS — 270/270 HTTP 200, 0% fallback, hybrid p95 116 ms.
T20.27G: C selected (KEEP opt-in preview UI); D recommended (T20.28A).
T20.28A–H complete. Post-UI soak batch: CLOSED.
T20.28C-LIVE: PASS — 1080/1080 HTTP 200 (4 windows), 0% fallback, hybrid p95 255 ms.
T20.28F: C selected (KEEP opt-in preview UI); D recommended (T20.29A).
T20.29A–H complete. Participant-limited soak batch: CLOSED.
T20.29C-LIVE: PASS — 2160/2160 HTTP 200 (12 participants, 4 windows), 0% fallback, hybrid p95 176 ms.
T20.29F: C selected (KEEP opt-in preview UI); D recommended (T20.30A).
T20.30A–H complete. Expanded participant soak batch: CLOSED.
T20.30C-LIVE: PASS — 3240/3240 HTTP 200 (12 participants, 6 windows), 0% fallback, hybrid p95 193 ms.
T20.30F: C selected (KEEP opt-in preview UI); D recommended (T20.31A).
T20.31A–H complete. Sustained multi-window soak batch: CLOSED.
T20.31C-LIVE: PASS — 6480/6480 HTTP 200 (12 participants, 12 windows), 0% fallback, hybrid p95 253 ms.
T20.31F: C selected (KEEP opt-in preview UI); D recommended (T20.32A).
T20.32A–H complete. Broader readiness soak batch: CLOSED.
T20.32C-LIVE: PASS — 8640/8640 HTTP 200 (12 participants, 16 windows), 0% fallback, hybrid p95 180 ms.
T20.32F: C selected (KEEP opt-in preview UI); D recommended (T20.33A).
T20.33A–H complete. Real-participant readiness batch: CLOSED/BLOCKED.
T20.33C-LIVE: BLOCKED — missing owner-approved participant artifact (`T20-33-owner-approved-real-preview-participants.md` absent; 0 real_owner_approved).
T20.33F: C selected (KEEP preview UI/API); real-participant eval blocked; D recommends participant artifact collection.
T20.34A–H complete. Owner-approved participant soak batch: CLOSED/BLOCKED.
T20.34C-LIVE: BLOCKED — missing/incomplete artifact (`T20-34-owner-approved-real-preview-participants.md` absent; 0 real_owner_approved).
T20.34F: C selected (KEEP preview UI/API); owner-approved soak blocked; D recommends artifact collection.
T20.35A–H complete. Real-participant soak batch: CLOSED/BLOCKED.
T20.35C-LIVE: BLOCKED — artifact committed but incomplete (`T20-35-owner-approved-real-preview-participants.md`; 0/3 complete real_owner_approved rows; TBD email/UUID/consent/signature).
T20.35F: C selected (KEEP preview UI/API); real-participant soak blocked; D recommends completing artifact rows.
T20.35B-REBLOCKED (2026-07-03): re-audit confirms artifact unchanged — still 0/3 complete rows; C-LIVE NOT RUN; staging cohort NOT used.
T20.35 scope approval recorded @ d650971; participant rows still incomplete (0/3).
T20.36A complete. Real-participant expansion readiness design only — no live eval.
T20.36B complete. Artifact validator PASS — 3 complete participants (1× real_owner_approved, 2× internal_staff).
T20.36A–H complete. Real-participant soak batch: CLOSED PASS.
T20.36C-LIVE: PASS — 1440/1440 HTTP 200 (3 artifact participants + contract control, 8 windows), 0% fallback, hybrid p95 160 ms, avg quality 4.0.
T20.36F: C selected (KEEP preview UI/API); D recommends T20.37A extension; E rejected.
Combined live evidence (D16→D32C + T20.36C): 26145/26145 HTTP 200, 0% fallback.
Hybrid allowlist canary: KEEP.
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f (contract user only).
AI_RAG_HYBRID_CANARY_PERCENT=0.
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0.
Production default: keyword.
Vector production default: NOT APPROVED.
Hybrid production default: NOT APPROVED.
API-only opt-in preview: ENABLED (runtime).
Opt-in preview UI: ENABLED on /insights.
Webapp image: webapp:t20-p227b.
Preview enrollments: revoked after eval (safe default).
T20.35A–H CLOSED/BLOCKED: real-participant soak blocked due to incomplete participant artifact (template committed; ≥3 complete rows required for C-LIVE).
T20.35B-REBLOCKED: artifact re-audit 0/3 — do not re-audit unless artifact rows change.
T20.36A: COMPLETE — expansion/readiness design only.
T20.36B: COMPLETE — validator PASS 3/3.
T20.36A–H CLOSED PASS: first real-participant soak 1440/1440; cumulative 26145/26145.
T20.37A complete. Real-participant extension design only — 2880-case matrix (16 windows).
T20.37A–H complete. Real-participant extension batch: CLOSED PASS.
T20.37C-LIVE: PASS — 2880/2880 HTTP 200 (3 artifact participants + contract control, 16 windows), 0% fallback, hybrid p95 184 ms, avg quality 4.0.
T20.37F: C selected (KEEP preview UI/API); D recommends T20.38A broader readiness; E rejected.
T20.38A–H complete. Broader real-participant depth batch: CLOSED PASS.
T20.38C-LIVE: PASS — 4320/4320 HTTP 200 (3 artifact participants + contract control, 24 windows), 0% fallback, hybrid p95 151 ms, avg quality 4.0.
T20.38F: C selected (KEEP preview UI/API); D recommends T20.39A expansion design; E rejected.
Combined live evidence (D16→T20.38C): 33345/33345 HTTP 200, 0% fallback.
T20.39A complete. Broader real-participant expansion design only — no live eval.
T20.39B complete. Validator BLOCKED — current artifact remains N=3; no two additional valid owner-approved/internal-staff participants found.
T20.39B2 complete. Real-participant artifact intake tooling added; artifact remains N=3 until owner-provided JSON is appended and validated.
T20.39B3 complete. Two owner-approved internal_staff preview participants provisioned; artifact is now N=5 (`1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`); 5/5 JWT-sub audit PASS.
T20.39B RERUN complete. N=5 validator PASS; preflight PASS; telemetry WARNs 0; preview UI smoke 4/4 PASS.
T20.39C-LIVE: PASS — 4320/4320 HTTP 200 (5 artifact participants + contract control, 16 windows), 0% fallback, hybrid p95 131.99 ms, avg quality 4.0, Playwright C-suite 7/7, OCH PASS, WARNs 0.
T20.39D complete. Rollback drill PASS — UI/API enroll→revoke, bulk revoke all 5, CANARY=0 drill, KEEP restore verified.
T20.39E complete. Telemetry audit PASS — OCH PASS, telemetry WARNs 0, Playwright C-suite 7/7.
T20.39F complete. Decision C selected: KEEP broader real-participant opt-in preview UI/API, PERCENT=0; D recommended; E rejected.
T20.39G complete. Broader real-participant N=5 batch CLOSED PASS; next approval phrase: "Approved: start T20.40A broader real-participant opt-in hybrid preview readiness decision design only".
T20.39A–G CLOSED PASS: N=5 real/internal participant soak PASS 4320/4320; cumulative 37665/37665.
T20.40A COMPLETE: broader real-participant readiness decision design only.
T20.40B COMPLETE: N=5 real-participant depth validator audit PASS.
T20.40C-LIVE PASS: N=5 24-window depth eval 6480/6480, 0% fallback.
T20.40D PASS: rollback + CANARY=0 + KEEP restore.
T20.40E/F COMPLETE: telemetry audit PASS; decision C KEEP selected.
T20.40G CLOSED PASS.
Cumulative live: 44145/44145 HTTP 200, 0% fallback.
T20.40A–G CLOSED PASS: N=5 24-window real-participant depth eval 6480/6480; cumulative 44145/44145.
T20.41A COMPLETE: N5 opt-in hybrid preview production-readiness decision design only.
T20.41B COMPLETE: N5 production-readiness validator audit PASS.
T20.41C-LIVE PASS: N=5 32-window production-readiness depth eval 8640/8640, 0% fallback, hybrid p95 140.4 ms.
T20.41D PASS: rollback + CANARY=0 + KEEP restore.
T20.41E/F COMPLETE: telemetry audit PASS; decision C KEEP selected.
T20.41G CLOSED PASS.
Cumulative live: 52785/52785 HTTP 200, 0% fallback.
T20.41A–G CLOSED PASS: N=5 32-window production-readiness depth eval 8640/8640; cumulative 52785/52785.
T20.42A COMPLETE: N5 opt-in hybrid preview production-readiness closeout design only.
T20.42B COMPLETE: N5 production-readiness closeout validator PASS.
T20.42C-LIVE PASS: N=5 16-window final verification 4320/4320, 0% fallback, hybrid p95 124.37 ms.
T20.42D PASS: final rollback + CANARY=0 + KEEP restore.
T20.42E/F COMPLETE: final telemetry audit PASS; decision C KEEP selected.
T20.42G CLOSED PASS.
T20.42A–G CLOSED PASS: N5 opt-in hybrid preview production-readiness final verification PASS.
T20.42C-LIVE: PASS 4320/4320.
Cumulative live: 57105/57105 HTTP 200, 0% fallback.
Cumulative live matrix: 57105/57105 HTTP 200, 0% fallback.
Protocol note: cumulative matrix evidence came from the existing HTTP/1.1 live runner stack. Separate read-only transport smoke confirms the contract allowlist RAG path over HTTP/1.1, HTTP/2, and HTTP/3; those smoke calls are not added to the cumulative matrix total.
Production default: keyword.
Preview UI/API: KEEP.
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0.
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0.
Hybrid/vector production default: NOT APPROVED.
Phase 22: CLOSED PASS — full labeled protocol parity complete; archived.
H1/H2/H3 each have 57105/57105 labeled evidence.
Phase 22C 7200/7200 remains sample-only.
No further live matrix required unless separately approved.
Phase 23A COMPLETE: context-continuity and long-run replay operations design only; no live eval; no runtime changes.
Phase 23B COMPLETE: context/archive verifier hardening and evidence-label CI guard; no live eval; no runtime changes.
Phase 23C PASS: dry-run resume/checkpoint validation only; no live eval; no runtime changes.
Phase 23D PASS: CI/Makefile guard integration; no live eval; no runtime changes.
Phase 23: CLOSED PASS.
Phase 24A COMPLETE: KPI observability implementation design only; no live eval; no runtime changes.
Phase 24B PASS: read-only KPI extractor scripts; no live eval; no runtime changes.
Phase 24C PASS: KPI guard tests and Makefile target; no live eval; no runtime changes.
Phase 24D PASS: Phase 24 KPI observability closeout; no live eval; no runtime changes.
Phase 24: CLOSED PASS.
Phase 24 live work: NOT APPROVED.
Phase 25A COMPLETE: observability instrumentation architecture design; no runtime changes.
Phase 25B COMPLETE: KPI event and schema contract proposal; no migrations applied.
Phase 25C COMPLETE: KPI extractor and dashboard contract design.
Phase 25D COMPLETE: observability implementation rollout plan (Phase 26A–26G).
Phase 25E PASS: design guard script and unit tests (read-only).
Phase 25F PASS: Phase 25 observability instrumentation design closeout.
Phase 25: CLOSED PASS.
Phase 25 live work: NOT RUN.
Phase 26A PASS: KPI observability schema migration SQL + default-off AI_KPI_* flags + no-op write guards.
Phase 26A live DB migration: NOT APPLIED.
Phase 26B PASS: ingestion KPI event write path + redacted payload builder + per-source_type extractor.
Phase 26B runtime writes default enabled: NO.
Phase 26C PASS: searchability verification probe write path + data_to_searchable_ms extractor.
Phase 26C local/dev schema applied: YES (python_ai @ 127.0.0.1:5440).
Phase 26C runtime writes default enabled: NO.
Phase 26D: NOT STARTED.
KPI gaps — searchability write path in 26C; remaining in 26D–26E: H1 full-matrix latency (26D), usefulness time-series (26E).
Next work: Phase 26D query observation instrumentation only after explicit approval — no live eval, no production default, no PERCENT rollout.
Phase 22 CLOSED PASS — full labeled protocol parity.
H1 baseline: 57105/57105 HTTP/1.1.
H2 replay: 57105/57105 HTTP/2 PASS.
H3 replay: 57105/57105 HTTP/3 PASS.
Phase 22C: 7200/7200 sample only.
Phase 21 H1 baseline: 57105/57105 HTTP/1.1 (historical, not re-run).
Phase 22I H2 replay: 57105/57105 HTTP/2 explicit — PASS.
Phase 22J H3 replay: 57105/57105 HTTP/3 explicit — PASS.
Production default: keyword. PERCENT=0. ALLOW_PROD_PERCENT=0.
Permanent allowlist: contract user only.
Combined live evidence (D16→T20.42C): 57105/57105 HTTP 200, 0% fallback.
```

### T20 hybrid canary (implemented)

| Item | Value |
| ---- | ----- |
| Image | `python-ai-service:t20-p225b` |
| Webapp image | `webapp:t20-p227b` |
| Allowlisted user | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` (contract only) |
| API-only preview | `GET/POST /api/ai/rag/preview/{status,enroll,revoke}` |
| Combined live (D16→T20.42C) | **57105/57105** HTTP 200, **0%** fallback |
| Artifact validator | `scripts/audit-real-participant-artifact.sh` |
| Pure overlap | **8/16** (report-only) |
| Anchored overlap | **16/16** |
| Avg quality (C18-LIVE) | **4.0** |

### T20.14H hybrid gate (2026-06-29)

| Lane | Result |
| ---- | ------ |
| A — Pure vector overlap | **8/16 FAIL** (stable across 5 H1 runs) |
| B — Hybrid anchored overlap | **16/16 PASS** |
| C — Keyword production | **PASS** (default) |

Deploy: `python-ai-service:t20-p215b2` @ `cd12a85`.

### Copilot-safe instruction

```md
Use @docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md as the source of truth for Phase 21.

Do NOT enable vector retrieval as production default.
Do NOT enable hybrid retrieval as production default.
Do NOT set AI_RAG_HYBRID_CANARY_PERCENT above 0 without explicit owner approval for a scoped eval window.
Do NOT broaden permanent allowlist without explicit approval and restore plan.
Do NOT start T20.39C-LIVE unless T20.39B validator re-run passes against the N=5 artifact.
Do NOT broaden permanent allowlist or count contract/staging/test users as real/internal participants.
Do NOT re-run T20.38C-LIVE or T20.38B audit unless artifact rows change or an explicit depth-extension approval is given.
Use `scripts/audit-real-participant-artifact.sh` for participant gate automation.
Do NOT create duplicate REBLOCKED docs for unchanged artifact.
Do NOT run owner-approved participant live eval without complete `T20-35-owner-approved-real-preview-participants.md` (≥3 real_owner_approved or owner-approved internal_staff with email, UUID, consent, signature).
Do NOT relabel staging/JWT cohort accounts as real participants.
Do NOT implement rollout without owner/product sign-off.
Pure vector overlap: report-only per T20.16C — do not promote vector default (8/16).
Do NOT enable vector production default.
Do NOT use generative Ollama as production RAG default.
Do NOT expose message bodies in UI or API responses.

Phase 21 product track is CLOSED and tagged. P21.10+ product follow-ups require explicit approval (keyword/rule-engine only).
T20.16A–F CLOSED: D-LIVE PASS; E selects B+C.
T20.17A–E CLOSED: C-LIVE PASS 90/90; D selects B+D.
T20.18A–E CLOSED: C-LIVE PASS 270/270 (6 users); D selects B+D.
T20.19A–E CLOSED: C-LIVE PASS 810/810 (3 windows); combined live 1215/1215; D selects B+D; single contract allowlist; percent=0; image t20-p216b; production keyword; vector NOT APPROVED.
T20.20A–E CLOSED: C-LIVE PASS 540/540 (2 windows); combined live 1755/1755; D selects B+D; single contract allowlist; percent=0; image t20-p216b; production keyword; vector NOT APPROVED.
T20.21A–D CLOSED: B-LIVE PASS 270/270; combined live 2025/2025; C selects B, rejects E; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED.
T20.22A–D CLOSED: rollout design batch; B audit PASS; C selects B, rejects D; rollout NOT APPROVED; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED; T20.23A NOT STARTED.
T20.23A–D CLOSED: opt-in preview design batch; B audit PASS; C selects B, rejects D+E; preview NOT APPROVED; single contract allowlist; percent=0; image t20-p216b; production keyword; vector/hybrid default NOT APPROVED; T20.24A NOT STARTED.
T20.24A–D CLOSED: implementation design batch; B audit PASS; C selects B, rejects D+E; implementation NOT APPROVED at design stage; sign-off required for T20.25.
T20.25A–G CLOSED: sign-off verified; API-only preview implemented; D-LIVE PASS 540/540; F selects C; combined live 2565/2565; image t20-p225b.
T20.26A–E CLOSED: UI design only; B runtime audit PASS; C-LIVE PASS 270/270; D selects B recommends C; UI NOT APPROVED at close.
T20.27A–H CLOSED: UI on /insights; E-LIVE PASS 270/270; G selects C recommends D; webapp t20-p227b; python t20-p225b.
T20.28A–H CLOSED: post-UI soak PASS 1080/1080; F selects C recommends D; combined live 4185/4185.
T20.29A–H CLOSED: participant soak PASS 2160/2160 (12 JWT); F selects C recommends D; combined live 6345/6345.
T20.30A–H CLOSED: expanded soak PASS 3240/3240; cumulative 9585/9585.
T20.31A–H CLOSED: sustained soak PASS 6480/6480; cumulative 16065/16065.
T20.32A–H CLOSED: broader readiness soak PASS 8640/8640; cumulative 24705/24705.
T20.33A–H CLOSED/BLOCKED: real-participant readiness blocked due to missing owner-approved participant artifacts.
T20.34A–H CLOSED/BLOCKED: owner-approved participant soak blocked due to missing/incomplete participant artifact.
T20.35A–H CLOSED/BLOCKED: real-participant soak blocked due to incomplete participant artifact (0/3 complete rows).
T20.35B-REBLOCKED: re-audit 2026-07-03 — still 0/3; C-LIVE not run; scope approval @ d650971.
T20.36A COMPLETE: expansion/readiness design only.
T20.36B COMPLETE: artifact validator PASS 3/3.
T20.36A–H CLOSED PASS: real-participant soak 1440/1440; cumulative 26145/26145.
T20.37A–H CLOSED PASS: extension soak 2880/2880; cumulative 29025/29025.
T20.38A–H CLOSED PASS: Option B depth soak 4320/4320; cumulative 33345/33345.
T20.39A COMPLETE: broader real-participant expansion design only; current validated N=3.
T20.39B COMPLETE/BLOCKED: current artifact still N=3; no two additional valid participants found; preflight/UI smoke PASS.
T20.39B2 COMPLETE: intake tooling added for owner-provided rows; artifact unchanged until JSON is supplied.
T20.39B3 COMPLETE: two owner-approved internal_staff preview participants provisioned; artifact N=5; 5/5 JWT-sub audit PASS.
T20.39B RERUN PASS: N=5 artifact validator, preflight, telemetry, and preview UI smoke PASS.
T20.39C-LIVE PASS: N=5 matrix 4320/4320; cumulative 37665/37665; fallback 0%; post-revoke keyword_default PASS for all 5.
T20.39D ROLLBACK PASS: UI/API enroll-revoke, bulk revoke, CANARY=0, and KEEP restore verified.
T20.39E TELEMETRY PASS: OCH PASS, WARNs 0, C-suite 7/7.
T20.39F DECISION: C KEEP selected; D recommended; E production default rejected.
T20.39G CLOSED PASS: T20.39 complete; next T20.40A design-only approval required.
T20.39A–G CLOSED PASS: N=5 real/internal participant soak PASS 4320/4320; cumulative 37665/37665.
T20.40A COMPLETE: broader real-participant readiness decision design only.
T20.40B COMPLETE: N=5 real-participant depth validator audit PASS.
T20.40C-LIVE PASS: N=5 24-window depth eval 6480/6480, 0% fallback.
T20.40D PASS: rollback + CANARY=0 + KEEP restore.
T20.40E/F COMPLETE: telemetry audit PASS; decision C KEEP selected.
T20.40G CLOSED PASS.
Cumulative live: 44145/44145 HTTP 200, 0% fallback.
T20.40A–G CLOSED PASS: N=5 24-window real-participant depth eval 6480/6480; cumulative 44145/44145.
T20.41A COMPLETE: N5 opt-in hybrid preview production-readiness decision design only.
T20.41B COMPLETE: N5 production-readiness validator audit PASS.
T20.41C-LIVE PASS: N=5 32-window production-readiness depth eval 8640/8640, 0% fallback.
T20.41D PASS: rollback + CANARY=0 + KEEP restore.
T20.41E/F COMPLETE: telemetry audit PASS; decision C KEEP selected.
T20.41G CLOSED PASS.
Cumulative live: 52785/52785 HTTP 200, 0% fallback.
T20.41A–G CLOSED PASS: N=5 32-window production-readiness depth eval 8640/8640; cumulative 52785/52785.
T20.42A COMPLETE: N5 opt-in hybrid preview production-readiness closeout design only.
T20.42B COMPLETE: N5 production-readiness closeout validator PASS.
T20.42C-LIVE PASS: N=5 16-window final verification 4320/4320, 0% fallback.
T20.42D PASS: final rollback + CANARY=0 + KEEP restore.
T20.42E/F COMPLETE: final telemetry audit PASS; decision C KEEP selected.
T20.42G CLOSED PASS.
T20.42A–G CLOSED PASS: N5 opt-in hybrid preview production-readiness final verification PASS.
Cumulative live: 57105/57105 HTTP 200, 0% fallback.
Production default: keyword.
Preview UI/API: KEEP.
PERCENT=0.
ALLOW_PROD_PERCENT=0.
Hybrid/vector production default: NOT APPROVED.
Permanent allowlist: contract user only.
API-only opt-in preview runtime: KEEP.
Opt-in preview UI: KEEP.
Production default: keyword.
Vector production default: NOT APPROVED.
Hybrid production default: NOT APPROVED.
AI_RAG_HYBRID_CANARY_PERCENT=0.
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0.
T20.42C-LIVE: PASS 4320/4320.
```

---

## Production path (unchanged)

| Setting | Value |
| ------- | ----- |
| Retrieval | `keyword` |
| Synthesis | `rule-engine` |
| Vector default | off |
| `AI_RAG_SHADOW_VECTOR` | 0 |
| Generative Ollama for RAG | off |
| Overlap refinement flags | default off |

---

## Structured endpoints (python-ai-service)

Gateway prefix: `/api/ai/` (webapp proxies to python-ai-service `/ai/`).

### Seller intelligence (Phase 21 product)

| Endpoint | Contract ID | Purpose |
| -------- | ----------- | ------- |
| `POST /seller/listing-advice` | `listing_advice` | Catalog health, weak listings, revisions |
| `POST /seller/negotiation-strategy` | `negotiation_strategy` | OBO offer summaries only |
| `POST /seller/auction-pressure` | `auction_pressure` | Bid-summary urgency signals |
| `POST /seller/collector-metadata-gaps` | `collector_metadata_gaps` | 22-field metadata + completeness |

### Session memory (API prototype — P21.3)

| Endpoint | Contract ID |
| -------- | ----------- |
| `POST /session/start` | `session_start` |
| `POST /session/query` | `session_query` |
| `GET /session/{session_id}` | `session_get` |
| `POST /session/reset` | `session_reset` |

In-memory only; TTL; no DB persistence; not multi-pod safe.

### Other structured endpoints (pre–Phase 21, still live)

| Endpoint | Contract ID |
| -------- | ----------- |
| `POST /rag/query` | `rag_query` |
| `POST /records/valuation` | `record_valuation` |
| `POST /listings/pricing-advice` | `pricing_recommendation` |
| `POST /auctions/risk` | `auction_risk` |
| `POST /seller/summary` | `seller_sales_summary` |
| `POST /buyer/collection-summary` | `buyer_collection_summary` |

---

## UI surfaces (webapp)

| Surface | Route / test ID | Notes |
| ------- | ----------------- | ----- |
| AI Insights dashboard | `/insights` | `ai-insights-dashboard` |
| Seller intelligence section | above RAG card | `seller-intelligence-panel` |
| Listing advice panel | — | `seller-listing-advice-card` |
| Negotiation strategy panel | — | `seller-negotiation-strategy-card` |
| Auction pressure panel | — | `seller-auction-pressure-card` |
| Collector metadata panel | field map UI | `seller-collector-metadata-card` |
| RAG query card | deferred prefetch | `ai-insight-rag`, `ai-rag-summary` |
| Source evidence | expand/collapse | `ai-source-evidence-item`, `ai-source-evidence-toggle` |
| Seller dashboard ready | sr-only signal | `seller-dashboard-ready` |

Session memory has **no** dedicated `/insights` chat UI in Phase 21.

Key files:

- `webapp/components/ai/seller-intelligence-panels.tsx`
- `webapp/components/ai/ai-insights-dashboard.tsx`
- `webapp/components/ai/ai-source-evidence-list.tsx`
- `webapp/components/ai/collector-metadata-field-map.tsx`
- `webapp/lib/ai-insights-client.ts`

---

## Validation metrics (P21.7B final @ `13bc0ad`)

| Metric | Value | Gate |
| ------ | ----: | ---- |
| Seller panels | 4/4 | PASS |
| seller_dashboard_ready_ms | 12,307 | ≤15,000 PASS |
| ui_latency_p95_ms | 11,247 | ≤15,000 PASS |
| endpoint_latency_p95_ms | 11,015 | ≤12,000 PASS |
| record_intelligence_avg_score | 3.86 | ≥3.5 PASS |
| longform_avg_score | 3.67 | ≥3.5 PASS |
| final_turn_score | 4.0 | ≥4.0 PASS |
| leakage | PASS | PASS |
| telemetry WARNs | 0 | PASS |
| pytest | 222 passed | PASS |
| forbidden_hit_count | 0 | PASS |
| source_refs_present_rate | 1.00 | PASS |
| source_excerpt_present_rate | 1.00 | PASS |

Re-validate:

```bash
./scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-record-intelligence.spec.ts --grep "AI record intelligence UI acceptance"
./scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"
node scripts/ai-quality-telemetry-report.mjs
cd services/python-ai-service && source .venv/bin/activate && PYTHONPATH=. python -m pytest tests/ -q
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Telemetry reporter: `scripts/ai-quality-telemetry-report.mjs`  
Design: `docs/ai-platform/P21-5A-ai-quality-telemetry-design.md`

---

## Hard stops (all future work)

| Rule | Status |
| ---- | ------ |
| No vector default rollout | **BLOCKED** |
| No hybrid rollout (production) | **BLOCKED** |
| T20.15 execution (percentage ladder) | **CLOSED** (T20.15A–AG; percent=0 restored after each eval) |
| T20.15G 1% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15H decision | **COMPLETE** — Option B active; Option C recommended |
| T20.15J 5% gate verify | **COMPLETE** (verification-only) |
| T20.15K 5% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15L 5% decision | **COMPLETE** — Option B active; Option C → M |
| T20.15M 10% design | **COMPLETE** (design only) |
| T20.15N 10% gate verify | **COMPLETE** (verification-only) |
| T20.15O 10% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15P 10% decision | **COMPLETE** — Option B active; Option C → Q |
| T20.15Q 25% design | **COMPLETE** (design only) |
| T20.15R 25% gate verify | **COMPLETE** (verification-only) |
| T20.15S 25% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15T 25% decision | **COMPLETE** — Option B active; Option C → U |
| T20.15U 50% design | **COMPLETE** (design only) |
| T20.15V 50% gate verify | **COMPLETE** (verification-only) |
| T20.15W 50% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15X 50% decision | **COMPLETE** — Option B active; Option C → Y |
| T20.15Y 75% design | **COMPLETE** (design only) |
| T20.15Z 75% gate verify | **COMPLETE** (verification-only) |
| T20.15AA 75% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15AB 75% decision | **COMPLETE** — Option B active; Option C → AC |
| T20.15AC 100% design | **COMPLETE** (design only) |
| T20.15AD 100% gate verify | **COMPLETE** (verification-only) |
| T20.15AE 100% eval | **COMPLETE** (PASS; percent=0 restored) |
| T20.15AF 100% decision | **COMPLETE** — Option B active; Option C → AG |
| T20.15AG ladder closeout | **COMPLETE** |
| T20.16A production-readiness design | **COMPLETE** (design only) |
| T20.16B final_tagged_plan fix | **COMPLETE** (`t20-p216b`) |
| T20.16C pure vector research | **COMPLETE** (8/16 report-only) |
| T20.16D–F production-readiness batch | **COMPLETE** (D-LIVE PASS) |
| T20.17A scoped soak design | **COMPLETE** (design only) |
| T20.17B soak preflight | **COMPLETE** (controls PASS) |
| T20.17C-LIVE scoped soak eval | **COMPLETE** (PASS; 90/90) |
| T20.17D soak decision | **COMPLETE** — Option B active; Option C → T20.18A |
| T20.17E soak closeout | **COMPLETE** |
| T20.18A broader soak design | **COMPLETE** (design only) |
| T20.18B broader soak preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.18C-LIVE broader soak eval | **COMPLETE** (PASS; 270/270, 6 users) |
| T20.18D broader soak decision | **COMPLETE** — Option B active; Option D → T20.19A |
| T20.18E broader soak closeout | **COMPLETE** |
| T20.19A extended soak design | **COMPLETE** (design only) |
| T20.19B extended soak preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.19C-LIVE extended soak eval | **COMPLETE** (PASS; 810/810, 3 windows) |
| T20.19D extended soak decision | **COMPLETE** — Option B active; Option D → T20.20A |
| T20.19E extended soak closeout | **COMPLETE** |
| T20.20A production-decision design | **COMPLETE** (design only) |
| T20.20B production-decision preflight | **COMPLETE** (6/6 JWT; controls PASS) |
| T20.20C-LIVE production-decision verification | **COMPLETE** (PASS; 540/540, 2 windows) |
| T20.20D production-decision package | **COMPLETE** — Option B active; Option D → T20.21A |
| T20.20E production-decision closeout | **COMPLETE** |
| T20.21A hybrid default RFC design | **COMPLETE** (design only) |
| T20.21B RFC live confirmation | **COMPLETE** (PASS; 270/270) |
| T20.21C RFC owner sign-off decision | **COMPLETE** — Option B active; Option E rejected |
| T20.21D RFC closeout | **COMPLETE** |
| Hybrid allowlist canary | **KEEP** (`t20-p216b`, **single** contract user allowlist) |
| T20.22A production-rollout design | **COMPLETE** (design only) |
| T20.22B rollout evidence audit | **COMPLETE** (PASS; no new live inference) |
| T20.22C rollout decision package | **COMPLETE** — Option B active; Option D rejected; rollout NOT APPROVED |
| T20.22D rollout closeout | **COMPLETE** |
| T20.23A opt-in hybrid preview design | **COMPLETE** (design only) |
| T20.23B preview sign-off audit | **COMPLETE** (PASS; no new live inference) |
| T20.23C preview decision package | **COMPLETE** — Option B active; Options D and E rejected; preview NOT APPROVED |
| T20.23D preview closeout | **COMPLETE** |
| T20.24A opt-in preview implementation design | **COMPLETE** (design only) |
| T20.24B implementation sign-off audit | **COMPLETE** (PASS; no new live inference) |
| T20.24C implementation decision package | **COMPLETE** — Option B active; Options D and E rejected; implementation NOT APPROVED |
| T20.24D implementation closeout | **COMPLETE** |
| T20.25A opt-in preview implementation | **NOT STARTED** — requires approval phrase + owner sign-off artifact |
| No embedding tranches without separate approval | **BLOCKED** |
| No default-on overlap flags | **BLOCKED** |
| No generative Ollama as production RAG default | **BLOCKED** |
| No message body exposure | **REQUIRED** |
| Do not commit `bench_logs/`, screenshots, traces | **REQUIRED** |

---

## Known limitations

- Session memory in-process only
- Four seller panels = four independent keyword retrievals
- Collector field map not on free-form RAG card
- Sparse corpus → excerpt unavailable fallback
- Vector pure overlap 8/16 — hybrid anchors required for 16/16 (shadow diagnostics only)

---

## Phase 21 ticket map (all closed)

| Ticket | Doc |
| ------ | --- |
| P21.0 | `P21-0-non-vector-seller-intelligence-charter.md` |
| P21.1 | `P21-1A-seller-intelligence-ui-surfaces.md`, `P21-1B-seller-intelligence-ui-acceptance.md` |
| P21.2 | `P21-2A-source-evidence-ux.md`, `P21-2B-source-evidence-ux-acceptance.md` |
| P21.3 | `P21-3B-session-memory-prototype-acceptance.md`, `P21-3C-session-endpoint-hardening.md` |
| P21.4 | `P21-4B-collector-metadata-acceptance.md`, `P21-4C-collector-metadata-fieldmap-ui.md` |
| P21.5 | `P21-5A-ai-quality-telemetry-design.md`, `P21-5B-ai-quality-telemetry-acceptance.md` |
| P21.6 | `P21-6A-non-vector-latency-triage.md`, `P21-6B-non-vector-latency-acceptance.md` |
| P21.7 | `P21-7A-non-vector-seller-intelligence-rc.md`, `P21-7B-non-vector-seller-intelligence-final-validation.md` |
| P21.8 | `P21-8-release-closeout.md` (this closeout) |

Release note: `docs/release/rp-ai-phase-21-non-vector-seller-intelligence.md`

---

## Post-release roadmap (two lanes)

| Lane | Doc | Status |
| ---- | --- | ------ |
| **Product** (optional) | `P21-10-post-release-product-roadmap.md` | P21.10+ require approval; keyword/rule-engine only |
| **Vector** (blocker burn-down) | `T20-14H0` … `T20-21D` | H0–H2 complete; T20.15–T20.21 batches CLOSED |

Product work may continue on keyword/rule-engine. **No product ticket may silently enable vector.**

---

## Next optional tracks (require explicit approval)

| Track | Scope |
| ----- | ----- |
| **P21.10** | Batch seller endpoint design — reduce four parallel retrievals |
| **P21.11** | Persistent session memory design — Redis/DB, multi-pod |
| **P21.12** | Observation-deck integration — feed telemetry JSON into `/observation-deck` |
| **P21.13** | Seller intelligence polish |
| **P21.14** | Dedicated session-memory UI |
| **T20.25A** | Opt-in hybrid preview **implementation** (code/env) | **NOT STARTED** — requires approval phrase + owner sign-off artifact |

Do not start T20.25A without: `Approved: start T20.25A opt-in hybrid preview implementation only after sign-off`. Vector and hybrid production defaults remain **NOT APPROVED**. Default rollout and opt-in preview implementation remain **NOT APPROVED**.

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: RELEASE TAGGED
Vector production default: NOT APPROVED
Production default: keyword
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST: 2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT: 0
Image: python-ai-service:t20-p216b
Combined live (D16→D21B): 2025/2025 HTTP 200, 0% fallback
T20.15A–AG: CLOSED (hybrid canary ladder)
T20.16A–F: CLOSED (production-readiness batch)
T20.17A–E: CLOSED (scoped soak; 90/90)
T20.18A–E: CLOSED (broader multi-user soak; 270/270)
T20.19A–E: CLOSED (extended 3-window soak; 810/810)
T20.20A–E: CLOSED (production-decision verification; 540/540)
T20.21A–D: CLOSED (RFC live confirmation; 270/270; default switch REJECTED)
T20.22A–D: CLOSED (rollout design batch; rollout NOT APPROVED)
T20.23A–D: CLOSED (opt-in preview design batch; preview NOT APPROVED)
T20.24A–D: CLOSED (implementation design batch; implementation NOT APPROVED)
T20.25A: NOT STARTED
```
