# Phase 32H — Triplet runner bounded-memory repair

**Status:** Implemented in scratch / awaiting quiet-window apply
**PIN base:** `110a72649bb8dd7cfb537839b37abee8787a70ae`

## Problem
Baseline-r8 OOM at ~322 batches / ~4 GiB: unbounded per-probe Workers, growing COMPLETE queue, full probe-index rewrites, whole-file JSONL splits, plus `JSON_STREAM_PARSED_AS_SINGLE_DOCUMENT` parser-contract defects.

## Repair tracks
1. Bounded Worker pool (size 3) with listener removal + `terminate()` await
2. Streaming JSONL reader (no whole-file `.split`)
3. Correlation queue v2 — active PENDING/RUNNING only; COMPLETE history JSONL
4. Append-only probe/coordinate indexes + in-process Sets
5. Single-document JSON parser contract + monitor stdout/stderr separation
6. Freeze writer identity without argv self-match false positive
7. Redacted memory telemetry every N batches

## Verify
`make ai-platform-verify-phase32h-runner-memory`
