# Observation Deck, pgbench, k6 — Handoff for Agents and Humans

This document explains **what was built**, **how it fits together**, and **how to run and extend it** so another agent or engineer can pick up the work. Target environment: **k3d 2-node** (or Colima k3s), record-platform microservices, 8 Postgres DBs, Caddy for TLS/HTTP/2/HTTP/3.

---

## 1. Architecture (high level)

- **Cluster**: k3d (2 nodes) or Colima k3s. API at `127.0.0.1:6443` (tunnel when Colima). Caddy exposes HTTPS (TCP + UDP for QUIC) via NodePort **30443** on k3d so host can run k6 and curl for HTTP/2 and HTTP/3.
- **Data plane**: API Gateway → services (auth, social, listings, shopping, analytics, auction-monitor, records, python-ai). Each service has its own **Postgres** (ports 5433–5440). No pgbouncer in bench path; `max_connections=800` per instance for tuning.
- **Observation deck**: Web UI at **`/observation-deck`** in the webapp. Data comes from **`bench_logs/preflight-results.json`** (written after full preflight). Shows **pgbench** (TPS/latency per DB via D3.js), **k6** phase logs, **protocol comparison** (HTTP/2 vs HTTP/3), and observability stack status. Same data is available via **REST** (`/api/observation-deck/data`) and **GraphQL** (`/api/graphql` with `observationDeckData`).
- **Preflight pipeline**: `run-preflight-scale-and-all-suites.sh` — scale, reissue CA/leaf, run test suites (auth, baseline, enhanced, etc.), then **step 8** runs all **8 pgbench sweeps** (records, social, auth, shopping, listings, analytics, auction_monitor, python_ai). **One packaged output folder per run**: `bench_logs/preflight-<timestamp>/` contains suite logs, per-DB pgbench logs, **EXPLAIN (ANALYZE, BUFFERS)** for all 8 DBs/schemas in `explain/`, combined pgbench log, `PREFLIGHT_SUMMARY.md`, and `preflight-results.json`. **PGBENCH_PARALLEL=1** (default) runs the 8 sweeps in parallel. After pgbench, **`apply-tune-and-explain-all-dbs.sh`** is run with **RUN_EXPLAIN_ONLY=1** and **EXPLAIN_DIR** set to the run folder so EXPLAIN output for every schema is printed and saved; then **`write-preflight-summary-md.sh`** is called so the observation deck gets the latest summary and JSON (also copied to `bench_logs/`).

---

## 2. What was done (summary for handoff)

| Area | What was done |
|------|----------------|
| **Listings pgbench** | Fixed **syntax error at ORDER** in `bench_listing_update.sql` by using a **CTE** so pgbench doesn’t split the statement. Added **ALTER for p999999_ms, p9999999_ms** on `bench.results` in listings sweep. |
| **Observation deck** | Preflight now writes **preflight-results.json** after step 8. JSON is built from **combined PGBENCH_LOG** (single file) when `PGBENCH_LOG_DIR` is not set. **SUITE_LOG_DIR** is set in preflight before step 7 so suite logs and summary share the same dir (`bench_logs/suite-logs-<timestamp>`). Deck shows pgbench (D3 bar charts), k6 logs, **protocol_comparison** (HTTP/2 vs HTTP/3), and observability summary. |
| **k6 protocol comparison** | **`scripts/load/run-k6-protocol-comparison.sh`** runs the same workload over HTTP/2 (standard k6) and HTTP/3 (xk6-http3), writes **`k6-http2-protocol.log`**, **`k6-http3-protocol.log`**, and **`protocol-comparison.json`** into `SUITE_LOG_DIR`. When **`K6_PROTOCOL_COMPARISON=1`** (default when `RUN_FULL_LOAD=1`), `run-k6-phases.sh` runs this after the main k6 phases. **`write-preflight-summary-md.sh`** includes `protocol_comparison` in the JSON when `SUITE_LOG_DIR/protocol-comparison.json` exists. |
| **Records tuning artifacts** | **`scripts/RECORDS_PGBENCH_ARTIFACTS.md`** documents: artifacts from `run_pgbench_sweep.sh` (e.g. `query_plan_full_analysis_*.txt`, `data-summary-records.txt`, `diagnostics-records.log`), **combined vs records-only logs**, SQL snippets for **pg_settings**, **pg_stat_bgwriter**, **pg_stat_checkpointer**, and **records schema/index/bloat**. **`scripts/run-records-diagnostics-sql.sh`** runs those SQL snippets against the records DB (port 5433) and writes **`bench_logs/records-diagnostics-<ts>.txt`** (or `OUT_FILE`). North star: **records fuzzy-search path ~5k+ TPS** (8 DBs parallel, no pgbouncer, observability on). |
| **Randomized pgbench** | **`PGBENCH_RANDOMIZED=1`** (default when preflight runs pgbench): records sweep adds a **random** variant that runs 5 different query strings (bench_random_q1..q5.sql) so each transaction uses a different query pattern. **`REAL_COLD_CACHE=1`**: after CHECKPOINT/DISCARD, run a heavy read to try to evict working set (best-effort; true cold needs restart). **`COLD_FIRST=1`** and **`RUN_COLD_CACHE=true`** give real cold then warm phases. |
| **Query plan + ANALYZE** | After the full **EXPLAIN (ANALYZE, BUFFERS)** block, the records sweep runs an **Analyze step**: `ANALYZE records.records; ANALYZE records_hot.records_hot;` so stats are fresh for the next runs. Plan logs go to **`query_plan_full_analysis_<timestamp>.txt`** in the run’s LOG_DIR. |
| **k6 D3 + p99 / knee** | **Protocol comparison** JSON includes **p95_ms** and **p99_ms** per protocol. Observation deck shows **D3 bar chart** for k6 (p95 and p99 latency by HTTP/2 vs HTTP/3) and **VUs** so latency vs load (knee curve) is visible. |
| **Preflight summary** | **`write-preflight-summary-md.sh`** accepts **`PGBENCH_LOG_DIR`** (per-DB logs: `records.log`, `social.log`, …) or **`PGBENCH_LOG`** (single combined file). Summary and JSON are written into the **run folder** (`PREFLIGHT_RUN_DIR`); copies go to `bench_logs/` for the observation deck. |

---

## 3. How to run (commands)

- **Full preflight (Colima)** — one-liner from repo root:
  ```bash
  COLIMA_START=1 RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 PGBENCH_PARALLEL=1 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "preflight-full-$(date +%Y%m%d-%H%M%S).log"
  ```
- **k3d 2-node**: Use **`REQUIRE_COLIMA=0`** (and ensure k3d context). Caddy reachable via NodePort **30443** for HTTP/2 and HTTP/3; see **docs/K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md** for port publishing and UDP for QUIC.
- **Suites only (no pgbench)**: `RUN_FULL_LOAD=0` or `RUN_PGBENCH=0`.
- **Observation deck data**: After a run with `RUN_PGBENCH=1`, open the webapp at **`/observation-deck`**. It reads **`bench_logs/preflight-results.json`**. To regenerate the summary from a packaged run folder:  
  `PGBENCH_LOG_DIR=bench_logs/preflight-<ts> EXPLAIN_DIR=bench_logs/preflight-<ts>/explain SUITE_LOG_DIR=bench_logs/preflight-<ts>/suite-logs BENCH_LOGS=bench_logs/preflight-<ts> ./scripts/write-preflight-summary-md.sh`

---

## 4. Where things live (paths)

| What | Path |
|------|------|
| **Packaged preflight run (all artifacts)** | **`bench_logs/preflight-<timestamp>/`** — suite-logs/, pgbench *.log, pgbench-combined.log, explain/, PREFLIGHT_SUMMARY.md, preflight-results.json, explain-all.log |
| Preflight summary (markdown) | `bench_logs/PREFLIGHT_SUMMARY.md` (latest), `bench_logs/preflight-<ts>/PREFLIGHT_SUMMARY.md` |
| Observation deck JSON | `bench_logs/preflight-results.json` (also in run folder) |
| Suite logs (k6, protocol comparison) | `bench_logs/preflight-<ts>/suite-logs/` (when preflight sets SUITE_LOG_DIR) |
| Protocol comparison | `bench_logs/preflight-<ts>/suite-logs/protocol-comparison.json`, `k6-http2-protocol.log`, `k6-http3-protocol.log` |
| pgbench logs (per-DB + combined) | `bench_logs/preflight-<ts>/records.log`, `social.log`, … `pgbench-combined.log` |
| EXPLAIN (ANALYZE, BUFFERS) all 8 DBs | `bench_logs/preflight-<ts>/explain/` (records.txt, social-forum.txt, listings.txt, …) |
| Records sweep artifacts | `bench_logs/<YYYYMMDD_HHMMSS>/` (when running `run_pgbench_sweep.sh` alone): `query_plan_full_analysis_*.txt`, `data-summary-records.txt`, `diagnostics-records.log` |
| Records diagnostics SQL output | `./scripts/run-records-diagnostics-sql.sh` → `bench_logs/records-diagnostics-<ts>.txt` (or set `OUT_FILE`) |

---

## 5. k3d 2-node specifics

- **Cluster**: Often created with **`scripts/k3d-create-2-node-cluster.sh`** (or equivalent) with **`--port 30443:30443@server:0`** and **`--port 30443:30443/udp@server:0`** so the host can reach Caddy on 30443 for both TCP (HTTP/2) and UDP (HTTP/3/QUIC).
- **Context**: `kubectl config use-context k3d-record-platform`. Preflight uses **REQUIRE_COLIMA=0** for k3d.
- **Caddy**: NodePort 30443; if only TCP is published, HTTP/3 will fail from the host; see **K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md** for fixes.

---

## 6. Observation deck (UI and API)

- **Page**: **`/observation-deck`** — shows `generated_at`, **pgbench** (D3 bar charts for TPS and latency by DB), **k6 protocol comparison** (HTTP/2 vs HTTP/3: TPS, p95, p99, VUs, plus a **D3 latency chart** for p95/p99 by protocol so the knee curve is visible), k6 phase log list, EXPLAIN dir, and observability summary.
- **Data source**: `GET /api/observation-deck/data` returns the contents of **`bench_logs/preflight-results.json`** (or fallback paths). **GraphQL** `POST /api/graphql` with `query { observationDeckData { pgbench { db tps latency_ms } k6_logs protocol_comparison observation_deck_summary } }` returns the same data. **PREFLIGHT_JSON_PATH** can override the JSON file path.

---

## 7. Records DB tuning (north star)

- **Goal**: Fuzzy-search path from ~200–300 TPS to **~5k+ TPS** (8 DBs in parallel, no pgbouncer, `max_connections=800`).
- **Artifacts to collect**: Combined pgbench log, records-specific log or records section, **diagnostics-records.log**, **query_plan_full_analysis_*.txt**, **data-summary-records.txt**, and the SQL outputs from **RECORDS_PGBENCH_ARTIFACTS.md** (pg_settings, pg_stat_bgwriter, pg_stat_checkpointer, schema/index/bloat). **`run-records-diagnostics-sql.sh`** produces one file with the main SQL outputs.
- **Single most useful**: **diagnostics-records.log** plus the worst **EXPLAIN (ANALYZE, BUFFERS)** for the slow pgbench query.

---

## 8. Optional env vars (pgbench / cold)

When preflight runs pgbench it sets: **`COLD_FIRST=1`**, **`RUN_COLD_CACHE=true`**, **`REAL_COLD_CACHE=1`**, **`PGBENCH_RANDOMIZED=1`**. To disable: **`PGBENCH_RANDOMIZED=0`** (single-query pattern), **`REAL_COLD_CACHE=0`** (no eviction step after CHECKPOINT), **`K6_PROTOCOL_COMPARISON=0`** (skip HTTP/2 vs HTTP/3 k6 run). Records sweep uses clients **8..256** in deep mode (see **`MODE=deep`**).

## 9. Optional / not yet done (for next agent)

- **More randomized patterns**: Records has 5 query strings for the **random** variant; extend to TOAST/ranked/semantic/weighted access or add randomized variants to the other 7 DB sweeps.
- **HTTP/1.1 in protocol comparison**: Currently HTTP/2 and HTTP/3; add an HTTP/1.1 run when the test target supports it and k6 (or a wrapper) can force HTTP/1.1.
- **Verify cold vs warm**: Preflight uses COLD_FIRST + RUN_COLD_CACHE + REAL_COLD_CACHE; document how to confirm cold phase actually ran (e.g. grep for "Cold phase" in the combined log).

---

## 10. Key scripts (reference)

| Script | Purpose |
|--------|---------|
| `run-preflight-scale-and-all-suites.sh` | Full pipeline: scale, reissue, suites, pgbench (step 8), then write-preflight-summary-md |
| `write-preflight-summary-md.sh` | Writes PREFLIGHT_SUMMARY.md and preflight-results.json; parses PGBENCH_LOG or PGBENCH_LOG_DIR, includes protocol_comparison from SUITE_LOG_DIR |
| `run_pgbench_sweep.sh` | Records DB pgbench (fuzzy search, etc.); writes to bench_logs/<ts>/ |
| `run_listings_pgbench_sweep.sh` | Listings pgbench; uses CTE for listing_update and ALTERs for p99999_ms, p999999_ms, p9999999_ms |
| `run-k6-phases.sh` | k6 phases (read, soak, limit, max, http3); runs run-k6-protocol-comparison.sh when K6_PROTOCOL_COMPARISON=1 |
| `run-k6-protocol-comparison.sh` | Runs HTTP/2 and HTTP/3 k6 workloads, writes protocol-comparison.json to SUITE_LOG_DIR |
| `run-records-diagnostics-sql.sh` | Runs records DB diagnostics SQL; output to OUT_FILE or bench_logs/records-diagnostics-<ts>.txt |
| `run-all-test-suites.sh` | Runs auth, baseline, enhanced, etc.; uses SUITE_LOG_DIR when set by preflight |

---

## 11. Doc references

- **Preflight how-to**: **scripts/RUN-PREFLIGHT.md**
- **Preflight and diagnostics**: **docs/PREFLIGHT_AND_DIAGNOSTICS.md**
- **k3d wire-level**: **docs/K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md**
- **Records artifacts and SQL**: **scripts/RECORDS_PGBENCH_ARTIFACTS.md**
- **Load tests catalog**: **scripts/load/LOAD_TESTS_CATALOG.md**

This handoff should be enough for another agent to run the pipeline, inspect the observation deck, collect records tuning artifacts, and continue with randomized pgbench or protocol/tuning work.
