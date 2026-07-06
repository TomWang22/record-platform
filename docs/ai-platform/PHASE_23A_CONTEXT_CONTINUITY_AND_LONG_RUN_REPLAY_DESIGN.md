# Phase 23A — context continuity and long-run replay design

**Status:** DESIGN ONLY — no live eval, no runtime changes  
**Created:** 2026-07-06  
**Prerequisite:** Phase 22 CLOSED PASS — full labeled protocol parity  
**Audience:** Cursor, GitHub Copilot, and other coding agents

Phase 23A addresses **context-loss risk** in long multi-hour inference runs and multi-turn agent sessions. It does **not** authorize live work.

---

## Problem

Long runs (57105 probes × H2/H3 ≈ 12+ hours) and many chat turns cause agents to:

- Confuse **57105 H1 baseline**, **57105 H2 replay**, **57105 H3 replay**, **7200 sample**, and **15-probe smoke**
- Resume from chat memory instead of verified archive docs
- Merge labeled counts into one unlabeled total
- Start live work without re-running archive verifiers

---

## Active context block (paste at top of future prompts)

```text
ACTIVE CONTEXT — AI Platform
Phase 21: CLOSED PASS / ARCHIVED
Phase 22: CLOSED PASS — full labeled protocol parity
HEAD: <current>
Artifact SHA256: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
H1 baseline: 57105/57105 HTTP/1.1
H2 replay: 57105/57105 HTTP/2 PASS
H3 replay: 57105/57105 HTTP/3 PASS
Phase 22C: 7200/7200 sample only
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
Runtime/env/default/allowlist changes: NONE
Next allowed step: design/archive/verification only unless owner explicitly approves live work.
```

Replace `<current>` with output of `git rev-parse --short HEAD` after verifier PASS.

---

## Hard rules

1. **Do not infer state from chat memory alone.** Always read `PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md` and run verifiers.
2. **Committed docs + verifier scripts are source of truth.** Local bench logs are supplementary only.
3. **Bench logs stay local** unless explicitly approved for commit.
4. **No live work from stale context** without:
   - `bash scripts/verify-phase-21-archive-readonly.sh` PASS
   - `bash scripts/verify-phase22-full-protocol-parity-archive-readonly.sh` PASS
5. **Preserve evidence labels** in all summaries, commits, and agent responses.

---

## Evidence label rules

| Label | Meaning | Do not call it |
| ----- | ------- | -------------- |
| H1 baseline 57105/57105 | Phase 21 HTTP/1.1 historical matrix | H2/H3 parity |
| H2 replay 57105/57105 | Phase 22I HTTP/2 full replay | cumulative matrix |
| H3 replay 57105/57105 | Phase 22J HTTP/3 full replay | cumulative matrix |
| 171315/171315 combined | H1+H2+H3 labeled sum | single unlabeled total |
| Phase 22C 7200/7200 | Protocol sample (5 cases) | full parity |
| Phase 22B 15 probes | Transport/response smoke | matrix |

---

## Multi-hour replay continuation

For future approved long replays, use the Phase 22H–J runner patterns:

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

### Resume

```bash
node scripts/phase22-full-protocol-replay-runner.mjs --protocol h2 --resume
```

Skips probes already present in main JSONL + per-batch files. Re-runs lifecycle for current batch/window on resume.

### Progress logging

- Log every 500 probes to main JSONL + checkpoint
- Flush per-batch JSONL on batch boundary
- Never commit JSONL; summary metrics go in docs only

---

## Required final response shape (future live work)

When reporting replay results, agents must return:

```text
HEAD SHA:
Phase: PASS / FAIL / BLOCKED
Protocol: H1 / H2 / H3
Count: <n>/57105
Evidence label: (H1 baseline | H2 replay | H3 replay | 22C sample | 22B smoke)
Fallback count:
Wrong protocol count:
Wrong gate count:
Response pass rate:
Sentiment pass rate:
Red-team safety pass rate:
Leakage failures:
Latency p50/p95/max:
Post-revoke:
Final env:
Bench logs committed: NO
Runtime/env/default/allowlist changes: NONE
```

---

## Phase 23 scope (design only)

| Allowed | Not allowed |
| ------- | ----------- |
| Archive verification | Live matrix |
| Context handoff docs | Runtime/env changes |
| Checkpoint/resume design | PERCENT rollout |
| Verifier scripts | Production default switch |
| Reading local bench logs for audit | Committing bench logs |

---

## Next allowed step

```text
Approved: start Phase 23A context-continuity and long-run replay operations design only — no live eval, no runtime changes.
```

Any live Phase 23 work requires a **new** explicit owner approval phrase and must re-run both archive verifiers first.
