clear# PostgreSQL GPT – Platform context (pipe this file for instant context)

Use this document to give PostgreSQL GPT full context: goals, current state, setup, data scale, plan, and how it can help.

---
## North star (what we're optimizing for)

**8 Postgres DBs (ports 5433–5440), all run in parallel;** no pgbouncer; **max_connections=800** per instance; observability on. **Records DB fuzzy-search path must go from ~200–300 TPS to ~5k+ TPS.** Evidence and tuning cover **all 8 DBs**: pgbench logs per DB, EXPLAIN (ANALYZE, BUFFERS) per schema, data summaries and schema/index layout for every DB.

---
## What we’re trying to do

- **Target**: 1k–5.1k TPS sustained on the records DB (fuzzy search path) and proportional throughput on the other 7 DBs, with observability on (Grafana, Prometheus, OTel, Jaeger).
- **Benchmarks**: pgbench sweeps (cold-first then warm) across **all 8 DBs in parallel**; k6 load tests; full test suites (auth, baseline, enhanced, adversarial, rotation, TLS/mTLS, social).
- **No pgbouncer**: Direct Postgres, `max_connections=800` per instance (500–1000 range); connections reused per client in pgbench.
- **Observability**: Kept on (1 pod each) for clean metrics; only scale down otel-collector during bench if explicitly requested (`REDUCE_OBSERVABILITY_FOR_BENCH=1`).

---

## Current situation (unacceptable)

- **Observed**: ~200–300 TPS on records (KNN/TRGM) at 8–24 clients even after tuning, cold and warm.
- **Target**: 5k+ TPS (past runs reached 5–6k at 64–96 clients with PL/pgSQL, partial FTS index, cold then warm).
- **We run cold phase first** (CHECKPOINT + DISCARD + pg_stat_reset + 2s sleep); true cold would require a Postgres restart.
- **Diagnostics**: We run `diagnose-performance-regression.sh` (records) after pgbench; **EXPLAIN (ANALYZE, BUFFERS) for all 8 DBs/schemas** in `apply-tune-and-explain-all-dbs.sh` (records, social-forum, social-messages, listings, shopping, auth, auction-monitor, analytics, python-ai) with session settings matching pgbench.
- **Unused indexes**: We drop known-unused indexes on records (and report unused on all DBs) to reduce memory pressure and planning cost; critical `*_bench` indexes are never dropped.

---

## Setup: 8 databases

| Port  | Name           | DB name        | Main schemas / use |
|-------|----------------|----------------|---------------------|
| 5433  | records        | records        | records, records_hot, bench – fuzzy search (FTS + trigram) |
| 5434  | social         | postgres       | forum, messages |
| 5435  | listings       | records        | listings |
| 5436  | shopping       | postgres       | shopping |
| 5437  | auth           | postgres       | auth |
| 5438  | auction-monitor| auction_monitor| auction_monitor |
| 5439  | analytics      | analytics      | analytics |
| 5440  | python-ai      | python_ai      | python_ai |

- **Host**: Usually `127.0.0.1` (Docker ports forwarded). `PGHOST` / `RECORDS_DB_HOST` used in scripts.
- **Tuning**: Gold defaults (`infra/db/12-apply-gold-defaults.sql`), service-specific tuning (`service-specific-tuning.sql`), KNN/trigram on records (`43-optimize-knn-trgm.sql`), listings (`optimize-listings-db.sql`). Session settings for pgbench: `jit=off`, `synchronous_commit=off`, `work_mem=32MB`, `effective_cache_size=4GB`, `random_page_cost=0.8` (or 1.1 in EXPLAIN session), etc.

---

## Data volumes (per schema)

- **How we measure**: Run `infra/db/31-data-summary.sql` per DB. Outputs: per-schema/table approx rows and total size; `pg_stat_user_tables` live/dead; total data per schema.
- **Where it’s written**: `scripts/apply-tune-and-explain-all-dbs.sh` runs the data summary for all 8 DBs → `bench_logs/explain-all-<ts>/data-summary-<name>.txt`.
- **Target scale**:
  - **Records (5433)**: 2.4M+ rows in `records.records` for meaningful bench; benchmark user `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`; partial index `idx_records_search_tsv_bench` on that user.
  - **Social (5434)**: forum posts, messages – aim for millions for heatmap/hot-tenant tuning.
  - **Listings (5435)**: catalog/listings – millions.
  - **Shopping (5436)**: orders, line items – millions.
  - **Auth (5437)**: users, sessions – scale to match.
  - **Analytics (5439), Auction-monitor (5438), Python-AI (5440)**: event/aggregate tables – populate for realistic load.

Exact row counts and sizes are in the data-summary files; pipe those plus this file for “how much data in each schema.”

---

## Plan and flow

1. **Preflight** (`scripts/run-preflight-scale-and-all-suites.sh`): Colima/k3s, scale, TLS, DB/Redis, then step 7 (suites + k6), then step 8 (all 8 pgbench sweeps).
2. **Tuning** (`scripts/apply-tune-and-explain-all-dbs.sh`): Gold defaults → content-hash → records KNN/trigram + VACUUM ANALYZE → service tuning (5434–5440) → listings optimize → **data summary** → **drop unused indexes** (records curated; report for others) → EXPLAIN (ANALYZE, BUFFERS) per DB → optional quick/full pgbench.
3. **pgbench**: All 8 run **in parallel** (PGBENCH_PARALLEL=1). Each sweep: cold phase then warm phase, client counts 8,16,24,… . Records: `run_pgbench_sweep.sh` (KNN, TRGM, NOOP variants). Others: `run_social_pgbench_sweep.sh`, etc. Logs: `$PGBENCH_LOG_DIR/<name>.log`; combined: `combined.log`.
4. **After pgbench**: One-line summary per DB (TPS, latency); `diagnose-performance-regression.sh` for records → `diagnostics-records.log`.
5. **Suites**: Auth, baseline, enhanced, adversarial, rotation, standalone, tls-mtls, social (step 7).

---

## Index strategy and unused indexes

- **Critical (never drop)**: Any index with `_bench` suffix on records (e.g. `idx_records_search_tsv_bench`, `idx_records_search_norm_gin_bench`, `idx_records_search_norm_len_bench`), plus `idx_records_search_tsv_all`, `idx_records_user_id_btree`, `ix_records_user_id_updated_at`.
- **Dropped on records** (known unused): `idx_records_partitioned_artist_trgm`, `idx_records_partitioned_name_trgm`, `idx_records_partitioned_catalog_trgm`, `ix_records_artist_trgm`, `ix_records_name_trgm`, `ix_records_catalog_trgm`. Applied in `run_pgbench_sweep.sh` and in `infra/db/45-drop-unused-indexes.sql` (run by apply-tune for records).
- **All DBs**: Unused indexes (e.g. `pg_stat_user_indexes.idx_scan = 0`, excluding PK/unique) are reported so we can drop them and reduce shared_buffers/planning cost. See `45-drop-unused-indexes.sql` report section.

---

## What PostgreSQL GPT can do

- **Explain high latency**: Given EXPLAIN (ANALYZE, BUFFERS) output (e.g. from `bench_logs/explain-all-<ts>/` or `query_plan_full_analysis_*.txt`), identify seq scans, high buffer read, plan flapping, or wrong index.
- **Suggest index changes**: Recommend new indexes, partial indexes, or drops from the unused-index report; never suggest dropping `*_bench` or PK/unique.
- **Compare to target**: Execution time target is single-digit ms (e.g. 8–20 ms) for the hot path; flag plans that exceed that.
- **Session/configuration**: Our pgbench uses the session settings above; suggest GUC or schema changes that stay within “no pgbouncer, max_connections 500–1000, observability on.”
- **Data scale**: Use data-summary files and this doc to reason about “how much data in each schema” and tuning for 7–8 figure scale.

---

## Key file locations (all 8 DBs)

- **Data summaries (all 8)**: `bench_logs/explain-all-<ts>/data-summary-<records|social|listings|shopping|auth|auction-monitor|analytics|python-ai>.txt`
- **Unused indexes (all 8)**: `bench_logs/explain-all-<ts>/unused-indexes-<name>.txt` (per DB; use to decide drops)
- **EXPLAIN (ANALYZE, BUFFERS) (all 8)**: `bench_logs/explain-all-<ts>/*.txt` — records.txt, records-count.txt, social-forum.txt, social-messages.txt, listings.txt, shopping.txt, auth.txt, auction-monitor.txt, analytics.txt, python-ai.txt (session settings match pgbench)
- **Full query plan (records)**: `bench_logs/<run>/query_plan_full_analysis_*.txt` (from run_pgbench_sweep when RUN_PLAN_DUMP=true)
- **Pgbench logs (all 8)**: `$PGBENCH_LOG_DIR/{records,social,auth,shopping,listings,analytics,auction_monitor,python_ai}.log` and `combined.log`
- **Diagnostics**: `$PGBENCH_LOG_DIR/diagnostics-records.log` after step 8
- **Tuning script**: `scripts/apply-tune-and-explain-all-dbs.sh`
- **Drop unused indexes**: `infra/db/45-drop-unused-indexes.sql`
- **Reference hardening**: `scripts/PGBENCH_HARDENING.md`

---

## Evidence pack (what to send to PostgreSQL GPT)

To get a **ranked action plan** (why TPS is capped, index/GUC changes, quick experiments), collect and send the artifacts listed in **SEND-TO-POSTGRESQL-GPT.md**. That doc defines the **full checklist for all 8 DBs**: pgbench logs per DB, EXPLAIN (ANALYZE, BUFFERS) for every schema, data summaries and schema/index layout for all 8. Fastest way:

```bash
# After a pgbench run (preflight step 8, all 8 in parallel) and optionally tuning (7.5):
./scripts/collect-pgbench-evidence.sh
# Then send: POSTGRESQL_GPT_CONTEXT.md + contents of bench_logs/evidence-pack-<ts>/
```

The script copies **all 8** pgbench logs (records.log, social.log, …), combined.log, diagnostics-records.log; **all EXPLAIN outputs** from explain-all-<ts> (records, social-forum, social-messages, listings, shopping, auth, auction-monitor, analytics, python-ai); all data-summary-*.txt and unused-indexes-*.txt; runs the requested SQL on records (pg_settings, pg_stat_bgwriter/checkpointer, table/index sizes, dead tuples); and writes a hardware/container snippet and **SEND-TO-POSTGRESQL-GPT.md** into the evidence dir. Minimum useful send: **diagnostics-records.log** + **ONE-EXPLAIN-worst-pgbench-query.txt** + this context file.

---

## One-line summary

We have **8 Postgres DBs (ports 5433–5440), all run in parallel**, no pgbouncer, max_connections=800, observability on. We run all 8 pgbench sweeps in parallel (cold then warm) and get ~200–300 TPS on records instead of the target 5k+; we drop unused indexes and run EXPLAIN/diagnostics for **all 8**. Pipe this file plus the evidence-pack (pgbench logs, EXPLAIN for all schemas, data summaries and schema/index for all 8) to PostgreSQL GPT to get actionable advice on plans, indexes, and configuration.
