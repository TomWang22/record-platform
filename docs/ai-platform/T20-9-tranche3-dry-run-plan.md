# T20.9 — Tranche 3 dry-run plan (planning only; do not run actual write)

**Status:** PLAN ONLY — requires explicit approval before backup or actual run  
**Baseline SHA:** `46e1a4f0a7dd799c9a7be407dd72e9c69351b5b7`  
**Pre-embedded count:** 5,049  
**Tranche 2 lock:** `bench_logs/ai-platform/t20-tranche-2-actual-run.json` (do not rerun; exit **2**)

## Goal

Incrementally grow embedded corpus toward rollout thresholds **without** broad backfill, vector default flip, or Tranche 2 rerun. Prioritize remaining `obo_offer_summary` and high-shadow-value types.

## Remaining unembedded (non-message, 2026-06-22)

| source_type | embedded | unembedded |
|-------------|--------:|-----------:|
| notification | 750 | 54,701 |
| listing | 1,700 | 7,618 |
| listing_revision | 800 | 5,083 |
| obo_offer_summary | 952 | 560 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

**Note:** e2e-contract owner-visible embedded OBO is **2**. Embedding more public OBO alone may not fix rollout OBO threshold (≥10 owner-visible). May need **corpus repair** (real offers + reindex, T19.7 pattern) in addition to or instead of blind backfill.

## Proposed caps (Tranche 3)

| source_type | cap | Rationale |
|-------------|----:|-----------|
| obo_offer_summary | **150** | Largest shadow/OBO gap; 560 remain |
| listing | **200** | High shadow value; avoid dominance |
| listing_revision | **100** | Auction/OBO route context |
| notification | **50** | Sample only — avoid flood |
| record | **0** | Fully embedded |
| auction_bid_summary | **0** | Fully embedded |
| **Total** | **500** | Same hard cap as Tranche 2 |

**Expected post-count if fully selected:** 5,049 + ≤500 = **≤5,549** (~7.6% coverage).

## Env block (dry-run first — mandatory)

```bash
# Step 0 — verify Tranche 2 lock still blocks (expect exit 2)
bash scripts/rp-ai-embedding-backfill-controlled.sh --check-lock t20-tranche-2

# Step 1 — dry run ONLY (no writes)
EMBEDDING_BACKFILL_DRY_RUN=1 \
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-3 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_MAX_NEW=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=150,listing=200,listing_revision=100,notification=50,record=0,auction_bid_summary=0" \
EMBEDDING_BACKFILL_BATCH_SIZE=10 \
EMBEDDING_BACKFILL_TICKET=T20.9 \
REPORT_JSON=bench_logs/ai-platform/t20-9-tranche3-dry-run.json \
REPORT_MD=bench_logs/ai-platform/t20-9-tranche3-dry-run.md \
bash scripts/rp-ai-embedding-backfill-controlled.sh
echo "dry_run_exit=$?"
```

**Dry-run acceptance:**

- `selected_count` ≤ 500
- Per-type selected ≤ caps
- `record=0`, `auction_bid_summary=0` selected
- `dry_run_exit=0`
- Embedded count unchanged at **5,049**

## Actual write (NOT APPROVED — do not run without sign-off)

Only after: fresh backup, dry-run reviewed, explicit approval.

```bash
# Backup first
PGPASSWORD=postgres PG_DUMP_JOBS=4 BACKUP_TIMESTAMP=t20-tranche3-preflight \
  bash scripts/backup-rp-postgres-dbs.sh

# Actual run — ONE PASS ONLY
EMBEDDING_BACKFILL_TRANCHE_ID=t20-tranche-3 \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_MAX_NEW=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=150,listing=200,listing_revision=100,notification=50,record=0,auction_bid_summary=0" \
EMBEDDING_BACKFILL_BATCH_SIZE=10 \
EMBEDDING_BACKFILL_TICKET=T20.9 \
REPORT_JSON=bench_logs/ai-platform/t20-9-tranche3-actual.json \
REPORT_MD=bench_logs/ai-platform/t20-9-tranche3-actual.md \
bash scripts/rp-ai-embedding-backfill-controlled.sh
```

**Never:** `EMBEDDING_BACKFILL_FORCE=1` without ops approval. **Never** reuse `t20-tranche-2` id.

## Gate bundle (post actual run — if ever approved)

```bash
pnpm install --frozen-lockfile

# Rerun guard + count unchanged proof
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh   # Tranche 2 lock still blocks

# Coverage
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs

# AI quality
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh

# Platform
bash scripts/rp-runtime-domain-comb.sh
bash scripts/rp-db-domain-comb.sh
bash scripts/rp-rp-decontaminate-scan.sh
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
```

**SQL proof (read-only):**

```sql
SELECT COUNT(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;
-- expect: 5049 + actual_new (≤500)

SELECT d.source_type, COUNT(*) FILTER (WHERE c.embedding_vec IS NOT NULL) AS embedded
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type <> 'message'
GROUP BY 1 ORDER BY 1;
```

## Rollback

- Restore python_ai from `backups/rp-all-11-t20-tranche3-preflight` if needed
- Or clear `embedding_vec` on rows with `embedding_updated_at` after tranche start (surgical; prefer backup restore)

## T20.8 re-evaluation after Tranche 3 (if run)

Re-run read-only `docs/ai-platform/T20-8-vector-rollout-readiness.md` checklist. Tranche 3 alone is unlikely to pass rollout thresholds (15% / 10k, OBO owner-visible ≥10, p95 ≤3s).

**RESULT: PLAN ONLY — dry-run not executed**
