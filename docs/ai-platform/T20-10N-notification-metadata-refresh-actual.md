# T20.10N — Bounded contract-user notification metadata-only refresh

**Generated:** 2026-06-23  
**Base main:** `56fdae8` (T20.10M dry-run)  
**Mode:** actual write — metadata column only  
**Vector rollout:** NOT APPROVED

## Why this ticket

T20.10M dry-run approved a bounded metadata-only refresh for contract user `2ed75568-7deb-4c29-91b0-6919f24a0c9f`. Standard `rp-ai-rag-reindex.sh` was **not used** because it deletes/recreates chunks and would have put **6 embedded notification chunks** at risk.

---

## Backup

**Path:** `backups/rp-all-11-t20-notification-metadata-contract-preflight/`

```bash
PGPASSWORD=postgres PG_DUMP_JOBS=4 BACKUP_TIMESTAMP=t20-notification-metadata-contract-preflight \
  bash scripts/backup-rp-postgres-dbs.sh
```

Restore (if needed):

```bash
RESTORE_BACKUP_DIR=backups/rp-all-11-t20-notification-metadata-contract-preflight \
  ./scripts/restore-external-postgres-from-backup.sh \
  backups/rp-all-11-t20-notification-metadata-contract-preflight
```

---

## Scope

| Constraint | Value |
|------------|-------|
| TARGET_USER_ID | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| source_type | `notification` only |
| column updated | `ai.ai_documents.metadata` only |
| chunks | not touched |
| embeddings | not touched |
| checksum | not updated |
| text/content | not updated |

---

## Implementation

| File | Purpose |
|------|---------|
| `scripts/rp-ai-t20-notification-metadata-refresh-actual.sh` | Wrapper; requires `TARGET_USER_ID`; `APPLY=1` for writes |
| `scripts/rp-ai-t20-notification-metadata-refresh-actual.mjs` | Metadata-only `UPDATE`; idempotent via `metadata IS DISTINCT FROM` |

### Invocation

```bash
TARGET_USER_ID=2ed75568-7deb-4c29-91b0-6919f24a0c9f \
APPLY=1 \
REPORT_JSON=bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.json \
REPORT_MD=bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.md \
bash scripts/rp-ai-t20-notification-metadata-refresh-actual.sh
```

---

## Actual run results

| Metric | Count |
|--------|------:|
| Matching AI notification docs | 11,904 |
| Updated (metadata changed) | **11,849** |
| Skipped unchanged | 55 (no entity keys in source payload; JSONB already equivalent) |
| Gained `listing_id` | **11,849** |
| Gained `offer_id` | 0 |
| Gained `record_id` | 0 |
| Gained `auction_id` | 0 |
| Gained `bid_id` | 0 |

**Idempotency:** second `APPLY=1` run updated **0** docs (exit 0).

---

## SQL before/after (global)

| Metric | Before | After |
|--------|-------:|------:|
| notification docs | 55,451 | 55,451 |
| embedded notification chunks | 800 | 800 |
| docs with entity metadata | 0 | **11,849** |

## Contract user

| Metric | Before | After |
|--------|-------:|------:|
| notification AI docs | 11,904 | 11,904 |
| docs with `listing_id` | 0 | **11,849** |
| docs with `offer_id` | 0 | 0 |
| embedded notification chunks | 6 | **6** |
| total chunks | 11,904 | 11,904 |

---

## No-touch proof

| Check | Result |
|-------|--------|
| chunks touched | **0** |
| embeddings touched | **0** |
| text/content changed | **0** |
| notification doc count unchanged | YES |
| global embedded chunk count unchanged | YES |
| contract-user embedded chunks unchanged | YES (6 → 6) |

---

## Benchmark impact (post-refresh)

`BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh`

Artifact: `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-134712.md`

| Metric | Value |
|--------|------:|
| zero chunk-overlap shadow runs | 11/16 |
| document-overlap >0 runs | 5/16 |
| entity-overlap >0 runs | 5/16 |
| shadow p95 total ms | 4748.8 |
| embed timeouts | 0 |

Notification query (`What notifications matter most…`) on `shadow_obo_owner`: **entity_ov=3** (was 0 pre-metadata on comparable runs). Metadata refresh improved entity-linking parity without changing retrieval mode.

---

## Validation

| Check | Result |
|-------|--------|
| Actual exit | 0 |
| Idempotent re-run | 0 updates |
| OCH decontaminate scan | PASS |
| python-ai code changes | None |
| Node tests | Not required (script-only) |

---

## Artifacts (not committed)

- `bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.json`
- `bench_logs/ai-platform/t20-10n-notification-metadata-refresh-actual.md`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-134712.{jsonl,md}`

---

## Recommendation

**Broaden metadata-only refresh with new dry-run** for additional test users or capped batches — not all 55,451 docs at once. Remaining corpus without entity metadata: **43,602** docs (55,451 − 11,849).

Do **not** use standard reindex for metadata backfill.

**Vector rollout:** NOT APPROVED

---

## Files added (uncommitted)

- `scripts/rp-ai-t20-notification-metadata-refresh-actual.sh`
- `scripts/rp-ai-t20-notification-metadata-refresh-actual.mjs`
- `docs/ai-platform/T20-10N-notification-metadata-refresh-actual.md`
