# T20.10K — Metadata/entity-linking parity hardening

**Generated:** 2026-06-23  
**Accepted main:** `e3aa883` (T20.10J audit)  
**Mode:** audit-first + targeted diagnostics patch  
**Vector rollout:** NOT APPROVED

## Executive summary

Phase A/B read-only audits found that **chunk-id overlap is a poor sole gate** because entity keys were **inconsistently derived** across source types (e.g. `listing:{uuid}` vs `listing_id:{uuid}`). A **diagnostics-only** alias patch was applied. Live benchmark parity counts on this run were **unchanged** (11/16 zero chunk-overlap) because most zeros are **complementary retrieval**, not missing metadata.

**Ranking patch:** not justified.  
**Corpus metadata repair:** recommended for `notification` only (add `listing_id`/`record_id` to document metadata at ingest).

---

## Phase A — Metadata audit (SQL)

**Method:** `psql` against `python_ai` on port 5440 (`scripts/lib/rp-python-ai-psql.sh`).

```sql
-- Per source_type: docs, chunks, embedded, metadata field presence
SELECT d.source_type,
  count(DISTINCT d.id) AS docs,
  count(*) AS chunks,
  count(*) FILTER (WHERE c.embedding_vec IS NOT NULL) AS embedded_chunks,
  count(DISTINCT d.id) FILTER (
    WHERE d.metadata ? 'listing_id' AND nullif(d.metadata->>'listing_id','') IS NOT NULL
  ) AS docs_with_listing_id_meta,
  count(DISTINCT d.id) FILTER (
    WHERE d.metadata ? 'offer_id' AND nullif(d.metadata->>'offer_id','') IS NOT NULL
  ) AS docs_with_offer_id_meta,
  count(DISTINCT d.id) FILTER (
    WHERE d.metadata ? 'record_id' AND nullif(d.metadata->>'record_id','') IS NOT NULL
  ) AS docs_with_record_id_meta,
  count(DISTINCT d.id) FILTER (WHERE d.owner_user_id IS NOT NULL) AS docs_with_owner_scope
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE d.source_type IN (
  'listing','listing_revision','obo_offer_summary','notification','record','auction_bid_summary'
)
GROUP BY d.source_type ORDER BY 1;
```

### Metadata coverage by source_type

| source_type | docs | chunks | embedded | embed % | listing_id meta | offer_id meta | record_id meta | owner scope | parity via source_id |
|-------------|-----:|-------:|---------:|--------:|----------------:|--------------:|---------------:|------------:|----------------------|
| listing | 9,314 | 9,318 | 1,900 | 20.4% | **0** | 0 | 0 | 9,314 | **yes** (`source_id` = listing UUID) |
| listing_revision | 5,883 | 5,883 | 900 | 15.3% | **5,883** | 0 | 0 | 5,883 | yes + `listing_id` meta |
| obo_offer_summary | 1,544 | 1,544 | 1,118 | 72.4% | **1,544** | **0** | 0 | 1,544 | **yes** (`source_id` = offer UUID) |
| notification | 55,451 | 55,451 | 800 | 1.4% | **0** | 0 | **0** | 55,451 | partial (`notification:{id}` only) |
| record | 594 | 594 | 594 | 100% | 0 | 0 | **0** | 594 | **yes** (`source_id` = record UUID) |
| auction_bid_summary | 253 | 253 | 253 | 100% | **253** | 0 | 0 | 253 | yes + `listing_id` meta |

### Metadata JSON keys observed (ingest contract)

| source_type | metadata keys |
|-------------|---------------|
| listing | `listing_type`, `is_active`, `seller_user_id` (public) |
| listing_revision | `listing_id`, `editor_user_id` |
| obo_offer_summary | `listing_id`, `role`, `status`, `amount_cents` |
| notification | `event_type`, `channel`, `status` only — **no `listing_id`/`record_id`** |
| record | `format`, `record_grade`, `sleeve_grade` |
| auction_bid_summary | `listing_id`, `bid_count`, `current_bid_cents` |

### Gaps identified (Phase A)

1. **`notification`** — payload `listing_id`/`record_id` appear in normalized text but **not in `metadata` JSON**, blocking entity parity with listing/record/OBO paths.
2. **`listing` / `record` / `obo_offer_summary`** — no redundant `listing_id`/`record_id`/`offer_id` metadata keys; entity parity relies on `source_type:source_id` unless diagnostics alias (Phase C).
3. **Low embed coverage** on `listing` (20%), `listing_revision` (15%), `notification` (1.4%) — separate from metadata; rollout still blocked on coverage.

---

## Phase B — Benchmark parity audit

**Command:**

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh
```

**Pre-patch artifact:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-114959.jsonl`  
**Post-patch artifact:** `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-115834.jsonl`

### Aggregate parity (post-patch, deployed)

| Metric | Value |
|--------|------:|
| Zero chunk-overlap | **11/16** |
| Doc-overlap >0 | **5/16** |
| Entity-overlap >0 | **5/16** |
| Embed timeouts | **0** |
| Insufficient-metadata runs | **1/16** (notification query) |

### Classification distribution (zero-overlap runs)

| Classification | Count |
|----------------|------:|
| `shadow_complementary_but_different` | 8 |
| `source_type_mismatch` | 2 |
| `same_source_type_different_chunks` | 1 |

### 16-run parity table (post-patch)

| # | Mode | Profile | Prompt | Keyword types | Shadow types | Chunk | Doc | Entity | Missing metadata | Classification |
|---|------|---------|--------|---------------|--------------|------:|----:|-------:|------------------|----------------|
| 1 | shadow_default | seller_sales_summary | Latest offers received… | listing×7, revision×1 | listing×5, obo×3 | 0 | 0 | 0 | — | complementary |
| 2 | shadow_obo_owner | obo_helper | Latest offers received… | listing×7, revision×1 | listing×2, obo×6 | 0 | 0 | 0 | — | complementary |
| 3 | shadow_default | obo_helper | OBO activity summary… | listing×8 | listing×2, obo×6 | 0 | 0 | 0 | — | complementary |
| 4 | shadow_obo_owner | obo_helper | OBO activity summary… | listing×8 | listing×2, obo×6 | 0 | 0 | 0 | — | complementary |
| 5 | shadow_default | seller_sales_summary | Pricing/revision changes… | obo×8 | listing×5, revision×3 | 0 | 0 | 0 | no shared source_type | source_type_mismatch |
| 6 | shadow_obo_owner | obo_helper | Pricing/revision changes… | obo×8 | listing×2, obo×6 | 3 | 3 | 9 | — | overlap_present |
| 7 | shadow_default | seller_sales_summary | Listing activity / buyer interest… | listing×6, revision×2 | listing×8 | 0 | 0 | 0 | — | same_type_different_chunks |
| 8 | shadow_obo_owner | obo_helper | Listing activity / buyer interest… | listing×6, revision×2 | listing×2, obo×6 | 0 | 0 | 0 | — | complementary |
| 9 | shadow_default | seller_sales_summary | Notifications matter most… | obo×8 | listing×6, notification×2 | 0 | 0 | 0 | notification metadata gap | source_type_mismatch |
| 10 | shadow_obo_owner | obo_helper | Notifications matter most… | obo×8 | listing×2, obo×6 | 1 | 1 | 3 | — | overlap_present |
| 11 | shadow_default | seller_sales_summary | Bidding and offer activity… | obo×8 | listing×5, obo×3 | 1 | 1 | 3 | — | overlap_present |
| 12 | shadow_obo_owner | obo_helper | Bidding and offer activity… | obo×8 | listing×2, obo×6 | 2 | 2 | 5 | — | overlap_present |
| 13 | shadow_default | seller_sales_summary | Listing revisions / conversion… | obo×8 | listing×2, revision×3, obo×3 | 0 | 0 | 0 | — | complementary |
| 14 | shadow_obo_owner | obo_helper | Listing revisions / conversion… | obo×8 | listing×2, obo×6 | 2 | 2 | 5 | — | overlap_present |
| 15 | shadow_default | seller_sales_summary | Private seller negotiation… | listing×8 | listing×5, obo×3 | 0 | 0 | 0 | — | complementary |
| 16 | shadow_obo_owner | obo_helper | Private seller negotiation… | listing×8 | listing×2, obo×6 | 0 | 0 | 0 | — | complementary |

---

## Phase C — Diagnostics patch (justified)

### Change

`services/python-ai-service/app/ai/rag_retrieval.py` — alias canonical entity-id fields from `source_id` for parity diagnostics only:

| source_type | alias added |
|-------------|-------------|
| `listing` | `listing_id:{source_id}` |
| `record` | `record_id:{source_id}` |
| `obo_offer_summary` | `offer_id:{source_id}` |

Keyword retrieval, ranking, and ingest **unchanged**.

### Before / after (benchmark aggregates)

| Metric | Pre-patch (114959) | Post-patch (115834) |
|--------|-------------------:|--------------------:|
| Zero chunk-overlap | 11/16 | 11/16 |
| Doc-overlap >0 | 5/16 | 5/16 |
| Entity-overlap >0 | 5/16 | 5/16 |

Unit test proves alias works when keyword listing `source_id` matches OBO `listing_id` metadata. Live run unchanged because complementary zeros select **different listings**, not because alias is ineffective.

### Not patched (deferred)

- **`normalizeNotification`** metadata — requires ingest change + bounded reindex for notifications; recommend separate ticket.
- **Readiness gate metric** — recommend replacing chunk-id-only overlap FAIL with doc/entity parity thresholds in reporting (no code in this ticket).

---

## Validation

| Check | Result |
|-------|--------|
| Tests | **120 passed**, 91.25% line coverage |
| enforce-service-coverage | **PASS** |
| RAG contract | **PASS** |
| quality smoke | **PASS** |
| runtime contract | **PASS** |
| endpoints contract | **PASS** |
| provider readiness | **PASS** |
| pgvector readiness | **PASS** |
| OCH scan | **PASS** |

---

## Recommendation

| Question | Answer |
|----------|--------|
| Metadata patch needed? | **Yes** — notification ingest should add `listing_id`/`record_id` from payload; diagnostics alias patch is done |
| Ranking patch needed? | **No** |
| Bounded tranche? | **Hold** — coverage still ~7.6%; metadata repair does not require new embed tranche |
| Readiness reporting | **Replace chunk-only overlap gate** with doc/entity parity + complementary classification (per T20.10J/T20.10K) |
| Vector rollout | **NOT APPROVED** |

### Next ticket

**T20.10L** (proposed): notification metadata normalization at ingest + readiness gate update to doc/entity parity metrics (no ranking changes).

---

## Files changed (local, uncommitted)

- `services/python-ai-service/app/ai/rag_retrieval.py` — entity-id alias for diagnostics
- `services/python-ai-service/tests/test_shadow_diagnostics.py` — alias unit test
- `docs/ai-platform/T20-10K-metadata-entity-linking-parity.md` — this document

**Not committed:** benchmark artifacts under `bench_logs/`
