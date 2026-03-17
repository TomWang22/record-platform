# Pgbench All Schemas, Hot Paths, and Hash Optimizations

## 1. Schemas per DB (pgbench coverage)

We pgbench **every schema** that holds application data so load and tuning are representative.

| DB | Port | Schemas | Pgbench script | Notes |
|----|------|---------|----------------|------|
| Records | 5433 | `records`, `records_hot`, `bench` | run_pgbench_sweep.sh | Main + hot tenant + results |
| Social | 5434 | `forum`, `messages`, `bench` | run_social_pgbench_sweep.sh | Both schemas in search_path; per-schema phases optional |
| Auth | 5437 | `auth`, `bench` | run_auth_pgbench_sweep.sh | Single schema |
| Listings | 5435 | `listings`, `bench` | run_listings_pgbench_sweep.sh | Single schema |
| Shopping | 5436 | `shopping`, `bench` | run_shopping_pgbench_sweep.sh | Single schema |
| Analytics | 5438 | `analytics`, `bench` | run_analytics_pgbench_sweep.sh | Single schema |
| Auction-monitor | 5439 | `auction_monitor`, `bench` | run_auction-monitor_pgbench_sweep.sh | Single schema |
| Python-AI | 5440 | `ai`, `bench` | run_python-ai_pgbench_sweep.sh | Single schema |

**Multi-schema DBs:** Records (records + records_hot), Social (forum + messages). The pipeline runs one sweep per DB; for social, the sweep uses `search_path=public,forum,messages` so both schemas are in the path. **Per-schema verification:** at sweep start, `run_social_pgbench_sweep.sh` runs `SELECT count(*)` on `forum.posts` and `messages.messages` and echoes the counts so both schemas are confirmed reachable; full per-schema TPS is covered by the existing `forum_post`/`forum_list`/`forum_comment` and `message_direct`/`message_group`/`message_list`/`group_list` variants. To add an explicit short phase per schema (e.g. 1 client, 1s), use `SCHEMAS=forum,messages` in the script (see script for extension points).

## 2. Heatmap: hot tenant, hot index, hot sharding

- **Hot tenant**  
  High-traffic tenant (e.g. benchmark user) gets a dedicated **hot table** so the planner and cache focus on a small subset.  
  - **Records:** `records_hot.records_hot` holds a copy of the benchmark tenant’s rows; search uses this table for the fast path (see run_pgbench_sweep.sh “Setting up hot tenant table”).

- **Hot index**  
  **Partial indexes** on the hot tenant so index size and lookup cost are minimal.  
  - **Records:** `idx_records_search_tsv_bench` (partial on `user_id = benchmark UUID`), `idx_records_search_norm_gin_bench`, etc. Queries that filter by that `user_id` use these indexes.

- **Hot sharding**  
  Partitioning or routing by tenant/user so “hot” data is isolated (e.g. by `user_id` hash or range). Records uses partial indexes and a hot table rather than physical partitions; the same idea applies elsewhere if we add tenant-scoped tables.

- **Heatmap in practice**  
  - Identify the busiest tenant(s) or time windows.  
  - Give them a hot table and/or partial indexes.  
  - Run pgbench with workload that hits that hot path (e.g. benchmark user search) so the heatmap is reflected in the benchmarks.

## 3. Hash + human-readable (all DBs)

Long text (posts, messages, notes) stays **readable** for display; we add a **hash column** for fast equality/dedup and indexing.

- **Columns:** e.g. `content_hash`, `subject_hash`, `notes_hash` (integer, from `hashtext()`).
- **Use:** `WHERE content_hash = hashtext($1)` for exact-match/dedup; keep `content`/`subject`/`notes` for UI.
- **Where applied:**  
  - Social: `forum.posts.content_hash`, `forum.comments.content_hash`, `messages.messages.content_hash` + `subject_hash`.  
  - Shopping: `shopping.wishlist.notes_hash`, `shopping.shopping_cart.notes_hash` (if notes exist).  
  - Records: `records.records.notes_hash` (if notes exist).  
  - Python-AI: already has `query_hash`.
- **Migration:** `infra/db/10-content-hash-migrations.sql`; applied by `scripts/ensure-content-hash-migrations.sh` on records (5433), social (5434), shopping (5436). Triggers keep hash columns in sync on INSERT/UPDATE.

## 4. Optimization tricks (cross-DB)

- **Hash for long text:** As above; index the hash, keep full text for humans.
- **Partial indexes:** For hot tenant or common filters (e.g. `WHERE user_id = $1`, `WHERE is_read = false`).
- **Hot table:** Copy of hot-tenant (or recent) rows for search/reads when the main table is large.
- **FTS + trigram:** Records: `search_tsv` (GIN FTS) for filter, `search_norm` (trigram) for ranking; same pattern can be reused elsewhere for search.
- **Consistent tuning:** Same GUCs across sweeps (work_mem, effective_cache_size, jit, etc.) so pgbench results are comparable; see PGBENCH_HARDENING.md.

## 5. Running the full pipeline

1. Start Colima and ensure 6443: `./scripts/colima-forward-6443.sh`
2. Run preflight (includes content-hash migrations and pgbench):  
   `COLIMA_START=1 RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee preflight-full-$(date +%Y%m%d-%H%M%S).log`
3. Preflight runs: ensure-social-migrations, ensure-content-hash-migrations (when added to preflight), then pgbench sweeps for records + social + auth + shopping + listings + analytics + auction-monitor + python-ai. Each sweep covers the schemas for that DB (and for social, both forum and messages via search_path).
