# T20.12N — Tranche 7 dry-run plan (planning only)

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Ticket:** T20.12N  
**Tranche id:** `t20-tranche-7`  
**Pre-embedded count:** 7,065  
**Prior tranche locks:** `t20-tranche-2` through `t20-tranche-6` (do not rerun)

## Goal

Plan the next bounded +500 embedding tranche after OBO pool exhaustion (post–Tranche 6).

## Post-OBO caps

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
| Current embedded | 7,065 |
| After Tranche 7 (+500) | **7,565** |
| Projected coverage | **≈10.4%** |
| Gap to 10k after Tranche 7 | +2,435 |
| Gap to 15% (~10,957) after Tranche 7 | +3,392 |

## Dry-run results (executed 2026-06-25)

```bash
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-7 \
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=0,listing=250,listing_revision=150,notification=100" \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

| source_type | requested | selected |
|-------------|----------:|---------:|
| listing | 250 | 250 |
| listing_revision | 150 | 150 |
| notification | 100 | 100 |
| obo_offer_summary | 0 | 0 |
| **Total** | **500** | **500** |

- `dry_run_exit=0`
- `new_embeddings_added=0`
- `post_embedded_count=7,065` (unchanged)
- Local artifact: `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md`

## Pre-checks

| Check | Result |
|-------|--------|
| `--check-lock t20-tranche-6` | exit **2** (lock exists; rerun blocked) ✓ |
| `rp-ai-backfill-rerun-guard-smoke.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS (at T20.12M) |

## Actual write (NOT APPROVED)

Requires explicit phrase:

```text
Approved: start T20.12O actual t20-tranche-7 write
```

Before any actual write:

1. Warm pre-write gate (`BENCH_REQUIRE_OLLAMA_WARM=1` timing + source diagnostic)
2. Fresh backup (e.g. `BACKUP_TIMESTAMP=t20-12-tranche7-preflight`)
3. Tranche id `t20-tranche-7` (new; no lock file yet)
4. Post-OBO caps as above
5. **No** `EMBEDDING_BACKFILL_FORCE=1`
6. Post-write: lock check → readiness eval → live inference transcript → docs push

## Rollout reminder

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword + rule-engine
Flags: 0/0/0
Phase 21: not started
```

Stop here — do not run actual `t20-tranche-7` write without T20.12O approval.
