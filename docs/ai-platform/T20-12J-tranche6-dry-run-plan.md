# T20.12J — Tranche 6 dry-run plan (planning only)

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Ticket:** T20.12J  
**Tranche id:** `t20-tranche-6`  
**Pre-embedded count:** 6,565  
**Prior tranche locks:** `t20-tranche-2`, `t20-tranche-3`, `t20-tranche-4`, `t20-tranche-5` (do not rerun)

## Goal

Plan the next bounded embedding tranche toward the 10k embedded target without enabling vector rollout or broad backfill.

## Coverage math

| Target | Embedded needed | Remaining after Tranche 6 (if dry-run selection) |
|--------|----------------:|-------------------------------------------------:|
| Current | 6,565 | — |
| 10k | 10,000 | 7,041 (+2,959 still needed) |
| 15% (~10,957) | 10,957 | 7,041 (+3,916 still needed) |
| After Tranche 6 (+476 selected) | 7,041 | **≈9.6%** of 73,043 non-message chunks |

## Proposed caps (Tranche 6)

| source_type | cap |
|-------------|----:|
| obo_offer_summary | 150 |
| listing | 200 |
| listing_revision | 100 |
| notification | 50 |
| record | 0 |
| auction_bid_summary | 0 |
| **Total (requested)** | **500** |

## Dry-run results (executed 2026-06-25)

```bash
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-6 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=150,listing=200,listing_revision=100,notification=50" \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

| source_type | requested | selected |
|-------------|----------:|---------:|
| listing | 200 | 200 |
| listing_revision | 100 | 100 |
| notification | 50 | 50 |
| obo_offer_summary | 150 | **126** |
| **Total** | 500 | **476** |

- `dry_run_exit=0`
- `new_embeddings_added=0`
- `post_embedded_count=6,565` (unchanged)
- OBO cap partially unfilled — only 126 eligible chunks remain at this cap
- Local artifacts: `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md`, `.json`

## Pre-checks

| Check | Result |
|-------|--------|
| `--check-lock t20-tranche-5` | lock exists; rerun blocked ✓ |
| `rp-ai-backfill-rerun-guard-smoke.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS (at T20.12I) |

## Actual write (NOT APPROVED)

Requires separate explicit phrase:

```text
Approved: start T20.12K actual t20-tranche-6 write
```

Before any actual write:

1. Warm pre-write gate (`BENCH_REQUIRE_OLLAMA_WARM=1` timing + source diagnostic)
2. Fresh backup (e.g. `BACKUP_TIMESTAMP=t20-12-tranche6-preflight`)
3. Tranche id `t20-tranche-6` (new; no lock file yet)
4. Same caps as dry-run (expect ~476 selected unless corpus changes)
5. **No** `EMBEDDING_BACKFILL_FORCE=1`
6. Post-write: lock check → T20.12I-style readiness eval → live inference transcript → docs push

## Rollout reminder

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword
AI_RAG_SHADOW_VECTOR=0
Overlap flags default: 0/0
Phase 21: not started
```

Stop here — do not run actual `t20-tranche-6` write without T20.12K approval.
