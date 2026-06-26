# T20.12V — Tranche 9 dry-run plan (planning only)

**Status:** DRY-RUN COMPLETE — **actual write NOT APPROVED**  
**Generated:** 2026-06-25  
**Ticket:** T20.12V  
**Tranche id:** `t20-tranche-9`  
**Pre-embedded count:** 8,065  
**Prior tranche locks:** `t20-tranche-2` through `t20-tranche-8` (do not rerun)

## Caps

```text
obo_offer_summary=0,listing=250,listing_revision=150,notification=100
```

## Coverage math

| Target | Value |
|--------|------:|
| Current embedded | 8,065 |
| After Tranche 9 (+500) | **8,565** |
| Projected coverage | **≈11.7%** |
| Gap to 10k after Tranche 9 | +1,435 |

## Dry-run results (executed 2026-06-25)

| source_type | requested | selected |
|-------------|----------:|---------:|
| listing | 250 | 250 |
| listing_revision | 150 | 150 |
| notification | 100 | 100 |
| obo_offer_summary | 0 | 0 |
| **Total** | **500** | **500** |

- `dry_run_exit=0`; `post_embedded_count=8,065` (unchanged)
- Local artifact: `bench_logs/ai-platform/t18-7-controlled-backfill-plan.md`

## Actual write (NOT APPROVED)

Requires:

```text
Approved: start T20.12W actual t20-tranche-9 write
```

Before actual: warm gate → backup `t20-12-tranche9-preflight` → write → validation → docs/eval → next dry-run.

## Rollout reminder

```text
Vector rollout: NOT APPROVED
Production retrieval: keyword + rule-engine
Phase 21: not started
```

Stop here — do not run actual `t20-tranche-9` write without T20.12W approval.
