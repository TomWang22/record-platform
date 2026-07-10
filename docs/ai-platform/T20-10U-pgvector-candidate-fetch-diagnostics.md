# T20.10U — pgvector candidate-fetch EXPLAIN diagnostics

**Generated:** 2026-06-24  
**Baseline SHA:** `d78e1e4` (T20.10T benchmark hardening)  
**Mode:** read-only — no indexes, no product behavior changes  
**Vector rollout:** NOT APPROVED

## Executive summary

Candidate-fetch p95 variance is **explained by query-plan shape**, not metadata refresh or ranking changes. Shadow vector retrieval uses **exact nearest-neighbor ordering** (`ORDER BY embedding_vec <=> query`) over embedded chunks with **no ANN index** on `embedding_vec`. Postgres plans show **parallel btree scan + full sort** on distance for global fetches (~2,404 visible embedded rows for contract user). Route-mode profiles add **multiple fetches per query**, amplifying cost.

| Question | Answer |
|----------|--------|
| Dominated by pgvector scan/sort? | **Yes** — Sort on `<=>` distance; no ivfflat/hnsw index |
| Filters before or after vector ordering? | `embedding_vec IS NOT NULL` on chunks; visibility on documents; global plan sorts **before** LIMIT |
| Owner/privacy selective enough? | ~2,404 embedded rows visible (owner 1,221 + public 1,183) |
| source_type broad scans? | Global fetch scans all embedded chunks; typed fetch uses `idx_ai_documents_source_type` |
| Slow runs tied to source mix? | **Yes** — catalog/listing queries use global LIMIT 24; listing has 1,365 embedded visible |
| Read-only explanation for p95 variance? | **Full sort cost** scales with embedded corpus + multi-fetch route mode + parallel worker variance |
| Safest next ticket? | **T20.10V** profile proposal (reduce redundant fetches) — index creation requires **explicit ops approval** |

## Corpus snapshot (contract user `2ed75568-…`)

| Metric | Count |
|--------|------:|
| embedded_total (global) | 5,565 |
| embedded_visible_contract | 2,404 |

### Embedded visible by source_type

| source_type | embedded_visible |
|-------------|-----------------:|
| listing | 1,365 |
| listing_revision | 474 |
| record | 288 |
| auction_bid_summary | 253 |
| obo_offer_summary | 18 |
| notification | 6 |

### Indexes on `embedding_vec`

**NONE** — only btree indexes on `document_id` / `source_type` / `visibility`.

## Query patterns (from `rag_retrieval.py`)

Shadow candidate fetch uses `_fetch_vector_rows`:

```sql
SELECT …, (1 - (c.embedding_vec <=> $vec)) AS score
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE <visibility> AND d.source_type <> 'message' AND c.embedding_vec IS NOT NULL
  [AND d.source_type = $extra]
ORDER BY c.embedding_vec <=> $vec ASC
LIMIT $limit
```

Route mode (`obo_helper`, etc.) runs:

1. Global fetch (`limit = max_chunks * 2 or * 3`)
2. Additional per-type fetches for `vector_fetch_extra_types()` merges

`candidate_fetch` timing wraps **all** of these round-trips.

## EXPLAIN highlights

### Global shadow_default fetch (LIMIT 24)

```text
Gather Merge → Sort on (embedding_vec <=> query)
  → Parallel Index Scan on idx_ai_document_chunks_document
       Filter: embedding_vec IS NOT NULL
  → Index Scan ai_documents (visibility + source_type <> message)
```

Estimated cost ~5,218–10,280. Sorts **~4,500 row estimates** before LIMIT.

### OBO-only fetch (LIMIT 8)

```text
Sort on distance (28 rows)
  → Nested Loop
       → Index Scan idx_ai_documents_source_type (obo_offer_summary)
       → Index Scan idx_ai_document_chunks_document
```

Estimated cost ~1,178 — much smaller candidate set.

### Listing-only fetch (LIMIT 24)

Uses `idx_ai_documents_source_type` for `listing` — larger than OBO but narrower than global.

## T20.10T correlation

Top `candidate_fetch_ms` contributors (embed cache hit = true):

| Query theme | candidate_fetch_ms | Notes |
|-------------|-------------------:|-------|
| Catalog / buyer interest | 2,130–2,684 | Global fetch over listing-heavy corpus |
| Notifications | 1,684 | Global fetch; only 6 embedded notification chunks |
| Listing revisions | 1,394 | Global fetch |

When embed cache hits, **candidate_fetch dominates** total shadow latency — consistent with sort/scan cost.

## What did NOT cause variance

| Hypothesis | Evidence |
|------------|----------|
| T20.10N metadata refresh | Metadata-only; no query-plan change |
| Missing pgvector extension | Extension present; `embedding_vec vector(768)` column exists |
| rerank/select | T20.10P/T: p95 ≤60 ms |
| Privacy filter overhead | `privacy_filter` ms ≈ 0 in diagnostics |

## Script

```bash
bash scripts/rp-ai-pgvector-query-plan-diagnostic.sh
```

Writes local report: `bench_logs/ai-platform/t20-10u-pgvector-candidate-fetch-<stamp>.md` (not committed).

## Validation

| Check | Result |
|-------|--------|
| Diagnostic script | exit 0 |
| pgvector readiness | PASS |
| OCH | PASS |

## Recommendation

1. **T20.10V** — shadow profile refinement **proposal** to reduce multi-fetch merges (read-only design).
2. **Do not** create ANN indexes without explicit ops approval and rollout gate pass.
3. **Do not** enable vector default — latency + coverage gates still fail.

**Vector rollout:** NOT APPROVED
