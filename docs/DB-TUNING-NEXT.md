## Record Platform DB Tuning – Handoff Notes

**Date:** 2025-11-14  
**Owner:** Cursor agent handoff

-### Current State (2025-11-15)
- Postgres pod `postgres-bdd459cf4-wftqs`, version 16.10.
- Rehydrated from `backups/records_final_20251113_060218.tar.gz`. New helper `./scripts/rehydrate-and-tune.sh` now automates the full sequence (`restore-run.sh` + all tuning scripts + cache warmers + `run_pgbench_sweep.sh`) so the next agent can run one command.
- Dataset: 1.20 M rows, all under hot tenant `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`. `records_hot` contains 110 k rows and the `records_hot.sync_hot()` triggers are active (still hard-coded to that UUID).
- All GiN/GiST TRGM indexes (artist/name/label/catalog/search_norm, user+search composites, hot-slice indexes) rebuilt; extensions (`pg_trgm`, `btree_gist`, `unaccent`, `pgcrypto`, `citext`) confirmed present.
- Planner knobs (`random_page_cost=1.1`, `cpu_*`, `work_mem` up to 128 MB, `track_io_timing=on`, parallel worker caps, search_path) enforced at DB level; cache warmers and prewarm steps complete.
- Benchmark script continues to log metrics to CSV even when `bench.results` rejects the insert.

Latest 64-client TRGM sweep (2025-11-14 19:04 UTC, `bench_sweep_20251114_190415.csv`) still tops out at **~891 TPS**, avg latency ~70 ms, so we remain far from the historical run.

### Target (Reference Run from 2025-11-13)
- scaling factor: 1
- query mode: prepared
- clients: 64, threads: 12, duration: 60 s
- transactions processed: 1,682,715; TPS ≈ 28,033 (without initial connection time)
- latency avg ≈ 1.522 ms, stddev ≈ 2.527 ms
- `bench_sweep_20251113_034029.csv` / `bench_export_20251113_034029.csv` capture the full metric set—use them as the gold standard. User expects to see the exact stats above (1.522 ms avg latency, 28 k TPS, 1.68 M xacts).

### Outstanding Work
1. **Re-run pgbench sweep + keep artifacts.** Latest (2025-11-14 19:04 UTC) still ~891 TPS. Keep running `./scripts/run_pgbench_sweep.sh`, archive CSVs, and compare each line item to `bench_sweep_20251113_034029.csv` until stats align.
2. **Plan analysis.** Capture `EXPLAIN (ANALYZE, BUFFERS)` for both `bench_trgm.sql` and `bench_knn.sql` (hot tenant, `SET enable_seqscan=off`, `random_page_cost=1.0`). Confirm TRGM uses the search_norm indexes and KNN hits the hot-slice GiST index.
3. **`pg_stat_statements` diff.** Snapshot before/after each sweep. Compare total_exec_time and IO to the 11/13 run to pinpoint regressions.
4. **bench.results insert failure.** Script still logs “bench.results empty or unavailable.” Tail Postgres logs during the sweep to see the actual error (likely numeric NULLs or FK) and fix so DB history populates again.
5. **Hot slice targeting for KNN.** The pgbench KNN query currently scans the parent table; consider pointing it at `records_hot.records_hot` (or creating a view) so the 110 k slice + GiST index actually limit work.
6. **Warm cache script cleanup.** `scripts/warm_cache.sh` still kills the records-service port-forward when the service exits—harmless but noisy. Optional: swap to `kubectl exec` or trap the PF PID more cleanly.
7. **Backups / configs.** Keep `backups/records_final_20251113_060218.tar.gz` staged; if another restore is needed, repeat `./scripts/restore-run.sh records` then the tuning sequence above.
8. **GRPC ingress verification.** After DB throughput hits the 28 k TPS baseline, rerun HTTP/2 + HTTP/3 smoke tests (docs/GRPC-HTTP2-IMPLEMENTATION.md) so the rest of the platform work stays unblocked.

-### Useful Commands/Scripts
- Full rehydrate + tuning pipeline: `./scripts/rehydrate-and-tune.sh`
- Rebuild hot table: `./scripts/dbpack.sh --ensure-app --prep-hot --prewarm`
- Warm caches: `./scripts/warm_cache.sh`
- Run benchmark: `./scripts/run_pgbench_sweep.sh`
- Inspect backups: `ls -lh backups`, `tar -tzf backups/records_optimized_20251113_053844.tar.gz`
- Check hot counts: `SELECT COUNT(*) FROM records_hot.records_hot;`

Ping the user before running long sweeps—they may want to watch the TPS in real time.***

### Quick verification checklist after any restore
- `SELECT COUNT(*) FROM records.records;` → 1 200 000.
- `SELECT COUNT(*) FROM records_hot.records_hot;` → 110 000.
- `EXPLAIN (ANALYZE, BUFFERS)` for TRGM & KNN queries with `SET enable_seqscan=off; SET random_page_cost=1.0; SET work_mem='256MB';` (store the output under `docs/bench/explains/` for future comparison).
- `SHOW random_page_cost; SHOW cpu_index_tuple_cost; SHOW shared_buffers; SHOW work_mem;` (should read 1.1 / 0.0005 / 1GB / ≥64 MB).
- `./scripts/run_pgbench_sweep.sh` should emit fresh CSVs and trend toward the 2025‑11‑13 metrics (28 k TPS, 1.5 ms avg latency).***

### Protocol / Observability Context
- **gRPC & HTTP/2**: Auth and Records services now expose gRPC servers with TLS+ALPN=h2, API Gateway speaks gRPC via `@common/utils/grpc-clients`, and Kubernetes ingress annotations (`backend-protocol: "GRPC"`, `server-snippets: http2 on; alpn h2;`) are in place. Logging middleware records method+latency/status. Remaining gap: rerun the HTTP/2 + HTTP/3 smoke tests (`scripts/test-microservices-http2-http3.sh`) after DB throughput is stable.
- **Strict TLS / Caddy**: Deployment uses Caddy 2.8 (strict TLS, ALPN h2/h3). Ensure cert bundle (internal CA) stays in sync with gRPC clients—`buildCredentials()` handles CA overrides via env vars.
- **Observability stack**: Prometheus/Grafana/OTel/Jaeger manifests exist but need revalidation post-gRPC migration. Mesh (Istio/Linkerd) is partially configured; once HTTP/2/3 tests pass, finish wiring sidecars + tracing exporters so we can trace gRPC calls end-to-end while tuning DB.

