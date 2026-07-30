# T20.9 — Tranche 3 actual write results

**Generated:** 2026-06-22
**Baseline SHA:** `e1e411fff9675d6b00276f5c32ba5038d063645e`
**Tranche ID:** `t20-tranche-3`
**Mode:** one bounded actual pass — no vector default flip, no FORCE

## Executive summary

Tranche 3 actual write **succeeded**: +500 embeddings exactly as dry-run planned. Vector rollout remains **NOT APPROVED** — coverage still below 15% / 10k threshold; overlap still poor.

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Embedded total | 5,065 | **5,565** | **+500** |
| Embedded coverage (non-message) | 6.9% | **7.6%** | +0.7 pp |
| e2e-contract owner OBO embedded | 18 | **18** | 0 |

## Backup

| Field | Value |
|-------|-------|
| Label | `t20-tranche3-preflight` |
| Path | `/Users/tom/record-platform/backups/rp-all-11-t20-tranche3-preflight` |
| Restore hint | `RESTORE_BACKUP_DIR=.../backups/rp-all-11-t20-tranche3-preflight ./scripts/restore-external-postgres-from-backup.sh ...` |

## Actual run

| Field | Value |
|-------|-------|
| `actual_exit` | **0** |
| `pre_embedded_count` | 5,065 |
| `post_embedded_count` | 5,565 |
| `new_embeddings_added` | **500** |
| `selected_count` | 500 |
| `updated_count` | 500 |
| `EMBEDDING_BACKFILL_FORCE` | not set |
| Lock written | `bench_logs/ai-platform/t20-tranche-3-actual-run.json` |

### Selected / embedded delta by source_type

| source_type | cap | selected (actual) | embedded before | embedded after | delta |
|-------------|----:|------------------:|----------------:|---------------:|------:|
| obo_offer_summary | 150 | 150 | 968 | **1,118** | +150 |
| listing | 200 | 200 | 1,700 | **1,900** | +200 |
| listing_revision | 100 | 100 | 800 | **900** | +100 |
| notification | 50 | 50 | 750 | **800** | +50 |
| record | 0 | 0 | 594 | 594 | 0 |
| auction_bid_summary | 0 | 0 | 253 | 253 | 0 |

## Lock proof

| Check | Exit |
|-------|-----:|
| `--check-lock t20-tranche-3` | **2** (blocks rerun) |
| `--check-lock t20-tranche-2` | **2** (still blocks) |
| `rp-ai-backfill-rerun-guard-smoke.sh` | **PASS** (count unchanged on blocked rerun) |

## Safety SQL

| Check | Count |
|-------|------:|
| wrong_dim (≠768) | **0** |
| message_embeddings | **0** |
| proxy_leaks | **0** |

Non-message chunks: **73,043** → coverage **5,565 / 73,043 = 7.62%**

## Post-run validation

| Gate | Result |
|------|--------|
| Rerun guard smoke | **PASS** |
| python-ai coverage | **PASS** (109 tests, 91.53%) |
| Shadow timing (warmup=1) | shadow p50/p95 **1635 / 3010 ms**; embed p95 **1887 ms** |
| Shadow source diagnostic | **PASS** (0 issues; OBO owner-visible **18**) |
| RAG contract | **PASS** |
| Quality smoke | **PASS** |
| Runtime contract | **PASS** |
| Endpoints contract | **PASS** |
| Provider readiness | **PASS** |
| pgvector readiness | **PASS** |
| RP scan | **PASS** |

Shadow selection preserved: owner OBO prompt **6 OBO + 2 listing** (total **1909 ms**). Zero-overlap: **12/16**.

## Updated rollout readiness (vs T20.10F)

| Gate | Threshold | Post-T20.9 | Status |
|------|-----------|------------|--------|
| Embedded coverage | ≥15% or ≥10k | **7.6%** (5,565) | **FAIL** |
| Owner-visible OBO (e2e) | ≥10 | **18** | **PASS** |
| Shadow latency p95 | ≤3,000 ms | **~3,010 ms** (marginal) | **MARGINAL/FAIL** |
| Leakage | 0 | 0 | **PASS** |
| Keyword stability | unchanged | audits PASS | **PASS** |
| Overlap / quality parity | meaningful | **12/16 zero** | **FAIL** |
| python-ai coverage | ≥90% | 91.53% | **PASS** |

## Product configuration (unchanged)

- `AI_RAG_SHADOW_VECTOR` default: **0**
- Production retrieval: **keyword**
- No `EMBEDDING_BACKFILL_FORCE`

## Artifacts (local only — not committed)

- `bench_logs/ai-platform/t20-9-tranche3-actual.json`
- `bench_logs/ai-platform/t20-9-tranche3-actual.md`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260622-182822.{jsonl,md}`

## Recommended next steps

1. **Hold** vector default — T20.3 gates not met
2. **T20.10G** — ranking / overlap alignment (quality parity)
3. Optional later — another bounded tranche only with fresh backup + dry-run

**RESULT: T20.9 actual write complete — vector rollout NOT APPROVED**
