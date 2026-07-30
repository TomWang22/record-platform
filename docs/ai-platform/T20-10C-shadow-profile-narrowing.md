# T20.10C — Shadow profile narrowing and selection alignment

**Status:** implemented (shadow-only)  
**Depends on:** T20.10D (owner-visible OBO corpus repair)  
**Does not:** change keyword retrieval, enable vector default, or start T20.9 / Phase 21

## Problem (post-T20.10D)

After corpus repair, owner OBO prompts showed:

| Metric | Post-T20.10D |
|--------|-------------:|
| Raw `obo_offer_summary` | 8 |
| Selected `obo_offer_summary` | 2 |
| Shadow p95 | 3541 ms |
| Zero-overlap runs | 12/16 |

Privacy and corpus depth were no longer the primary blockers. Selection and profile behavior were.

## Root cause

Shadow route selection used a **uniform per-type quota**:

```text
per_type_quota = min(3, max_chunks // len(preferred))  → 2 when max_chunks=8
```

For `obo_helper` (4 preferred types), OBO was capped at **2 reserved slots** even when 8 strong OBO candidates were in the raw pool. Listing types filled the remainder.

Additionally, route-mode vector fetch issued **one global + four per-type** SQL queries, inflating `candidate_fetch` latency.

## Changes (shadow-only)

### `shadow_profiles.py`

- Fixed `obo_helper` weights: OBO **3.5** vs listing **1.35**
- `is_obo_focused()` — true for `obo_helper` or hints like `obo`, `owner_visible`
- `preferred_type_quotas()` — OBO-focused routes reserve **≥3** OBO slots (up to half of `max_chunks`), cap listing at **2**
- `non_primary_source_caps()` — limits listing dominance in weighted fill
- `vector_fetch_extra_types()` — OBO routes fetch only `obo_offer_summary` + `listing` (not all 4 preferred types)

### `rag_retrieval.py`

- Selection uses profile quotas + slot caps (not uniform `per_type_quota`)
- OBO-focused fetch: smaller global limit (`2×` vs `3×` chunks), fewer per-type queries

Keyword path untouched.

## Validation

```bash
git rev-parse HEAD
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-rp-decontaminate-scan.sh
```

## Acceptance targets (vs post-T20.10D baseline)

| Metric | Baseline | Target |
|--------|----------|--------|
| Selected `obo_offer_summary` (owner OBO prompt) | 2 | **> 2** (stretch ≥4) |
| Shadow p95 | 3541 ms | **< 3541 ms** (stretch ≤3000 ms) |
| Zero-overlap | 12/16 | improve |
| Keyword behavior | stable | unchanged |
| Coverage `app/ai/*` | ≥90% | maintain |

Record before/after in `bench_logs/ai-platform/t20-10-shadow-real-query-*.jsonl` (not committed).
