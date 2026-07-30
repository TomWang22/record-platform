# T20.12R — Tranche 8 dry-run plan (planning only)

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Ticket:** T20.12R  
**Tranche id:** `t20-tranche-8`  
**Pre-embedded count:** 7,565  
**Prior tranche locks:** `t20-tranche-2` through `t20-tranche-7` (do not rerun)

## Goal

Plan the next bounded +500 embedding tranche (post-OBO template).

## Caps

```json
{
  "obo_offer_summary": 0,
  "listing": 250,
  "listing_revision": 150,
  "notification": 100
}
```

Env form:

```bash
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=0,listing=250,listing_revision=150,notification=100"
```

## Coverage math

| Target | Value |
|--------|------:|
| Current embedded | 7,565 |
| After Tranche 8 (+500) | **8,065** |
| Projected coverage | **≈11.0%** |
| Gap to 10k after Tranche 8 | +1,935 |

## Dry-run results (executed 2026-06-25)

| source_type | requested | selected |
|-------------|----------:|---------:|
| listing | 250 | 250 |
| listing_revision | 150 | 150 |
| notification | 100 | 100 |
| obo_offer_summary | 0 | 0 |
| **Total** | **500** | **500** |

- `dry_run_exit=0`
- `new_embeddings_added=0`
- `post_embedded_count=7,565` (unchanged)
- Local artifact: `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md`

## Pre-checks

| Check | Result |
|-------|--------|
| `--check-lock t20-tranche-7` | exit **2** (lock exists; rerun blocked) ✓ |
| `rp-ai-backfill-rerun-guard-smoke.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS (at T20.12Q) |

## Actual write (NOT APPROVED)

Requires explicit phrase:

```text
Approved: start T20.12S actual t20-tranche-8 write
```

Before any actual write:

1. Warm pre-write gate
2. Fresh backup (e.g. `BACKUP_TIMESTAMP=t20-12-tranche8-preflight`)
3. Tranche id `t20-tranche-8`
4. Caps as above
5. **No** `EMBEDDING_BACKFILL_FORCE=1`

## Rollout reminder

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword + rule-engine
Phase 21: not started
```

Stop here — do not run actual `t20-tranche-8` write without T20.12S approval.
