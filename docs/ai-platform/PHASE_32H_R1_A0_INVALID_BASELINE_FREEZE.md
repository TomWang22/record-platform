# Phase 32H-R1-A0 — Invalid Baseline Freeze

**Status:** BLOCKED — not valid PASS evidence
**Root:** `/tmp/phase32h-r1-baseline`
**Frozen at:** 2026-07-11 (operator stop after A0 recovery directive)

## Why this arm is invalid

1. `COLLECTOR_COVERAGE_BLOCKED` was raised, then improperly cleared during resume.
2. Runner/supervisor code was patched locally after launch HEAD `a7a8716` was pinned.
3. The same evidence root was resumed under different executable code.
4. Batch 3 (`final_tagged_plan`) and subsequent triplets failed all three protocols.
5. Strict history audit still contained forbidden editor-assistant commit trailers (grandfather policy was unacceptable).

## Frozen counts

| Metric | Value |
|--------|------:|
| Total rows | 36 |
| H1 | 12 |
| H2 | 12 |
| H3 | 12 |
| Batches | 13 |

## Batch 3 classification

**GATE_FAILURE** — HTTP 422 on `preview_opt_in` gate with 15 retries (~115.5s backoff each). Not a collector false-block side effect alone; application gate never passed.

## Reuse policy

This root is **not reusable**. Do not count rows toward any future arm. Artifacts are preserved under `FROZEN_BLOCKED_EVIDENCE`.

## Next valid path

1. Zero-trailer history rewrite on `main`
2. Repair commit for supervisor/triplet integrity
3. 90-probe canary at `/tmp/phase32h-r1-baseline-r2-canary`
4. Fresh baseline at `/tmp/phase32h-r1-baseline-r2`
