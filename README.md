# Record Platform

Record Platform is a Kubernetes-first microservices stack for managing a personal record collection while exercising modern edge patterns. The stack spans Node.js/Express services, Prisma/Postgres data, Redis-backed caching, and a suite of observability and operational tools. The latest revamp replaces the Docker Compose dev story with Kustomize-driven Kubernetes, adds a Caddy front door that speaks HTTP/2 and HTTP/3, and ships automation scripts for day-to-day ops.

## Highlights
- **Multi-protocol edge** - Caddy terminates TLS/QUIC and forwards into nginx-ingress; HTTP/2 and HTTP/3 flows are probed via `scripts/h3-matrix.sh`.
- **Kubernetes-native workflows** - `infra/k8s` provides composable bases and overlays, with bootstrapping scripts that stand up Kind, build images, load them, and apply manifests.
- **Hardened gateway path** - API Gateway keeps the JWT guard, adds optional `DEBUG_FAKE_AUTH`, injects identity headers, and exposes detailed metrics.
- **Redis-assisted records caching** - `services/records-service/src/lib/cache.ts` adds normalized search keys, safe JSON encoding, and targeted invalidation hooks.
- **Operational tooling** - `scripts/` covers smoke tests, TLS helpers, QUIC tuning, backup/restore, load tests, and rollout automation.

## Why This Exists
I have been cataloging vinyl for a little over a year, and this codebase sits at the intersection of that hobby and a desire to level up on distributed systems and observability. The earlier Docker Compose stack was enough to track spins, but I wanted to understand how real platforms layer ingress controllers, service meshes, CI/CD-friendly manifests, and QUIC edges. Every migration choice (Caddy front door, nginx micro-cache, HAProxy fan-in, the Kustomize base/overlay split) is framed so a curious collector can trace data flow from a record search UI all the way to Postgres buffers and Grafana dashboards. The repo keeps personal workflow sharp (fast search, authenticated inserts) while remaining a playground for new infra ideas.

## System Architecture
```
Client (HTTP/3, HTTP/2, HTTP/1.1)
  |
  v
Caddy (host) -- TLS termination + mkcert CA ---> ingress-nginx (cluster)
                                             +---------------+
                                             | host: record.local
                                             +------+--------+
        / (web app) ----------------> nginx edge (8080) --> HAProxy (8081) --> API Gateway (4000)
        /api/* (direct path) -------> API Gateway (4000)
                                          |
                                          +- Auth Service (4001) -> Redis (revocations)
                                          +- Records Service (4002) -> Postgres + Redis cache
                                          +- Listings Service (4003)
                                          +- Analytics Service (4004)
                                          +- Python AI Service (5005)

Postgres (statefulset) <-> Prisma clients        Redis (statefulset) <-> JWT & cache
Prometheus Operator + Grafana <- ServiceMonitors scrape /metrics endpoints
```

`ingress-nginx` maps `/` traffic to the `nginx` edge deployment (micro-cache + rate limiting) and `/api/*` to the `api-gateway` Service. Port-forwarding `svc/nginx` gives an all-in-one entry point when you want to exercise the Nginx -> HAProxy -> Gateway chain directly. Caddy runs on the host, serves `record.local`, and forwards into the ingress controller; TLS material is generated locally (and ignored by Git) so leaf certificates can be rotated without touching history.

## Core Services
| Component | Deployment / Service | Notes |
|-----------|---------------------|-------|
| **API Gateway** | `deploy/api-gateway` -> `svc/api-gateway:4000` | Node/Express gateway; verifies JWTs, enforces rate limit, injects `x-user-*`, exports `/metrics`, and supports `DEBUG_FAKE_AUTH` for trusted developer flows. |
| **Auth Service** | `deploy/auth-service` -> `svc/auth-service:4001` | Handles register/login/logout, persists to the Postgres `auth` schema via Prisma, includes seed jobs in the dev overlay. |
| **Records Service** | `deploy/records-service` -> `svc/records-service:4002` | CRUD + search over records. Uses Redis for search caching, enforces user ownership, exports health + metrics. |
| **Listings Service** | `deploy/listings-service` -> `svc/listings-service:4003` | Public catalogue endpoints; lightweight GET workloads targeted for QUIC tuning. |
| **Analytics Service** | `deploy/analytics-service` -> `svc/analytics-service:4004` | Authenticated aggregations and stats. |
| **Python AI Service** | `deploy/python-ai-service` -> `svc/python-ai-service:5005` | Python worker invoked via the gateway; placeholder for AI/ML prototypes. |
| **Web App Edge (Nginx)** | `deploy/nginx` -> `svc/nginx:8080` | Serves static UI assets, proxies `/api` through HAProxy, and applies micro-caching / rate limits. |

## Supporting Infrastructure
- **Caddy** (`Caddyfile`, `caddy-*.yaml`) - host-side HTTP/2 + HTTP/3 front door. Mounts the local cert bundle under `/etc/caddy/certs` and trusts `certs/dev-root.pem`.
- **Ingress** (`infra/k8s/overlays/dev/ingress.yaml`) - nginx ingress controller routing for Kind. Rewrites `/api/...` to `/...` before hitting the gateway.
- **HAProxy** (`infra/k8s/base/haproxy`) - maintains keep-alive pools to the gateway, surfaces stats on `:8404`, and keeps the gateway replicas warm.
- **Postgres** (`infra/k8s/base/postgres`) - StatefulSet with init ConfigMaps and PVC. Post-init jobs populate schema, roles, and extensions.
- **Redis** (`infra/k8s/base/redis`) - StatefulSet used for JWT revocation and records cache keys.
- **Monitoring** (`infra/k8s/base/monitoring`) - ServiceMonitors targeting gateway, services, nginx, and haproxy. `infra/k8s/overlays/dev/bootstrap.sh` installs `kube-prometheus-stack`.
- **Cron Jobs** (`infra/k8s/base/cron-jobs`) - Nightly Postgres dumps, Redis snapshots, basebackups, and related secrets.

## Repository Layout
- `infra/k8s/base/*` - canonical manifests for services, data stores, ingress, monitoring, and cron jobs.
- `infra/k8s/overlays/dev/*` - dev overlay, ingress, patches, bootstrap scripts, job templates, and PVC helpers.
- `scripts/` - automation: cluster bootstrap, smoke tests, diagnostics, TLS toggles, QUIC tuning, load tests, backups, and rollouts.
- `services/` - microservice code (Node + Python). Prisma schemas and migrations live beside each service.
- `Caddyfile`, `caddy-*.yaml` - Caddy configuration and deployment manifests for the HTTP/3 edge.
- `Makefile`, `Makefile1` - convenience targets for applying manifests, running post-init jobs, smoke tests, and data imports.
- `tests-local.sh`, `verify.sh`, `inventory.txt` - sanity checks and current cluster inventory snapshots.

## Prerequisites
- Docker 24+, Kind, kubectl >=1.30, Helm >=3.13.
- mkcert (or another local CA tool) to mint and trust `record.local` certificates.
- Node 20+ and pnpm 9.x for service builds.
- Optional: `curl` with HTTP/3 support (Homebrew `curl --with-quic`) and `k6` for load tests.

## Local Development Quickstart
1. Ensure `record.local` resolves locally:
   ```bash
   echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts
   ```
2. Bootstrap (or refresh) the Kind cluster and dev overlay:
   ```bash
   ./infra/k8s/overlays/dev/bootstrap.sh
   ```
   The script verifies tooling, creates the `record-platform` Kind cluster if missing, builds `:dev` images, loads them into Kind, applies the Kustomize overlay, installs `kube-prometheus-stack`, waits for rollouts, and prints port-forward tips.
3. Iterate after the initial bootstrap with the faster dev loop:
   ```bash
   KIND_CLUSTER=h3 ./scripts/dev-up.sh
   ```
   This rebuilds service images for the cluster architecture, reloads them into Kind, reapplies the overlay, ensures the `records` database exists with extensions, re-runs seed jobs, and restarts DB-dependent deployments.
4. Validate the edge and API path:
   ```bash
   ./scripts/h3-matrix.sh          # HTTP/2 + HTTP/3 health probes
   ./scripts/smoke.sh record-platform
   ./scripts/smoke-edge.sh         # exercises nginx/haproxy/gateway chain
   ```
5. Port-forward when you need direct access:
   ```bash
   kubectl -n record-platform port-forward svc/nginx 8080:8080
   kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
   ```
   Grafana defaults to `admin/Admin123!` (see bootstrap script overrides); change it for long-lived clusters.

Seed jobs under `infra/k8s/overlays/dev/jobs` populate demo users and records. Rotate credentials before sharing a cluster.

## TLS & HTTP/3
- TLS material lives in `certs/` (`tls.crt`, `tls.key`, `dev-root.pem`, etc.) and is ignored by Git (`.gitignore:23-30`). Generate new keys with `scripts/strict-tls-bootstrap.sh` and trust `caddy-local-root.crt` locally (`security add-trusted-cert ...` on macOS).
- Caddy expects the leaf cert/key at `/etc/caddy/certs/` and the trusted CA at `/etc/caddy/ca/dev-root.pem`. Use `scripts/caddy-toggle-insecure.sh` to temporarily disable upstream verification while debugging.
- `scripts/h3-matrix.sh`, `scripts/diag-caddy-h3.sh`, and `scripts/diag-caddy-h3-extended.sh` probe HTTP/2/3 behavior, SNI routing, and upstream TLS handshakes.
- Redistribute regenerated certs out-of-band; they intentionally stay out of Git history.

## Data & Migrations
- Postgres hosts separate `auth` and `records` schemas. The current records baseline lives in `services/records-service/prisma/migrations/20251028_baseline/`.
- Apply migrations via the Postgres post-init job (`make postinit`) or directly with Prisma:
  ```bash
  pnpm -C services/records-service prisma migrate deploy
  pnpm -C services/auth-service prisma migrate deploy
  ```
- `scripts/import-sample-data.sh`, `scripts/backup-now.sh`, and `scripts/restore-from-pvc.sh` cover sample data loads, on-demand backups, and restores.
- `Makefile` targets:
  - `make apply` - apply the rendered manifest bundle in `k8s/all.yaml`.
  - `make postinit` - rerun the Postgres post-init job and stream logs.
  - `make smoke` - call `scripts/smoke.sh` for the configured namespace.
  - `make import-sample USER_ID=<uuid> N=<count>` - bulk load sample records for a user.

## Performance Benchmarks
- The `psql-inventory` job (see snippet below) creates a `bench.results` table, prewarms hot partitions, and sweeps pgbench runs over two stored search plans: `percent` (prefix filtering) and `knn` (vector KNN).
- Results are recorded in Postgres with git metadata and exported to `bench_sweep.csv` for spreadsheet review. Latency files are parsed into p50/p95/p99/p999, plus CPU share and IO deltas.
- Recent sweep (records schema warmed, 12 worker threads, 60 second windows, limit=50):
  - `percent` variant peaked at ~3.0k TPS (16 clients) with p95 ~12 ms and p99 ~13 ms before caching and kernel tuning drove p95 below 2 ms at higher client counts.
  - `knn` variant sustained ~2.6k TPS with p95 hovering 10 to 13 ms at lower concurrency and dropping to ~2 ms after buffer warmups.
  - Postgres 16.10 on arm64, `track_io_timing=on`, collected buffer hit deltas and pg_stat_io rollups for later graphing.
- The one-liner that orchestrates the sweep (truncated for brevity) is kept in `inventory.txt` for reproducibility:
  ```
  kubectl -n "$NS" exec -i psql-inventory -- bash -s <<'BASH'
  # ... creates bench schema, prewarms partitions, runs pgbench variants, upserts into bench.results,
  # and writes CSV summaries to /tmp/bench_sweep.csv plus shared volumes.
  BASH
  ```
- Sample CSV rows (2025-11-03):
  ```
  ts_utc,variant,clients,tps,p95_ms,p99_ms
  2025-11-03T20:48:43Z,percent,16,2997.227769,12.128,12.468
  2025-11-03T20:49:43Z,knn,16,2614.342007,10.794,11.053
  2025-11-03T21:12:30Z,percent,48,2728.663783,3.507,4.576
  2025-11-03T22:10:29Z,knn,32,1875.440407,3.648,3.856
  ```
- Long-form output lives in `bench_sweep.csv`; use `scripts/perf_runner.sh` or adapt the snippet to compare future schema or index experiments.

## Auth & Identity Flow
1. Clients obtain JWTs via `/api/auth/login` (Caddy -> ingress -> gateway).
2. API Gateway:
   - strips inbound `x-user-*` headers,
   - verifies the JWT and checks Redis for a revoked JTI,
   - injects `x-user-id`, `x-user-email`, and `x-user-jti`,
   - proxies to downstream services.
3. Services scope queries by the injected headers. Records service enforces ownership on every CRUD path and re-computes derived grades when media pieces update.
4. Development helper: set `DEBUG_FAKE_AUTH=1` on the gateway deployment to allow trusted curl/k6 traffic to supply `x-user-id` directly (UUID validated).

`services/records-service/src/lib/cache.ts` provides `cached`, `makeSearchKey`, and `invalidateSearchKeysForUser`. Mutations call the invalidation helper to clear search, autocomplete, facet, and price-stat caches per user.

## Observability & Diagnostics
- Prometheus/Grafana arrive via `kube-prometheus-stack`. Custom ServiceMonitors scrape gateway, services, nginx, and HAProxy `/metrics`.
- Gateway exports per-route/method/status counters; edge Nginx exposes cache hit/miss gauges; records service emits Prisma timings.
- Key scripts:
  - `scripts/verify-dev.sh` - end-to-end cluster sanity.
  - `scripts/diag-caddy.sh`, `scripts/diag-gateway.sh`, `scripts/quic-tune-kind.sh` - ingress and QUIC inspection.
  - `scripts/perf_runner.sh`, `scripts/perf_smoke.sh`, `scripts/load/k6-*.js` - load/perf harnesses.
  - `services/records-service/src/lib/singleflight_cache.lua` - Redis Lua helper for single-flight caching to prevent request stampedes.
  - `scripts/pg-connectivity-check.sh`, `scripts/run-postinit-debug-pod.sh` - database connectivity + post-init debugging.
  - `scripts/tests.sh`, `tests-local.sh` - ad-hoc regression checks.

## Maintenance & Backups
- CronJobs under `infra/k8s/base/cron-jobs` perform nightly `pg_dump`, weekly `pg_basebackup`, and Redis dumps. Secrets such as `pg-backup-pgpass.secret.yaml` and `pg-repl.secret.yaml` house credentials.
- `backups/` and `records-*.tar.gz` artifacts are produced locally and intentionally remain untracked.
- Rollout helpers (`scripts/rollout-caddy.sh`, `scripts/rollout-latest.sh`, `scripts/rollout-unstick.sh`) wrap common `kubectl` commands.
- Use `scripts/fix_pg.sh`, `scripts/debug-postinit.sh`, and `scripts/diag-caddy-h3-extended.sh` while finishing the DB repair and TLS rotation work noted in the commit message.

## Roadmap
- Finalize the DB repair plan and automate CA rotation across environments.
- Route `/api/*` through the Nginx edge by default once micro-caching + backpressure tuning is complete.
- Expand the analytics + AI services with real data pipelines (Kafka hooks live under `infra/k8s/base/kafka`).
- Harden production overlays (separate values, secrets management, external TLS provisioning).

## Contributing
- Use Node 20+ and pnpm 9.x. Install workspaces from repo root via `pnpm install`.
- Keep runtime images slim; tools like pnpm and Prisma CLI stay in the build stage.
- Update both base and overlay manifests when tweaking infrastructure; `repair-kustomize-structure.sh` can fix patch ordering if Kustomize complains.
- Add or update smoke tests (`scripts/smoke*.sh`, `scripts/tests.sh`) when changing behavior. Prefer `k6` scripts for perf regressions.
- Follow conventional commits (`type(scope): summary`) so the changelog stays readable.

## License
MIT (or customize to your needs).
