# Phase 31M — Targeted Replay Runner Repair

## Status

| Item | Value |
|------|-------|
| Phase 31M runner repair | **PASS** |
| Targeted replay | **IN_PROGRESS** |
| Phase 31 parent | **BLOCKED** until targeted replay PASS and full repaired soak decision |
| Live eval closeout (31E–31J) | **NOT RUN** |
| Production enablement | **NOT APPROVED** |
| Production default | `keyword` |
| PERCENT | `0` |
| ALLOW_PROD_PERCENT | `0` |
| Hybrid/vector production default | **NOT enabled** |
| Bench logs committed | **NO** |
| Generated reports committed | **NO** |

## Root causes (0-row replay)

1. **Duplicate `runTargetedReplay` export** crashed runner on import (`SyntaxError: Duplicate export`).
2. **Coordinator assumed consecutive `window - 1`** — targeted replay uses non-consecutive windows (3, 4, 5, 16, …); shards waited forever for window 2 before window 3.
3. **Summarizer missing `node:path` import** — `phase31-summarize-targeted-replay.mjs` threw `ReferenceError: path is not defined`; monitor could not write `current-summary.json`.

## Repair summary

- Single `runTargetedReplay` with `import.meta.url` CLI guard
- `--limit` / `--smoke` support for smoke-before-restart gate
- Protocol manifest validation: **1224 rows/protocol**
- Targeted manifest total: **3672**
- Coordinator `windowSequence` for non-consecutive windows
- Monitor tolerates missing JSONL as count=0 (no shell errors)
- Monitor **BLOCKS** if shard crashes before first row (no restart loop hiding bugs)
- Smoke-before-restart **PASS** (1 redacted row, `http_status=200`, `fallback_count=0`)

## Scope (31M targeted replay)

- **OUT:** `/tmp/phase31-preview-lifecycle-repair-replay`
- **Windows:** 3, 4, 5, 16–23, 25–30 (17 windows)
- **Runs:** 7, 8, 9, 10
- **Users:** contract allowlist + affected preview user `4c6830b9d086`
- **Protocols:** h1, h2, h3 in parallel
- **Total:** 17 × 2 × 4 × 9 × 3 = **3672** (1224 per protocol)

## Gate to closeout

Targeted replay PASS alone is **not** sufficient for 31E–31J. See `PHASE_31N_FULL_SOAK_REPLAY_DECISION.md` — **Decision B:** full repaired 51,840 soak (31D-R2) required before live eval closeout.
