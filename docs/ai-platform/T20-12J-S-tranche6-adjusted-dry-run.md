# T20.12J-S — Adjusted Tranche 6 dry-run

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Baseline SHA:** `da8ca90`  
**Tranche id:** `t20-tranche-6`  
**Related:** T20.12J-R capacity adjustment (Option B)

## Goal

Rerun `t20-tranche-6` dry-run with adjusted caps: use all remaining OBO capacity (126) and shift the +24 shortfall to listing (224), preserving the +500 tranche ladder.

## Adjusted caps

```json
{
  "obo_offer_summary": 126,
  "listing": 224,
  "listing_revision": 100,
  "notification": 50
}
```

Env form:

```bash
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=126,listing=224,listing_revision=100,notification=50"
```

## Dry-run execution (2026-06-25)

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-6 \
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=126,listing=224,listing_revision=100,notification=50" \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

| source_type | requested | selected |
|-------------|----------:|---------:|
| obo_offer_summary | 126 | 126 |
| listing | 224 | 224 |
| listing_revision | 100 | 100 |
| notification | 50 | 50 |
| **Total** | **500** | **500** |

## Embedded count (unchanged)

| Metric | Value |
|--------|------:|
| pre_embedded_count | 6,565 |
| post_embedded_count | 6,565 |
| new_embeddings_added | 0 |

Dry-run only — no writes.

## Projected post-actual (if T20.12K approved)

| Metric | Value |
|--------|------:|
| Projected embedded | **7,065** (6,565 + 500) |
| Non-message chunks | 73,043 |
| Projected coverage | **≈9.7%** |
| Gap to 10k | +2,935 |
| Gap to 15% (~10,957) | +3,892 |

After this tranche, **OBO backfill capacity is zero** under current selection rules (see T20.12J-R).

## Pre-checks

| Check | Result |
|-------|--------|
| `--check-lock t20-tranche-5` | exit **2** (lock exists; rerun blocked) ✓ |
| `rp-ai-backfill-rerun-guard-smoke.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |

Local artifact (not committed): `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md`

## Comparison to T20.12J (original dry-run)

| | T20.12J | T20.12J-S |
|---|--------:|----------:|
| obo_offer_summary cap | 150 → 126 selected | 126 → 126 |
| listing cap | 200 | **224** |
| Total selected | 476 | **500** |

Option B confirmed: adjusted caps yield full +500 selection.

## Actual write (NOT APPROVED)

Requires explicit phrase:

```text
Approved: start T20.12K actual t20-tranche-6 write
```

Before any actual write:

1. Warm pre-write gate (`BENCH_REQUIRE_OLLAMA_WARM=1` timing + source diagnostic)
2. Fresh backup (e.g. `BACKUP_TIMESTAMP=t20-12-tranche6-preflight`)
3. Use **these adjusted caps** (not the original T20.12J caps)
4. **No** `EMBEDDING_BACKFILL_FORCE=1`
5. Post-write: lock check → readiness eval → live inference transcript → docs push

## Rollout reminder

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword + rule-engine
Flags: 0/0/0
Phase 21: not started
```

Stop here — do not run actual `t20-tranche-6` write without T20.12K approval.
