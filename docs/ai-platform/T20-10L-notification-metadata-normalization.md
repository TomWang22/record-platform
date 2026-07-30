# T20.10L — Notification metadata normalization for entity parity

**Generated:** 2026-06-23  
**Base main:** `c05561f` (T20.10K entity aliases)  
**Mode:** code + doc (ingest normalization + diagnostics fields)  
**Vector rollout:** NOT APPROVED

## Root finding

T20.10K identified `notification` as the only source type missing normalized entity IDs in AI document `metadata`. Payloads in the notification DB **already carry safe IDs** (primarily `listing_id`), but `normalizeNotification` only copied `event_type`, `channel`, and `status` into metadata — blocking entity parity with listing/OBO/auction paths.

### Phase A — Payload audit (notification DB, port 5441)

| Field | Notifications with value | Notes |
|-------|-------------------------:|-------|
| Total notifications | 315,923 | |
| `listing_id` (snake_case) | **309,177** | ~98% |
| `listingId` (camelCase) | 0 | not used in stored payloads |
| `offer_id` | **2,000** | marketplace offer events |
| `record_id` / `recordId` | **0** | not present in current payloads |
| `auction_id` / `auctionId` | 0 | auctions use `listing_id` + `context_type: auction` |
| `bid_id` / `bidId` | 0 | not observed |
| `context_id` | 308,277 | often duplicates `listing_id` or `offer_id` |
| `context_type: auction` | 1,335 | `listing_id` present on auction events |

**python_ai corpus today:** 55,451 `notification` documents, **0** with `listing_id`/`offer_id` in metadata (pre-patch).

### Phase A — Ingest location

- `scripts/lib/rp-ai-normalize-documents.mjs` — `normalizeNotification`, new `extractNotificationEntityMetadata`
- `scripts/rp-ai-rag-reindex.mjs` — `exportNotifications` (LIMIT 20,000 per run, optional `--user`)

---

## Phase B — Patch (safe metadata only)

### Added helpers

- `isSafeNotificationEntityId` — UUID-format tokens only; rejects whitespace/long strings
- `extractNotificationEntityMetadata(payload)` — extracts:

| Metadata key | Sources |
|--------------|---------|
| `listing_id` | `listing_id`, `listingId`, `context_id` when `context_type=listing` |
| `record_id` | `record_id`, `recordId` |
| `offer_id` | `offer_id`, `offerId`, `obo_offer_id`, `context_id` when `context_type=offer` |
| `auction_id` | `auction_id`, `auctionId`, `context_id` or `listing_id` when `context_type=auction` |
| `bid_id` | `bid_id`, `bidId` |

**Never stored:** `body`, `message`, `title`, `listing_title`, display names, or raw payload blobs.

### `normalizeNotification` change

Metadata now merges existing fields with extracted entity IDs. Normalized text still references listing/record IDs only when present (no body text).

### Diagnostics (`rag_retrieval.py`)

Entity key collection extended to include `auction_id` and `bid_id` metadata fields (shadow-only parity).

---

## Phase C — Tests

### Node (`scripts/lib/rp-ai-normalize-documents.test.mjs`)

1. `listing_id` snake_case  
2. `listingId` camelCase  
3. `record_id`  
4. offer id variants (`offer_id`, `offerId`, `obo_offer_id`)  
5. auction + bid via `context_type: auction`  
6. empty payload  
7. full `normalizeNotification` — preserves event fields, adds entity IDs, excludes secret body/message  

**Result:** 7/7 new notification tests pass (15/16 suite pass; 1 pre-existing RP title test unrelated).

### Python (`test_shadow_diagnostics.py`)

- `test_overlap_entity_notification_listing_id_bridge` — notification `listing_id` bridges to listing `source_id` alias

**Result:** 121 tests pass, 91.25% line coverage.

---

## Phase D — Reindex decision

| Question | Answer |
|----------|--------|
| Reindex needed? | **Yes** — for existing 55,451 `notification` docs in `python_ai` |
| Why | Metadata checksum changes only apply on upsert/reindex; live corpus still has zero entity keys |
| Execute now? | **No** — propose bounded plan only |

### Proposed bounded dry-run (not executed)

```bash
# Contract-user notification refresh only (safe scope)
bash scripts/rp-ai-rag-reindex.sh --source notifications --user <contract-user-uuid> --dry-run

# If approved: without --dry-run, same command
```

Full notification reindex would touch up to 20,000 rows per `exportNotifications` LIMIT — broader scope requires explicit approval and backup per Phase 20 rules.

**Estimated metadata yield after reindex:** ~98% of notifications with payloads containing `listing_id`; ~0.6% with `offer_id`.

---

## Validation

| Check | Result |
|-------|--------|
| python-ai coverage | **PASS** — 121 tests, 91.25% |
| enforce-service-coverage | **PASS** |
| RAG contract | **PASS** |
| quality smoke | **PASS** |
| runtime contract | **PASS** |
| endpoints contract | **PASS** |
| provider readiness | **PASS** |
| pgvector readiness | **PASS** |
| RP scan | **PASS** |

---

## Files changed (local, uncommitted)

| File | Change |
|------|--------|
| `scripts/lib/rp-ai-normalize-documents.mjs` | entity metadata extraction + normalizeNotification |
| `scripts/lib/rp-ai-normalize-documents.test.mjs` | 7 notification tests |
| `services/python-ai-service/app/ai/rag_retrieval.py` | `auction_id`/`bid_id` entity keys |
| `services/python-ai-service/tests/test_shadow_diagnostics.py` | notification bridge test |
| `docs/ai-platform/T20-10L-notification-metadata-normalization.md` | this document |

---

## Recommendation

| Item | Verdict |
|------|---------|
| Commit T20.10L | **Yes** — safe metadata hardening, no ranking/keyword changes |
| Bounded notification reindex | **Plan next** — contract-user dry-run before broader refresh |
| Ranking patch | **No** |
| Vector rollout | **NOT APPROVED** — coverage still ~7.6% |

### Next ticket (proposed)

**T20.10M** — bounded notification metadata reindex dry-run + parity benchmark re-audit (with `BENCH_REQUIRE_OLLAMA_WARM=1`).
