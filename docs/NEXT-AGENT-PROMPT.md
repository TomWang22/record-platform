## Next Agent Briefing (2025-11-15)

### Snapshot
- **Repo**: `record-platform` (root `/Users/tom/record-platform`).
- **Cluster**: namespace `record-platform`, Postgres pod `postgres-bdd459cf4-wftqs`.
- **Data**: Restored from `backups/records_final_20251113_060218.tar.gz` (1.20 M total rows, 110 k hot slice under tenant `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`).
- **Pipeline helper**: `./scripts/rehydrate-and-tune.sh` runs the entire “restore + tuning + warmup + pgbench sweep” flow and now copies CSV artifacts into `docs/bench/sweeps/`.

### Current Status
- All DB tuning scripts executed; caches warmed; hot slice triggers active.
- Latest pgbench sweep (`bench_sweep_20251114_190415.csv`) still peaks around **~900 TPS** (TRGM 64-clients). Goal remains the historical **28 k TPS** run (`bench_sweep_20251113_034029.csv`).
- `bench.results` table exists but stays empty after sweeps; script logs “bench.results empty … using local sweep data.”
- `pg_stat_statements` extension is **not** loaded (`must be in shared_preload_libraries`). Need to patch the Postgres deployment + restart before we can capture top query deltas.
- gRPC/HTTP/2 stack is live (auth/records services + API Gateway). Ingress annotations advertise ALPN h2; Caddy 2.8 enforces strict TLS. HTTP/2+HTTP/3 verification script still needs to be re-run after DB tuning stabilizes.
- Observability components (Prometheus, Grafana, OpenTelemetry, Jaeger, Istio/Linkerd) are partially configured but unvalidated since the gRPC migration.

### High-Priority Tasks
1. **DB Throughput**
   - Capture `EXPLAIN (ANALYZE, BUFFERS)` for both `bench_trgm.sql` and `bench_knn.sql` (with `SET enable_seqscan=off; SET random_page_cost=1.0; SET work_mem='256MB';`) and store them under `docs/bench/explains/<timestamp>/`.
   - Retarget the KNN workload to `records_hot.records_hot` (or introduce a view) so the GiST hot-slice index is used instead of scanning the cold parent.
   - Investigate why `bench.results` inserts no-op. Table is empty; `INSERT` works manually, so the sweep’s `ON CONFLICT` clause or parameter coercion is likely swallowing every row.
   - Enable `pg_stat_statements` by adding it to `shared_preload_libraries` in the Postgres config (and redeploy). Capture before/after snapshots once it’s live.
2. **Protocol Verification**
   - Run `./scripts/test-microservices-http2-http3.sh` (and the manual `curl --http2-prior-knowledge` / `curl --http3-only` commands) to confirm ALPN negotiation has no regressions after the DB work.
3. **Observability**
   - Re-validate Prometheus scrapes, Grafana dashboards, OpenTelemetry exporters, and Jaeger traces now that services speak gRPC.
   - Finish wiring the service mesh sidecars (Istio/Linkerd) once the HTTP/2 tests pass.

### Useful Commands
- Full pipeline: `./scripts/rehydrate-and-tune.sh`
- Manual rehydrate only: `./scripts/restore-run.sh records` (expects bundle at `/tmp/pg_bundle.pkg`)
- Cache + hot slice prep: `./scripts/warm_cache.sh`, `./scripts/dbpack.sh --ensure-app --prep-hot --prewarm`
- Benchmark: `./scripts/run_pgbench_sweep.sh`
- HTTP/2/3 tests: `./scripts/test-microservices-http2-http3.sh`
- Ingress manifests: `infra/k8s/overlays/dev/ingress*.yaml` (look for `backend-protocol: "GRPC"` and `server-snippets`)

### Reminders
- Ping the user before running long pgbench sweeps—they often want to watch TPS live.
- Keep backups handy: `backups/records_final_20251113_060218.*` is the known-good dataset. Use the helper script to avoid mistakes.
- After any restore, run through the verification checklist in `docs/DB-TUNING-NEXT.md` (row counts, EXPLAINS, SHOW settings, benchmark delta).

