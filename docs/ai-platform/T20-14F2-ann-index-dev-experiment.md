# T20.14F2 — ANN index dev experiment

**Status:** Local/dev experiment complete  
**Generated:** 2026-06-28  
**Baseline SHA:** `5724437` (T20.14F design)  
**Scope:** HNSW partial index on local `python_ai` @ port 5440 only — no production rollout

---

## Executive summary

Created the recommended HNSW partial index (`vector_cosine_ops`, `m=16`, `ef_construction=64`) on local/dev `python_ai` after backup. EXPLAIN confirms planner switched from **Seq Scan + Sort** (~3852 ms) to **HNSW Index Scan** (~44 ms) on the canonical `<=> LIMIT 8` probe.

Three warm shadow timing runs show **candidate_fetch p95 well under the 1500 ms gate** on all runs (557 / 205 / 532 ms). Shadow p95 also improved materially vs T20.14A/T20.14E non-cache runs (1494 / 376 / 1317 ms). Embed timeouts **0/3**; contracts, Playwright, and product telemetry **PASS**.

Two shadow runs per benchmark still report **true zero-result after fetch** (2/16) — overlap `one_path_empty` on notification/catalog queries, unchanged overlap profile vs T20.14E; fetch attempted on all 16/16. Not treated as ANN regression.

```text
ANN experiment: candidate_fetch gate PASS
Recommended next: T20.14G overlap v2 design, then T20.14H 5-run stability

Vector rollout: NOT APPROVED
T20.15: BLOCKED
```

---

## Preflight

| Item | Value |
| ---- | ----- |
| backup path | `backups/t20-14f2-pre-hnsw/python_ai.dump` (41 MB, not committed) |
| pgvector version | **0.8.2** |
| total chunks | 73,043 |
| embedded count | **10,065** (unchanged vs T20.14F) |
| index before | none (no HNSW/IVFFlat on `embedding_vec`) |
| index after | **HNSW present** — `ai_document_chunks_embedding_vec_hnsw_idx` |
| index size | **25 MB** |
| cluster DB wiring | `python-ai-service` → `host.docker.internal:5440/python_ai` (same DB as local index) |

### Embedded chunks by source_type

| source_type | count |
| ----------- | ----: |
| listing | 4024 |
| listing_revision | 2100 |
| notification | 1550 |
| obo_offer_summary | 1544 |
| record | 594 |
| auction_bid_summary | 253 |

---

## EXPLAIN before/after

### Pre-index (manual probe, before `CREATE INDEX`)

```text
Limit → Sort (embedding_vec <=> $0) → Seq Scan on ai_document_chunks
  Filter: embedding_vec IS NOT NULL
  Rows: 10,065 embedded scanned
Execution Time: 3851.628 ms
```

- **HNSW used:** No  
- **Dominant cost:** full sort over all embedded rows

Pre-index diagnostic artifact: `bench_logs/ai-platform/t20-10u-pgvector-candidate-fetch-20260628-185743.md` (diagnosis: scan/sort dominated, no ANN).

### Post-index (`SET hnsw.ef_search = 40`)

```text
Limit → Index Scan using ai_document_chunks_embedding_vec_hnsw_idx
  Order By: (embedding_vec <=> $0)
  Filter: embedding_vec IS NOT NULL (partial index predicate)
Execution Time: 43.595 ms
```

- **HNSW used:** **Yes**  
- **Query time delta:** ~3852 ms → ~44 ms (~**88×** faster on probe)  
- Post-index diagnostic artifact: `bench_logs/ai-platform/t20-10u-pgvector-candidate-fetch-20260628-185809.md` (plan signals show HNSW index scans on global/scoped fetches)

### Index DDL applied

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_document_chunks_embedding_vec_hnsw_idx
ON ai.ai_document_chunks
USING hnsw (embedding_vec vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding_vec IS NOT NULL;

ANALYZE ai.ai_document_chunks;
```

---

## Timing table

| Metric | T20.14A | T20.14E run 1 | T20.14E run 2 | F2 run 1 | F2 run 2 | F2 run 3 | Verdict |
| ------ | ------: | ------------: | ------------: | -------: | -------: | -------: | ------- |
| shadow p95 (ms) | 9066 | 5986 | 6400 | **1493.5** | **376.2** | **1316.5** | **PASS** |
| candidate_fetch p95 (ms) | 4671 | 2066 | 3937 | **557.2** | **204.8** | **532.2** | **PASS** |
| embed p95 (ms) | 5321 | 3611 | 3264 | 867.2 | 8.2 | 5.5 | **WARN** (run 1 cold embed; runs 2–3 cache-hot) |
| embed timeouts | 1 | 0 | 0 | 0 | 0 | 0 | **PASS** |
| true zero-results | 1/16 | 0/16 | 0/16 | 2/16 | 2/16 | 2/16 | **FAIL** (overlap `one_path_empty`; fetch 16/16) |
| source diagnostic | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| product telemetry WARNs | 1 | 0 | 0 | 0 | 0 | 0 | **PASS** |

### F2 run artifacts (local only)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-185845.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-185948.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-190020.md` |

### Zero-result note

All three F2 runs report **2/16** true zero-result after fetch on `shadow_default` paths for notification/catalog queries (`one_path_empty` overlap reason). `shadow_fetch_attempted` remains **16/16**; no embed timeouts. This matches pre-existing overlap sparsity (11/16 zero-overlap unchanged) rather than index failure.

---

## Contract and product validation

| Check | Result |
| ----- | ------ |
| `rp-ai-shadow-source-diagnostic.sh` | PASS |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |
| Seller intelligence Playwright | PASS 4/4 |
| Record intelligence Playwright | PASS 7/7 avg 3.86 |
| Longform session Playwright | PASS 12/12 avg 3.67 |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

Keyword retrieval remains default; no vector default, overlap flags, or Phase 21 product behavior changes.

---

## Decision

**candidate_fetch gate:** All three F2 runs have cf p95 **≤ 1500 ms** (557 / 205 / 532 ms vs gate 1500 ms and T20.14E runs 1–2 at 2066 / 3937 ms).

```text
ANN experiment: candidate_fetch gate PASS
Recommended next: T20.14G overlap v2 design, then T20.14H 5-run stability
```

Outstanding before rollout approval:

- Resolve/document **true zero-result** overlap cases (2/16) in T20.14G
- **T20.14H** 5-run stability on non-cache tail after overlap design
- Index remains **local/dev only** until explicit ops approval for staging/prod

Regardless:

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
```

---

## Rollback command

Do not execute unless experiment regresses or explicitly requested:

```sql
DROP INDEX CONCURRENTLY IF EXISTS ai.ai_document_chunks_embedding_vec_hnsw_idx;
```

Restore from backup if needed:

```bash
pg_restore -h 127.0.0.1 -p 5440 -U postgres -d python_ai \
  --clean --if-exists backups/t20-14f2-pre-hnsw/python_ai.dump
```

---

## Hard rules observed

- No vector/hybrid production default
- No T20.15, embedding tranches, or default-on overlap flags
- No keyword retrieval or Phase 21 synthesis changes
- Backup and bench artifacts not committed
