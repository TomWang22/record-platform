# T20.10M — Bounded notification metadata reindex dry-run

**Generated:** 2026-06-23  
**Base main:** `5a24c2c` (T20.10L notification metadata normalization)  
**Mode:** dry-run only — **zero writes**  
**Vector rollout:** NOT APPROVED

## Why this ticket

T20.10L added safe entity metadata extraction in `normalizeNotification`, but existing `python_ai` notification documents were ingested without `listing_id` / `offer_id` keys. This ticket estimates scope for a **bounded metadata-only refresh** without touching embeddings or keyword retrieval.

---

## Step 1 — Existing reindex support

### `scripts/rp-ai-rag-reindex.sh` / `rp-ai-rag-reindex.mjs`

| Capability | Supported? | Notes |
|------------|------------|-------|
| `--source notifications` | **Yes** | `exportNotifications` reads notification DB |
| `--user <uuid>` | **Yes** | Filters `WHERE user_id = $1` |
| `--dry-run` | **Yes** | Returns `would_insert` / `would_update` / `skipped` counts only |
| Metadata-only comparison | **No** | Dry-run uses full `upsertDocument` checksum gate |
| Proves embeddings untouched | **No** | Standard upsert **deletes chunks** on checksum change (even when text unchanged) |

### Critical upsert behavior (`rp-ai-rag-db.mjs`)

On `would_update` / actual update, `upsertDocument`:

1. `UPDATE ai.ai_documents` (title, summary, metadata, checksum, …)
2. **`DELETE FROM ai.ai_document_chunks`** for the document
3. Re-insert chunks with `embedding = NULL`

Therefore **standard reindex is not safe** for metadata refresh when embeddings exist. An actual refresh must use a **metadata-only UPDATE** path (update `metadata` + `checksum` on `ai_documents` only; leave chunks untouched).

### Conclusion

Existing `--dry-run` can estimate bulk `would_update` counts but cannot:

- Compare old vs new metadata field-by-field
- Confirm text/content unchanged vs stored chunks
- Prove embeddings would remain intact

**Added:** `scripts/rp-ai-t20-notification-metadata-refresh-dry-run.sh` (+ `.mjs`) for T20.10M.

---

## Step 2 — Dry-run method

### Invocation

```bash
TARGET_USER_ID=2ed75568-7deb-4c29-91b0-6919f24a0c9f \
REPORT_JSON=bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.json \
REPORT_MD=bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.md \
bash scripts/rp-ai-t20-notification-metadata-refresh-dry-run.sh
```

### Algorithm (read-only)

1. Snapshot global `python_ai` counts (notification docs, embedded chunks, entity-metadata docs).
2. Load all notification source rows for `TARGET_USER_ID` from notification DB (port 5441).
3. Load all `ai.ai_documents` where `source_type = 'notification'` and `owner_user_id = TARGET_USER_ID`.
4. Batch-load chunk content + embedding flags for those documents.
5. For each AI doc, match source row by `source_id`; recompute `normalizeNotification` (T20.10L logic).
6. Compare old `metadata` vs new `metadata`; compare chunk text vs `normalized_text`.
7. Count gains per entity key; flag checksum changes and standard-reindex embedding risk.
8. Re-snapshot global counts; assert unchanged (no-write proof).
9. Write JSON + MD under `bench_logs/ai-platform/` (not committed).

---

## Step 3 — Bounded scope

| Scope item | Value |
|------------|------:|
| **TARGET_USER_ID** | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` (e2e contract user) |
| Source notification rows | 73,281 |
| Matching AI notification docs | 11,904 |
| AI docs missing source row | 0 |
| Source rows without AI doc | 61,377 (not in corpus; out of refresh scope) |

Corpus-wide (all users) notification docs remain **55,451** with **0** entity-metadata docs pre-refresh.

---

## Step 4 — Dry-run results (contract user)

### Would-change counts

| Metric | Count |
|--------|------:|
| Docs missing entity metadata today | 11,904 |
| Metadata would change | 11,904 |
| Would gain `listing_id` | 11,849 |
| Would gain `record_id` | 0 |
| Would gain `offer_id` | 0 |
| Would gain `auction_id` | 0 |
| Would gain `bid_id` | 0 |
| Text/content would change | **0** |
| Checksum would change | 11,849 |
| Standard reindex would touch embeddings | **6** (docs with existing `embedding_vec`) |
| Metadata-only UPDATE viable | **11,904** |

55 docs show metadata JSON key-order drift only (no new entity keys; checksum unchanged).

### Payload audit (all source rows for user)

| Field present in payload | Rows |
|--------------------------|-----:|
| `listing_id` | 73,117 (~99.8%) |
| `offer_id` | 9 |
| `record_id` | 0 |
| `auction_id` | 0 |
| `bid_id` | 0 |

### Text and embeddings

- **Text/content:** 0 docs would change — chunk text matches recomputed `normalized_text`.
- **Embeddings via metadata-only path:** 0 touched (chunks not modified).
- **Embeddings via standard reindex:** 6 docs would lose embeddings (must not use standard upsert).

### Sample metadata gain

```json
{
  "old_metadata": { "status": "pending", "channel": "push", "event_type": "AuctionRiskDetectedV1" },
  "new_metadata": {
    "event_type": "AuctionRiskDetectedV1",
    "channel": "push",
    "status": "pending",
    "listing_id": "668e7610-92f0-4899-9afc-fa7ba2cb9bfa"
  }
}
```

---

## Step 5 — No-write proof

| Metric | Before | After |
|--------|-------:|------:|
| notification docs (global) | 55,451 | 55,451 |
| embedded notification chunks (global) | 800 | 800 |
| docs with entity metadata (global) | 0 | 0 |

**Unchanged:** YES — dry-run performed zero writes.

---

## Step 6 — Validation

| Check | Result |
|-------|--------|
| Dry-run exit code | 0 |
| OCH decontaminate scan | PASS |
| Node tests | Not required (new script only; no changes to `rp-ai-normalize-documents.test.mjs`) |
| python-ai | Not touched |

---

## Artifacts (not committed)

- `bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.json`
- `bench_logs/ai-platform/t20-10m-notification-metadata-refresh-dry-run.md`

---

## Files added

| File | Purpose |
|------|---------|
| `scripts/rp-ai-t20-notification-metadata-refresh-dry-run.sh` | Thin wrapper |
| `scripts/rp-ai-t20-notification-metadata-refresh-dry-run.mjs` | Read-only comparison engine |
| `docs/ai-platform/T20-10M-notification-metadata-reindex-dry-run.md` | This document |

---

## Recommendation

**Approve bounded actual metadata refresh** for contract user `2ed75568-7deb-4c29-91b0-6919f24a0c9f` (11,904 docs) subject to:

1. Use **metadata-only UPDATE** on `ai.ai_documents` (`metadata` + `checksum`); **do not** call standard `upsertDocument` / `rp-ai-rag-reindex.sh` (would delete 6 embedded chunk sets).
2. Scope capped to contract user first; do not refresh all 55,451 docs in first write.
3. Re-run this dry-run before and after actual refresh to verify counts.
4. Optional follow-up: dry-run buyer/seller test users before expanding scope.

**Do not:**

- Enable vector default
- Run embedding tranches or `EMBEDDING_BACKFILL_FORCE=1`
- Start Phase 21
- Commit `bench_logs/`

**Vector rollout:** NOT APPROVED

---

## Decision rule checklist

| Criterion | Met? |
|-----------|------|
| Dry-run exits 0 | Yes |
| Scope bounded to contract user | Yes |
| Text/content changes = 0 | Yes |
| Embeddings touched (metadata-only path) = 0 | Yes |
| Would-change metadata count understood | Yes — 11,904 metadata updates; 11,849 gain `listing_id` |
| No-write proof passes | Yes |
| OCH scan passes | Yes |
| No bench logs staged | Yes |
