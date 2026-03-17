# DB Load Visibility & pgbench Tuning Roadmap

This doc ties together: (1) why DB load can hang and how we fixed visibility/timeouts, (2) preflight before loading, (3) storage awareness, and (4) the full pgbench/tuning roadmap (TPS targets, cold/warm cache, EXPLAIN ANALYZE, KNN/trigram, hot tuning, no-op baseline).

---

## 1. Load script visibility and timeouts

### Why it looked like “forever” after "--- Analytics ---"

- The loader script **sources** `scripts/lib/load-db-common.sh` before any `echo`.
- With `PGSQL_VIA_DOCKER=1`, that source runs **`docker ps -q --filter "publish=5439"`** to find the container. On **macOS with Colima** (or a busy Docker daemon), **`docker ps` can block for minutes** with no output—Docker isn’t “down,” it’s just extremely slow to respond. The same happens in preflight when it runs `docker ps -q`.
- Then the first **connection** (`_psql_connect`) could also hang if the DB was unreachable.

### What we changed

- **Progress output in common loader**
  - Before resolving the container: `Finding Postgres container (port 5439, timeout 25s)...`
  - After: `Container: <name>` (or `Using cached container (port 5439): <name>` when cache is used).
  - So you see where time is spent (Docker vs connect vs queries).
- **Portable timeout for `docker ps` (no dependency on GNU `timeout`)**
  - **load-db-common.sh**: We run `docker ps` in a subshell with a **max wait** (`PG_DOCKER_PS_TIMEOUT`, default **25s**). If it doesn’t return in time, we **kill** the process and **fail** with a clear message. This works on macOS (where `timeout` is often missing) and Linux.
  - **preflight-load-dbs.sh**: Same idea with **`PREFLIGHT_DOCKER_TIMEOUT`** (default **20s**) for the initial “Docker responsive” check and for each port check. So preflight never hangs for minutes.
- **Container name cache (recover lost speed)**
  - After we resolve the container for a port once, we **cache** it in `/tmp/record-platform-pg-container-<port>` for **120s** (`PG_CONTAINER_CACHE_TTL`). The next loader (or the same script in a loop) for that port **reuses the cached name** and skips `docker ps` entirely. So the first loader may hit the 25s timeout once; subsequent loaders for the same port are instant. Set `PG_CONTAINER_CACHE_TTL=0` to disable cache.
- **Connection timeout**
  - All `psql` / `_psql_connect` use **`PGCONNECT_TIMEOUT`** (default 15s) so unreachable DBs fail fast.
- **Statement timeout on initial counts**
  - Analytics (and auction-monitor) loaders use **`SET statement_timeout = '60s'`** on initial `SELECT count(*)` so a huge table doesn’t block the script.

### What you see now when loading

1. `--- Analytics (port 5439) ---`
2. `Finding Postgres container (port 5439)...`
3. `Container: <name>`
4. `=== Load analytics DB (port 5439) ===`
5. `Connected`
6. Per-table lines: `analytics.price_snapshots: 0 (target 1000000) ...`, then `price_snapshots: 10000`, etc.

If it **times out** after “Finding Postgres container” (after 25s), Docker/Colima didn’t respond in time: **warm up Docker** by running `docker ps` once (e.g. in another terminal), then retry; or increase `PG_DOCKER_PS_TIMEOUT=45`. If it fails with a **connection error** after “Container”, the Postgres for that port isn’t accepting connections (or use `PG_CONNECT_TIMEOUT=30`). **Tip:** After starting Colima, run `docker ps` once so the daemon is warm; then load scripts and preflight are much faster.

---

## 2. When Docker is hung: load without Docker + minimal load

If **Docker/Colima is so slow that `docker ps` never returns** (or times out every time), you can still load and tune by **skipping the Docker CLI** and using **host `psql`** to connect to Postgres. The load scripts never call `docker` when **`PGSQL_VIA_DOCKER=0`**.

### Load without Docker (host psql only)

1. **Get Postgres listening on localhost:5433–5440.** Either:
   - Start containers in another terminal and wait until ports are up: `docker compose up -d` (may take a while; once it’s done, ports are reachable even if the Docker CLI is later hung), or
   - Run Postgres on the host (e.g. one instance per port, or your own setup).
2. **Run the loader with host psql (no `docker ps` / `docker exec`):**
   ```bash
   PGSQL_VIA_DOCKER=0 ./scripts/load-all-dbs-minimal.sh
   ```
   Or the full loader with small targets:
   ```bash
   PGSQL_VIA_DOCKER=0 LOAD_MINIMAL=1 ./scripts/load-all-dbs-millions.sh
   ```
   You can still skip DBs: `SKIP_RECORDS=1 SKIP_AUTH=1 ... PGSQL_VIA_DOCKER=0 ./scripts/load-all-dbs-minimal.sh`.

### Minimal / fast load (for tuning, then drain)

- **`LOAD_MINIMAL=1`** (or **`./scripts/load-all-dbs-minimal.sh`**) uses **small row targets** (tens of thousands per table) so the full run finishes in **minutes**. Use this to:
  1. **Get data loaded** quickly even when Docker is slow (with `PGSQL_VIA_DOCKER=0` if needed).
  2. **Tune hard** (pgbench, EXPLAIN ANALYZE, indexes, GUCs) and run consistently.
  3. **When tuning is done**, drain the mock data: per-service `TRUNCATE ... CASCADE` on the loaded tables, or drop schemas and re-apply migrations (`infra/db/*.sql`). Then optionally load full millions for final validation.

- To run minimal load with host psql (recommended when Docker CLI is hung):
  ```bash
  PGSQL_VIA_DOCKER=0 ./scripts/load-all-dbs-minimal.sh
  ```

---

## 3. Preflight and storage

- **Preflight script**  
  Run before loading millions of rows:

  ```bash
  ./scripts/preflight-load-dbs.sh
  ```

  It checks:

  - Docker is responsive (`docker ps`).
  - For each port in **5433–5440** (or `PREFLIGHT_PORTS`), a container is publishing that port.
  - Disk usage on the current mount: **warn ≥90%**, **refuse ≥95%** (same policy as pgbench). Skip with `SKIP_DISK_CHECK=1` if needed.

- **Storage during/after load**  
  Loading millions of rows across 8 DBs uses a lot of disk. Monitor with `df -h` and Docker/Colima disk usage. Clean up old backups and test data if you’re close to 90%.

---

## 4. pgbench tuning roadmap (all DBs)

Goals and order of work below.

### TPS and latency targets

- **Workload TPS (256 clients)**  
  **1.5k–5.1k TPS** sustained, with latency **~20 ms** (p95/p99 in that ballpark). Apply to all service DBs (records + 7 services).
- **Cold cache**  
  Same **1.5k–5.1k TPS** target under **real cold cache** (e.g. drop shared_buffers / restart / reload, then run the same workload). Cold runs are the bar for “production can take it.”
- **No-op baseline**  
  **30k TPS** for NOOP across the board. If a DB can’t reach this, tune (shared_buffers, max_connections, network, host) until it does; then retune workload and cold targets.

### EXPLAIN ANALYZE on all schemas

- Run **EXPLAIN (ANALYZE, BUFFERS)** for every representative query used in each `run_*_pgbench_sweep.sh` (records + social, listings, shopping, auth, auction-monitor, analytics, python-ai).
- Do this **per schema / per DB**, and re-run after:
  - Major data loads
  - ANALYZE / VACUUM
  - Index or GUC changes
- Use **`RUN_PLAN_DUMP=1`** in each sweep to capture plans; keep plans under a timestamped LOG_DIR (see PGBENCH_HARDENING.md and DB_TUNING_7_SERVICES.md).

### Hot tuning (all DBs)

- **Indexes**  
  B-tree, **GIST** (trigram, KNN), **partial** (hot tenant / active segment), **composite** (e.g. user_id, created_at DESC) so hot paths are index-only or index-driven.
- **Trigram / KNN**  
  Tune so **KNN and trigram** are “blazingly hot”: right GIST/opclasses, work_mem, and re-run EXPLAIN ANALYZE after tuning (see infra/db/43-optimize-knn-trgm.sql, 44-optimize-planner.sql for records; similar approach per service where applicable).
- **pg_settings**  
  Apply same discipline everywhere: jit=off, synchronous_commit=off, work_mem, effective_cache_size, random_page_cost, statement_timeout, lock_timeout, plan_cache_mode, deadlock_timeout, join_collapse_limit=1, from_collapse_limit=1 (see comprehensive-db-tuning.sql and PGBENCH_HARDENING.md).
- **Hot sharding / tenants**  
  Use **heatmap** (pg_stat_user_tables, n_live_tup / n_tup_ins / n_tup_upd) to find hot tables; add **partial indexes** and **partitioning** by tenant/shard/segment so bias (e.g. one hot tenant) doesn’t blow up latency.

### Cold vs warm cache testing

- **Cold**  
  Clear or bypass cache (e.g. restart Postgres or drop caches if safe), then run the same pgbench workload; target **1.5k–5.1k TPS**.
- **Warm**  
  Run again without clearing cache; compare TPS and latency. Document both in sweep output and regression baseline.

### Random / mixed queries

- Include **many random and mixed queries** in each sweep (different keys, tenants, time ranges) so the system is proven under realistic access patterns and not just one hot path.

### Summary checklist

| Item | Action |
|------|--------|
| TPS (256 clients) | 1.5k–5.1k TPS, ~20 ms latency |
| Cold cache | Same 1.5k–5.1k TPS |
| No-op | 30k TPS; tune until reached |
| EXPLAIN ANALYZE | All schemas/DBs, all representative queries; re-run after load/tune |
| Indexes | B-tree, GIST, partial, composite per hot path |
| KNN/trigram | Tune to “blazingly hot”; verify with EXPLAIN ANALYZE |
| pg_settings | Uniform across DBs (jit=off, sync_commit=off, work_mem, etc.) |
| Hot sharding/tenants | Heatmap + partial indexes + partitioning |
| Cold/warm | Test both; document in baseline |
| Random/mixed queries | In every sweep to prove system can take load |

See **scripts/DB_TUNING_7_SERVICES.md** and **scripts/PGBENCH_HARDENING.md** for per-service scripts, ports, and exact GUCs.
