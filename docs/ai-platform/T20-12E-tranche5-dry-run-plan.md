# T20.12E — Tranche 5 dry-run plan (planning only)

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Ticket:** T20.12E  
**Tranche id:** `t20-tranche-5`  
**Pre-embedded count:** 6,065  
**Prior tranche locks:** `t20-tranche-2`, `t20-tranche-3`, `t20-tranche-4` (do not rerun)

## Goal

Plan the next bounded +500 embedding tranche toward the 10k embedded target without enabling vector rollout or broad backfill.

## Coverage math

| Target | Embedded needed | Remaining after Tranche 5 (if +500) |
|--------|----------------:|------------------------------------:|
| Current | 6,065 | — |
| 10k | 10,000 | 6,565 (+3,435 still needed) |
| 15% (~10,957) | 10,957 | 6,565 (+4,392 still needed) |
| After Tranche 5 (+500) | 6,565 | **≈9.0%** of 73,043 non-message chunks |

## Proposed caps (Tranche 5)

| source_type | cap |
|-------------|----:|
| obo_offer_summary | 150 |
| listing | 200 |
| listing_revision | 100 |
| notification | 50 |
| record | 0 |
| auction_bid_summary | 0 |
| **Total** | **500** |

## Dry-run results (executed 2026-06-25)

```bash
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-5 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_MAX_NEW=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=150,listing=200,listing_revision=100,notification=50,record=0,auction_bid_summary=0" \
EMBEDDING_BACKFILL_TICKET=T20.12E \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

| source_type | selected |
|-------------|--------:|
| obo_offer_summary | 150 |
| listing | 200 |
| listing_revision | 100 |
| notification | 50 |
| **Total** | **500** |

- `dry_run_exit=0`
- `new_embeddings_added=0`
- `post_embedded_count=6,065` (unchanged)
- Local artifacts: `bench_logs/ai-platform/t20-12-tranche5-dry-run.json`, `.md`

## Pre-checks

| Check | Result |
|-------|--------|
| `--check-lock t20-tranche-4` | exit **2** (rerun blocked) ✓ |
| `rp-ai-backfill-rerun-guard-smoke.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS |

## Actual write (NOT APPROVED)

Requires separate explicit phrase:

```text
Approved: start T20.12F actual t20-tranche-5 write
```

Before any actual write:

1. Fresh backup (`BACKUP_TIMESTAMP=t20-12-tranche5-preflight`)
2. Tranche id `t20-tranche-5` (new; no lock file yet)
3. Same caps as dry-run
4. **No** `EMBEDDING_BACKFILL_FORCE=1`
5. Post-write: rerun guard smoke + full AI/RAG validation bundle (T20.12D pattern)

**Never:** vector default flip, broad backfill, Phase 21, or tranche rerun without new id.

## Projected post-write (if approved)

| Metric | Projected |
|--------|----------:|
| Embedded count | 6,565 |
| Coverage | ≈9.0% |
| Vector rollout | still **NOT APPROVED** |

## Rollback

Restore from backup taken immediately before actual write. Prefer full `python_ai` restore over surgical clears.

**RESULT: PLAN ONLY — actual Tranche 5 write NOT APPROVED**
