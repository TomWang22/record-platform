# T20.14F — ANN index ops design

**Status:** Design complete — **no index created**  
**Generated:** 2026-06-28  
**Baseline SHA:** `236d623`  
**Prior work:** T20.14D (embed retry + fetch trim), T20.14E (3-run re-eval)

---

## Executive summary

T20.14D fixed shadow **observability** (embed timeouts 0, true zero-results 0) and trimmed fetch fanout, but **candidate_fetch p95 remains above 1500 ms** on non-cache warm runs. EXPLAIN baselines confirm **exact pgvector sort** over ~10k embedded rows with **no ANN index**.

**Recommendation:** first ops experiment uses **HNSW** with **`vector_cosine_ops`** on `embedding_vec` (partial: `WHERE embedding_vec IS NOT NULL`), matching the production query operator `<=>`. IVFFlat is a fallback only if HNSW build/memory is unacceptable.

```text
T20.14F ANN index ops design: COMPLETE
Index creation: NOT APPROVED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14F2 ANN index dev experiment with backup, only if explicitly approved
```

---

## 1. Current candidate_fetch problem

### Latency gate table

| Metric | Current | Target | Status |
| ------ | ------: | -----: | ------ |
| candidate_fetch p95 T20.14A | 4671 ms | ≤1500 ms | **FAIL** |
| candidate_fetch p95 T20.14E run 1 | 2066 ms | ≤1500 ms | **FAIL** |
| candidate_fetch p95 T20.14E run 2 | 3937 ms | ≤1500 ms | **FAIL** |
| candidate_fetch p95 T20.14E run 3 | 616 ms | ≤1500 ms | **PASS** (embed cache-hot; not representative alone) |
| shadow p95 T20.14E runs 1–2 | 5986–6400 ms | ≤3000 ms | **FAIL** |
| embedded chunks | **10,065** | — | info |
| total chunk rows | 73,043 | — | info |
| current ANN index on `embedding_vec` | **none** | required | **FAIL** |

### Root cause (read-only EXPLAIN, T20.10U @ T20.14A)

Shadow retrieval in `rag_retrieval.py` executes:

```sql
ORDER BY c.embedding_vec <=> $query_vec::vector ASC
LIMIT N
```

with visibility join to `ai_documents`. Current plans show:

| Fetch pattern | Plan shape | Dominant cost |
| ------------- | ---------- | ------------- |
| Global pool (LIMIT 16–24 post-D) | `Parallel Index Scan` → **`Gather Merge` → `Sort`** on `<=>` | Exact sort ~1900 embedded rows/worker |
| Typed OBO fetch (LIMIT 8) | `Index Scan` on `source_type` → nested loop → **`Sort`** on `<=>` | Sort within type (~28–465 docs) |
| Typed listing fetch | Same pattern | Sort within listing subset |

**No `Index Scan using ... hnsw` or `ivfflat`** appears. Each shadow query may run **multiple** typed fetches plus optional global fetch (T20.14D caps global at `max_chunks*2`).

### Why T20.14D alone is insufficient

| T20.14D change | Effect on cf |
| -------------- | ------------ |
| Embed retry / classification | Observability only |
| Global LIMIT `*3` → `*2` | ~15–30% reduction on global fetch; tail still sorts thousands of rows |
| Typed-first skip / listing dedupe | Fewer redundant fetches; each remaining fetch still exact-sort |

Run 3 PASS (616 ms cf p95) reflects **embed cache + warm DB**, not durable cf SLO.

---

## 2. Database baseline (read-only, 2026-06-28)

Captured via `scripts/lib/rp-python-ai-psql.sh` against local `python_ai` @ port 5440.

| Item | Value |
| ---- | ----- |
| pgvector extension | **vector 0.8.2** |
| Column | `embedding_vec vector(768)` nullable (`infra/db/11-ai-rag-embedding-vec.sql`) |
| Embedded rows | **10,065** |
| Total chunk rows | 73,043 |
| Table size | **80 MB** total / **31 MB** heap |
| Query operator | `<=>` (cosine distance) in `_fetch_vector_rows` |

### Embedded distribution by source_type

| source_type | embedded chunks |
| ----------- | ---------------: |
| listing | 4024 |
| listing_revision | 2100 |
| notification | 1550 |
| obo_offer_summary | 1544 |
| record | 594 |
| auction_bid_summary | 253 |

### Existing indexes on `ai.ai_document_chunks`

| Index | Definition |
| ----- | ---------- |
| `ai_document_chunks_pkey` | btree `(id)` |
| `ai_document_chunks_doc_index_key` | UNIQUE btree `(document_id, chunk_index)` |
| `idx_ai_document_chunks_document` | btree `(document_id, chunk_index)` |

**No vector ANN index.**

---

## 3. Index candidates

### 3.1 HNSW (recommended first experiment)

| Aspect | Detail |
| ------ | ------ |
| **Syntax** | `USING hnsw (embedding_vec vector_cosine_ops)` |
| **Operator class** | **`vector_cosine_ops`** — matches `<=>` cosine distance used in queries and `(1 - (embedding_vec <=> q))` score |
| **Query compatibility** | Supports `ORDER BY embedding_vec <=> $q LIMIT k` via index scan when planner chooses HNSW |
| **Partial index** | Recommended: `WHERE embedding_vec IS NOT NULL` (10,065 rows vs 73,043 total) |
| **Build** | `CREATE INDEX CONCURRENTLY` — no long exclusive lock; build still CPU/IO heavy |
| **Build time (estimate)** | ~1–5 min at 10k×768 on dev hardware; validate in T20.14F2 |
| **Memory / disk (estimate)** | ~30–80 MB index size at m=16 (roughly 1–2× embedded vector payload); monitor `pg_relation_size` |
| **Recall knobs** | |
| `m` | Graph degree (default 16) — higher → better recall, larger index |
| `ef_construction` | Build quality (default 64) — higher → slower build, better graph |
| `hnsw.ef_search` | **Session/runtime** search breadth (default 40) — raise for recall, lower for latency |
| **Warm/cold** | No training step; index usable immediately after build |
| **Filter caveat** | Join/filter on `ai_documents` (visibility, `source_type`) may reduce index usage; partial index + typed queries still benefit per-type sorts |
| **Rollback** | `DROP INDEX CONCURRENTLY IF EXISTS ai.ai_document_chunks_embedding_vec_hnsw_idx;` |

**Pros:** No training phase; strong fit for 10k–15k corpus; pgvector 0.8.2 HNSW mature.  
**Cons:** Higher memory than IVFFlat; build cost; recall/latency tradeoff via `ef_search`.

### 3.2 IVFFlat (fallback)

| Aspect | Detail |
| ------ | ------ |
| **Syntax** | `USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = N)` |
| **lists parameter** | Rule of thumb `lists = sqrt(n)` → **~100** for n≈10,065; tune 50–200 |
| **Training** | Index build clusters existing vectors; quality depends on representative sample |
| **ANALYZE** | **Required** after build (`ANALYZE ai.ai_document_chunks`) |
| **Recall** | Probes via `ivfflat.probes` (session, default 1) — low probes = fast, lower recall |
| **Warm/cold** | Cold: first queries after build may be slower until caches warm |
| **Rollback** | `DROP INDEX CONCURRENTLY IF EXISTS ai.ai_document_chunks_embedding_vec_ivfflat_idx;` |

**Pros:** Lower memory than HNSW at scale; predictable for very large corpora.  
**Cons:** Needs lists/probes tuning; training sensitivity at 10k rows; typically worse than HNSW for small/medium n without careful tuning.

### Comparison summary

| Criterion | HNSW | IVFFlat |
| --------- | ---- | ------- |
| Corpus 10k | **Preferred** | Acceptable with tuning |
| Training step | None | Implicit at build |
| Ops complexity | Medium | Medium–high (lists/probes/ANALYZE) |
| Latency tail | Usually lower at 10k | Variable |
| Memory | Higher | Lower |
| pgvector 0.8.2 | **Supported** | **Supported** |

---

## 4. Recommended index (design only — do not run)

**First ops experiment: HNSW partial index on embedded rows only.**

Rationale:

1. Query operator is cosine (`<=>`) — **`vector_cosine_ops`** required.
2. Corpus is **10,065** embedded rows — HNSW sweet spot; IVFFlat training overhead not justified as first choice.
3. T20.14E shows cf tail **still 2–3.9s** after code trim — index targets exact-sort bottleneck directly.
4. Keyword path **does not read** `embedding_vec`; index maintenance affects write/backfill only.

**Not recommended yet:** composite indexes with `source_type` (lives on `ai_documents`); evaluate only if EXPLAIN after HNSW shows planner still sorting on typed fetches.

---

## 5. Proposed index name and DDL (DO NOT EXECUTE)

### Primary proposal

```sql
-- T20.14F2 candidate DDL — NOT APPROVED FOR EXECUTION
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_document_chunks_embedding_vec_hnsw_idx
ON ai.ai_document_chunks
USING hnsw (embedding_vec vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding_vec IS NOT NULL;
```

### Operator class confirmation

Application query (`rag_retrieval.py`):

```sql
ORDER BY c.embedding_vec <=> $vec_param::vector ASC
```

| Operator | pgvector meaning | Required opclass |
| -------- | ---------------- | ---------------- |
| `<=>` | cosine distance | **`vector_cosine_ops`** |

Do **not** use `vector_l2_ops` unless queries switch to `<->`.

### Optional session tuning for benchmark runs (T20.14F2)

```sql
SET hnsw.ef_search = 40;   -- default; try 64 if recall drops
-- or for IVFFlat fallback only:
-- SET ivfflat.probes = 10;
```

### Rollback

```sql
DROP INDEX CONCURRENTLY IF EXISTS ai.ai_document_chunks_embedding_vec_hnsw_idx;
```

Verify keyword path unchanged after drop (no dependency on index).

---

## 6. Ops preflight (required before T20.14F2)

All items must be complete before any `CREATE INDEX`:

```text
1. Fresh DB backup (local dev: documented snapshot path; prod: explicit owner approval)
2. pgvector version confirmed (currently vector 0.8.2)
3. Current index inventory captured (pg_indexes on ai.ai_document_chunks)
4. Table row counts captured (total + embedded + by source_type)
5. Disk estimate / free disk check (index ~30–80 MB + headroom at 10k rows)
6. Maintenance window OR local-only dev confirmation (no production enablement in F2 without approval)
7. Rollback command prepared and tested on paper
8. Read-only EXPLAIN baseline captured (T20.10U / rp-ai-pgvector-query-plan-diagnostic.sh)
```

### Backup command template (local dev)

```bash
# Example — run only with approval; do not commit backup files
pg_dump -h 127.0.0.1 -p 5440 -U postgres -d python_ai \
  -Fc -f "backups/rp-python-ai-pre-hnsw-$(date +%Y%m%d).dump"
```

### Baseline capture commands

```bash
bash scripts/rp-ai-pgvector-query-plan-diagnostic.sh   # read-only EXPLAIN
source scripts/lib/rp-python-ai-psql.sh
rp_python_ai_psql "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='ai' AND tablename='ai_document_chunks';"
```

---

## 7. T20.14F2 plan (not approved — do not run)

**Ticket:** `T20.14F2 — create ANN index in local/dev with backup`  
**Mode:** local/dev only unless explicit owner approval for shared/prod DB  
**Prerequisite:** T20.14F design accepted + preflight checklist signed off

### Sequence

```text
backup
  → capture pre-index EXPLAIN + index inventory + row counts
  → CREATE INDEX CONCURRENTLY (HNSW partial)
  → ANALYZE ai.ai_document_chunks   (lightweight; still run post-build)
  → capture post-index EXPLAIN (expect Index Scan using hnsw / approximate nearest neighbor)
  → 3-run warm shadow timing (BENCH_REQUIRE_OLLAMA_WARM=1)
  → contract suite + product Playwright + telemetry
  → document before/after cf p95 + shadow p95
  → rollback doc validated (DROP INDEX CONCURRENTLY if regression)
```

### T20.14F2 allowed

- Local `python_ai` DB index create/drop
- Read-only EXPLAIN before/after
- Shadow timing harness
- Docs: `T20-14F2-ann-index-dev-experiment.md`

### T20.14F2 forbidden

- Production vector default / hybrid rollout
- T20.15 canary
- Embedding tranches
- Default-on overlap flags
- Keyword retrieval changes

---

## 8. Gate after ANN experiment

To proceed beyond T20.14F2 toward T20.14G (overlap) or T20.14H (5-run stability):

| Gate | Target |
| ---- | ------ |
| candidate_fetch p95 | **≤1500 ms** on **3 warm runs** (non-cache-first) |
| shadow p95 | **Trending toward ≤3000 ms** (may still fail until embed tail addressed) |
| embed timeouts | **0** |
| true zero-results | **0** |
| keyword + product suites | **PASS** |
| leakage | **0** |
| overlap | Re-measure; T20.14G design if latency gates pass |

ANN index alone may clear **cf** gate without clearing **shadow p95** (embed variance remains). Do not approve rollout from cf improvement alone.

---

## 9. Non-goals

- No production vector rollout
- No T20.15
- No hybrid default
- No embedding tranche
- No overlap flag default-on
- No keyword path changes
- **No index creation in T20.14F**

---

## 10. Risk register

| Risk | Mitigation |
| ---- | ---------- |
| HNSW build IO spike | `CONCURRENTLY`; local/dev first; off-peak window |
| Recall drop vs exact sort | Compare shadow overlap + source diversity; tune `ef_search` |
| Planner ignores HNSW on filtered joins | EXPLAIN after index; consider partial index stats / `ANALYZE` |
| Index bloat on future backfill | Partial index; rebuild policy in ops doc |
| False confidence from cache-hot run 3 | T20.14F2 requires 3 warm runs; report all three |
| Accidental prod index | Preflight + explicit owner approval for non-local |

---

## 11. Related documents

| Doc | Purpose |
| --- | ------- |
| `T20-14C-shadow-latency-implementation-plan.md` | Latency burn-down sequence |
| `T20-14D-shadow-embed-fetch-stability.md` | Code trim implemented |
| `T20-14E-shadow-latency-3run-reeval.md` | Post-D metrics |
| `T20-14B-vector-rollout-gate-template.md` | Rollout gates |
| `T20-10U` EXPLAIN artifact | Exact-sort baseline (local bench_logs) |

---

## Final verdict

```text
T20.14F ANN index ops design: COMPLETE
Index creation: NOT APPROVED
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14F2 ANN index dev experiment with backup, only if explicitly approved
```

**Stop here.** Do not create index.
