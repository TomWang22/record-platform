# Phase 23A — context continuity and long-run replay operations design

**Phase 23A:** COMPLETE — design only  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Created:** 2026-07-06  
**Audience:** Cursor, GitHub Copilot, and other coding agents

---

## 1. Executive verdict

Phase 23A closes the **context-continuity gap** exposed after Phase 22 archive handoff. Agents were treating `HEAD: 5588779` in `ACTIVE_CONTEXT.md` as the live repo tip; that value is the **Phase 22 archive HEAD**, not the current repo tip.

Phase 23A defines:

- Unambiguous **current repo tip** (computed live) vs **phase handoff lineage** vs **frozen archive heads**
- A **source-of-truth hierarchy** (verifiers first, chat memory never)
- **Evidence label rules** so 57105 full parity, 7200 sample, and 15-probe smoke are never conflated
- **Long-run replay resume** and **bench-log handling** rules for future approved live work
- A **Phase 23 workstream table** through closeout (23A–23D)

No live inference, smoke matrices, or runtime changes were performed in Phase 23A.

---

## 2. Source-of-truth hierarchy

Use this exact order:

```text
1. scripts/verify-phase-21-archive-readonly.sh
2. scripts/verify-phase22-full-protocol-parity-archive-readonly.sh
3. docs/ai-platform/ACTIVE_CONTEXT.md
4. docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md
5. docs/ai-platform/PHASE_22_REAL_INFERENCE_TRANSPORT_READINESS_PLAN.md
6. Local bench logs only for audit/debug, never as committed source of truth
7. Chat memory is never source of truth
```

Before any future AI-platform work, run both archive verifiers (or `make ai-platform-verify-archive`) and read `ACTIVE_CONTEXT.md` plus the Phase 22 archive doc.

---

## 3. Active context format

`docs/ai-platform/ACTIVE_CONTEXT.md` is the compact agent entrypoint. Required fields:

```text
Current repo tip:
- Always compute live with `git rev-parse --short HEAD`.
- Do not store current repo tip as source of truth in ACTIVE_CONTEXT.md.

Phase handoff lineage:
- Store historical handoff commits by phase.
- These commits may be older than the current repo tip.

Frozen archive heads:
- Store immutable archive commits.
- Verifiers must check that archive commits exist and archive docs contain locked evidence.
```

Do not require ACTIVE_CONTEXT.md to equal the current git tip. That creates endless metadata drift after every sync commit.

**Semantics:**

| Field | Meaning | Updates when |
| ----- | ------- | ------------ |
| Current repo tip | Live `git rev-parse --short HEAD` | Never stored in ACTIVE_CONTEXT.md |
| Phase handoff lineage | Historical commits that explain how context evolved | Append on each approved handoff commit |
| Phase 22 archive HEAD | Commit that archived full labeled protocol parity | Frozen at `5588779` |
| Phase 21 archive checkpoint | Phase 21 archive closeout commit | Frozen at `328161d` |
| Phase 21 pre-archive validation HEAD | Last Phase 21 validation before archive | Frozen at `bd76875` |

Do **not** use the banned label `Current handoff HEAD:`. Do **not** infer counts or production state from chat memory.

---

## 4. Evidence label rules

Document and preserve these exact rules in all summaries, commits, and agent responses:

```text
H1 baseline 57105/57105 = Phase 21 HTTP/1.1 historical matrix.
H2 replay 57105/57105 = Phase 22I HTTP/2 full replay.
H3 replay 57105/57105 = Phase 22J HTTP/3 full replay.
171315/171315 = labeled H1+H2+H3 sum only; never an unlabeled cumulative matrix.
Phase 22C 7200/7200 = sample only; never full parity.
Phase 22B 15/15 = smoke only; never matrix.
```

Never merge labeled protocol counts into one unlabeled total. Never describe Phase 22C 7200/7200 as full protocol parity.

---

## 5. Long-run replay resume rules

For future **explicitly approved** full replays (57105 per protocol), use Phase 22H–J runner patterns:

### Checkpoint files

```text
bench_logs/ai-platform/phase22/<tag>-full-replay-checkpoint.json
```

Fields: `protocol`, `phase`, `last_probe_id`, `probes_completed`, `completed_batches`, `updated_at`.

### Per-batch JSONL

```text
bench_logs/ai-platform/phase22/<tag>-full-replay-batches/T20.42C.jsonl
```

One file per historical batch (21 batches for 57105 manifest). Enables batch-level retry without full rerun.

### Resume command

```bash
node scripts/phase22-full-protocol-replay-runner.mjs --protocol h2 --resume
```

Skips probes already present in main JSONL and per-batch files. Re-runs lifecycle for the current batch/window on resume.

### Progress logging

- Log every 500 probes to main JSONL and checkpoint
- Flush per-batch JSONL on batch boundary
- Never commit JSONL; summary metrics belong in docs only after owner review

### Pre-resume checklist (future live work)

1. Run both archive verifiers PASS
2. Read `ACTIVE_CONTEXT.md` and Phase 22 archive doc
3. Confirm artifact SHA256 unchanged
4. Confirm PERCENT=0, ALLOW_PROD_PERCENT=0, production default keyword
5. Locate checkpoint + per-batch JSONL under `bench_logs/ai-platform/phase22/`
6. Use `--resume`; do not restart from probe 0 unless explicitly approved

---

## 6. Bench-log handling rules

```text
- bench_logs/ai-platform/** stays local unless owner explicitly approves commit
- JSONL, traces, JWTs, DB dumps, screenshots: never commit by default
- Committed docs carry labeled summary metrics only (counts, pass rates, latency percentiles)
- Local bench logs are audit/debug supplements, not source of truth
- Verifiers and archive docs outrank any local log file
```

---

## 7. Future Phase 23 end state

Phase 23 final desired end state:

```text
Phase 23 final desired end state:
- Phase 21 archive verifier PASS.
- Phase 22 full protocol parity verifier PASS.
- ACTIVE_CONTEXT.md separates current repo tip (computed live), phase handoff lineage, and frozen archive heads.
- Long-run replay resume/runbook templates exist.
- CI or script guard exists to prevent mislabeling Phase 22C 7200 as full parity.
- No live eval run in Phase 23 unless separately approved.
- No runtime/env/default/allowlist/artifact/user changes.
- Production default remains keyword.
- Preview UI/API remains KEEP.
- PERCENT=0 and ALLOW_PROD_PERCENT=0.
- Hybrid/vector production default remains NOT APPROVED.
```

Phase 23 is the **continuity/guardrail layer**, not another inference run.

---

## 8. Phase 23 workstream table

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 23A | Context-continuity and long-run replay operations design | COMPLETE after this commit |
| 23B | Context/archive verifier hardening + CI guard | NOT STARTED |
| 23C | Dry-run resume/checkpoint validation only, no live matrix | NOT STARTED |
| 23D | Phase 23 archive closeout | NOT STARTED |

---

## 9. Next approval phrases

**Phase 23B (verifier hardening + CI guard):**

```text
Approved: start Phase 23B context/archive verifier hardening and CI guard only — no live eval, no runtime changes.
```

**Phase 23C (dry-run checkpoint/resume validation):**

```text
Approved: start Phase 23C dry-run resume/checkpoint validation only — no live eval, no runtime changes.
```

**Phase 23 live work (any matrix, smoke expansion, or inference):**

Requires a **new** explicit owner approval phrase and both archive verifiers PASS first. Not approved by Phase 23A.

---

## Related documents

- `docs/ai-platform/ACTIVE_CONTEXT.md` — compact agent handoff
- `docs/ai-platform/PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md` — Phase 22 labeled parity ledger
- `docs/ai-platform/PHASE_23A_CONTEXT_CONTINUITY_AND_LONG_RUN_REPLAY_DESIGN.md` — earlier draft; superseded by this operations design doc for Phase 23A closeout
