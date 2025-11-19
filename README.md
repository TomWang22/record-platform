# Record Platform

Record Platform is a production-ready Kubernetes microservices stack for managing a personal record collection while exercising modern edge patterns, gRPC inter-service communication, and multi-protocol support (HTTP/2, HTTP/3, QUIC). The stack spans Node.js/Express services with gRPC backends, Prisma/Postgres data with aggressive tuning, Redis-backed caching, and a comprehensive observability foundation.

## Highlights

### Multi-Protocol Edge & gRPC
- **HTTP/2 + HTTP/3 (QUIC)** - Caddy 2.8 terminates TLS/QUIC with strict TLS 1.2/1.3 enforcement, forwards to nginx-ingress; full end-to-end validation via `scripts/test-http2-http3-strict-tls.sh` and `scripts/test-microservices-http2-http3.sh`
- **gRPC Services** - Auth and Records services expose gRPC servers with TLS+ALPN=h2; API Gateway speaks gRPC via `@common/utils/grpc-clients`; Kubernetes ingress annotations (`backend-protocol: "GRPC"`, `server-snippets: http2 on; alpn h2;`) enable seamless protocol negotiation
- **Zero-Downtime CA Rotation** - Automated certificate rotation with continuous request monitoring (`scripts/test-full-chain-with-rotation.sh`) ensures zero-downtime during TLS updates

### PostgreSQL Tuning & Resilience
- **Production-Ready Deployment** - Postgres 16.10 with security contexts (runAsUser 70), init containers for directory prep, lifecycle hooks for database initialization, and resource limits (6Gi-12Gi memory, 500m-2000m CPU)
- **Why PostgreSQL Was Moved Out** - After 4 WAL archive incidents in 8 days and persistent crashloop issues with Kubernetes pod lifecycle management, the deployment was refactored with:
  - Proper security contexts to prevent permission issues
  - Init containers that ensure directory structure before Postgres starts
  - postStart lifecycle hooks for database initialization
  - WAL archive configuration with dedicated PVC
  - Resource limits to prevent OOM kills
- **Performance Tuning** - Aggressive planner knobs (`random_page_cost=1.1`, `cpu_*`, `work_mem` up to 128 MB), GiN/GiST TRGM indexes, hot-slice partitioning (110k rows), and comprehensive pgbench validation

### Kubernetes-Native Architecture
- **Kustomize-Driven** - Composable bases and overlays in `infra/k8s`; bootstrap scripts stand up Kind, build images, load them, and apply manifests
- **Hardened Gateway** - API Gateway with JWT guard, optional `DEBUG_FAKE_AUTH`, identity header injection, and Prometheus metrics
- **Redis-Assisted Caching** - Normalized search keys, safe JSON encoding, targeted invalidation hooks, and single-flight caching to prevent stampedes

### Modern Webapp
- **Next.js 14 App Router** - Route groups `(dashboard)` and `(public)`, Tailwind CSS + shadcn/ui design system, theme provider, and bfcache-friendly navigation
- **Full CRUD Interface** - Records management with search, create, edit, delete; marketplace radar for eBay integration; Kafka-ready messaging stream; Discogs OAuth integration
- **Service Integration** - All microservices wired up: records, listings, analytics, AI predictions, auth, and settings

## Why This Exists

I have been cataloging vinyl for a little over a year, and this codebase sits at the intersection of that hobby and a desire to level up on distributed systems, observability, and production operations. The earlier Docker Compose stack was enough to track spins, but I wanted to understand how real platforms layer ingress controllers, service meshes, gRPC inter-service communication, QUIC edges, and production-grade database tuning.

Every migration choice (Caddy front door with HTTP/3, gRPC services, PostgreSQL security contexts, Kustomize base/overlay split) is framed so a curious collector can trace data flow from a record search UI all the way to Postgres buffers, WAL archives, and Grafana dashboards. The repo keeps personal workflow sharp (fast search, authenticated inserts, marketplace integration) while remaining a playground for new infra ideas.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  (HTTP/3 QUIC, HTTP/2, HTTP/1.1)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Caddy 2.8 (Host)                             │
│  • TLS termination (strict TLS 1.2/1.3)                        │
│  • QUIC/HTTP/3 support                                          │
│  • mkcert CA with zero-downtime rotation                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              ingress-nginx (Kubernetes Cluster)                 │
│  • GRPC backend protocol                                        │
│  • ALPN negotiation (h2)                                        │
│  • Path rewriting (/api/* → /*)                                 │
└──────────────┬──────────────────────────────┬───────────────────┘
               │                              │
               ▼                              ▼
    ┌──────────────────┐          ┌──────────────────────┐
    │  Web App (Nginx) │          │    API Gateway       │
    │  Port 8080       │          │    Port 4000         │
    │  • Static assets │          │    • JWT validation  │
    │  • Micro-cache   │          │    • Rate limiting   │
    └──────────────────┘          │    • Identity inject │
                                  └──────────┬───────────┘
                                             │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
                    ▼                       ▼                       ▼
        ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
        │  Auth Service    │    │ Records Service  │    │ Listings Service │
        │  Port 4001       │    │ Port 4002        │    │ Port 4003        │
        │  • gRPC (50051)  │    │ • gRPC (50051)   │    │ • eBay API       │
        │  • JWT signing   │    │ • Prisma ORM     │    │ • Discogs OAuth  │
        └────────┬─────────┘    └────────┬─────────┘    └──────────────────┘
                 │                       │
                 │                       ▼
                 │          ┌──────────────────────────┐
                 │          │   Analytics Service      │
                 │          │   Port 4004              │
                 │          │   • Worker threads       │
                 │          │   • Price prediction     │
                 │          └──────────────────────────┘
                 │
                 │          ┌──────────────────────────┐
                 │          │   Python AI Service      │
                 │          │   Port 5005              │
                 │          │   • FastAPI              │
                 │          │   • Price trends         │
                 │          └──────────────────────────┘
                 │
                 ▼                       ▼
    ┌──────────────────────┐  ┌──────────────────────┐
    │   Redis (StatefulSet)│  │ Postgres 16.10       │
    │   • JWT revocation   │  │ (StatefulSet)        │
    │   • Search cache     │  │ • 6Gi-12Gi memory    │
    │   • Rate limiting    │  │ • WAL archive (PVC)  │
    └──────────────────────┘  │ • Hot-slice (110k)   │
                              │ • TRGM indexes       │
                              └──────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Observability (Coming Soon)                        │
│  • Prometheus + Grafana (metrics)                               │
│  • OpenTelemetry (tracing)                                      │
│  • Jaeger (distributed tracing)                                 │
│  • Istio/Linkerd (service mesh)                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Core Services

| Component | Deployment / Service | Notes |
|-----------|---------------------|-------|
| **API Gateway** | `deploy/api-gateway` -> `svc/api-gateway:4000` | Node/Express gateway; verifies JWTs, enforces rate limit, injects `x-user-*`, exports `/metrics`, supports `DEBUG_FAKE_AUTH` for trusted developer flows. **gRPC client** for Auth and Records services. |
| **Auth Service** | `deploy/auth-service` -> `svc/auth-service:4001` | Handles register/login/logout via **gRPC** (port 50051) and HTTP; persists to Postgres `auth` schema via Prisma; includes seed jobs in dev overlay. |
| **Records Service** | `deploy/records-service` -> `svc/records-service:4002` | CRUD + search over records via **gRPC** (port 50051) and HTTP. Uses Redis for search caching, enforces user ownership, exports health + metrics. |
| **Listings Service** | `deploy/listings-service` -> `svc/listings-service:4003` | Public catalogue endpoints; eBay API integration with Redis caching; Discogs OAuth 1.0 flow. |
| **Analytics Service** | `deploy/analytics-service` -> `svc/analytics-service:4004` | Authenticated aggregations; worker threads for parallel price prediction (`os.cpus().length`). |
| **Python AI Service** | `deploy/python-ai-service` -> `svc/python-ai-service:5005` | FastAPI worker for AI/ML price predictions and trend analysis. |
| **Web App** | `deploy/webapp` -> `svc/webapp:3001` | Next.js 14 App Router with Tailwind CSS; full CRUD interface, marketplace integration, Kafka-ready messaging. |

## Supporting Infrastructure

- **Caddy** (`Caddyfile`, `caddy-*.yaml`) - Host-side HTTP/2 + HTTP/3 front door. Mounts local cert bundle under `/etc/caddy/certs` and trusts `certs/dev-root.pem`. **Zero-downtime CA rotation** validated via `scripts/test-full-chain-with-rotation.sh`.
- **Ingress** (`infra/k8s/overlays/dev/ingress.yaml`, `ingress-grpc.yaml`) - nginx ingress controller with gRPC backend protocol support and ALPN negotiation.
- **Postgres** (`infra/k8s/base/postgres`) - **Production-hardened** StatefulSet with:
  - Security contexts (runAsUser 70, fsGroup 70)
  - Init containers for directory preparation
  - postStart lifecycle hooks for database initialization
  - Resource limits (6Gi-12Gi memory, 500m-2000m CPU)
  - WAL archive PVC for point-in-time recovery
  - **Moved out of basic deployment** after 4 WAL incidents in 8 days and crashloop issues
- **Redis** (`infra/k8s/base/redis`) - StatefulSet for JWT revocation and records cache keys.
- **Monitoring** (`infra/k8s/base/observability`) - ServiceMonitors targeting gateway, services, nginx, and haproxy. **Observability stack in progress**: Prometheus/Grafana/OpenTelemetry/Jaeger/Istio-Linkerd.
- **Cron Jobs** (`infra/k8s/base/cron-jobs`) - Nightly Postgres dumps, weekly `pg_basebackup`, Redis snapshots, and related secrets.

## Repository Layout

- `infra/k8s/base/*` - Canonical manifests for services, data stores, ingress, monitoring, and cron jobs.
- `infra/k8s/overlays/dev/*` - Dev overlay, ingress, patches, bootstrap scripts, job templates, and PVC helpers.
- `infra/db/*` - SQL migrations and optimization scripts (partitioning, TRGM indexes, planner tuning).
- `scripts/` - Automation: cluster bootstrap, smoke tests, diagnostics, TLS helpers, QUIC tuning, load tests, backups, rollouts, **HTTP/2/3 validation**, **CA rotation testing**.
- `services/` - Microservice code (Node + Python). Prisma schemas and migrations live beside each service. **gRPC server implementations** in `src/grpc-server.ts`.
- `webapp/` - Next.js 14 App Router application with Tailwind CSS, route groups, and full service integration.
- `proto/` - Protocol buffer definitions for gRPC services.
- `docs/` - Architecture notes, tuning guides, handoff documentation.
- `Caddyfile`, `caddy-*.yaml` - Caddy configuration and deployment manifests for HTTP/3 edge.

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
   ./scripts/test-http2-http3-strict-tls.sh      # HTTP/2 + HTTP/3 + TLS validation
   ./scripts/test-microservices-http2-http3.sh   # End-to-end gRPC + HTTP/2/3
   ./scripts/test-full-chain-with-rotation.sh    # CA rotation with zero-downtime
   ./scripts/smoke.sh record-platform
   ```

5. Port-forward when you need direct access:
   ```bash
   kubectl -n record-platform port-forward svc/webapp 3001:3001
   kubectl -n record-platform port-forward svc/api-gateway 4000:4000
   kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
   ```
   Grafana defaults to `admin/Admin123!` (see bootstrap script overrides); change it for long-lived clusters.

Seed jobs under `infra/k8s/overlays/dev/jobs` populate demo users and records. Rotate credentials before sharing a cluster.

## TLS & HTTP/3

- **TLS Material** - Lives in `certs/` (`tls.crt`, `tls.key`, `dev-root.pem`, etc.) and is ignored by Git (`.gitignore`). Generate new keys with `scripts/strict-tls-bootstrap.sh` and trust `caddy-local-root.crt` locally (`security add-trusted-cert ...` on macOS).
- **Caddy Configuration** - Expects leaf cert/key at `/etc/caddy/certs/` and trusted CA at `/etc/caddy/ca/dev-root.pem`. Use `scripts/caddy-toggle-insecure.sh` to temporarily disable upstream verification while debugging.
- **Strict TLS** - Caddy enforces TLS 1.2/1.3 only; TLS 1.1 and below are rejected. Validated via `scripts/test-http2-http3-strict-tls.sh`.
- **Zero-Downtime CA Rotation** - `scripts/rotate-ca-and-fix-tls.sh` performs certificate rotation with continuous request monitoring. `scripts/test-full-chain-with-rotation.sh` validates zero-downtime during rotation (60 requests during rotation, all should succeed).
- **HTTP/3 Testing** - `scripts/lib/http3.sh` provides `http3_curl` helper that runs curl-http3 inside the kind control-plane network namespace, bypassing Docker-for-mac UDP limitations.
- **Validation Scripts**:
  - `scripts/test-http2-http3-strict-tls.sh` - HTTP/2, HTTP/3, and strict TLS validation
  - `scripts/test-microservices-http2-http3.sh` - End-to-end microservice testing (registration, login, record creation) via HTTP/2 and HTTP/3
  - `scripts/test-full-chain-with-rotation.sh` - Full chain validation with CA rotation testing

## Data & Migrations

- **Postgres Schemas** - Hosts separate `auth` and `records` schemas. The current records baseline lives in `services/records-service/prisma/migrations/20251028_baseline/`.
- **Migrations** - Apply via the Postgres post-init job (`make postinit`) or directly with Prisma:
  ```bash
  pnpm -C services/records-service prisma migrate deploy
  pnpm -C services/auth-service prisma migrate deploy
  ```
- **Data Management** - `scripts/import-sample-data.sh`, `scripts/backup-now.sh`, `scripts/restore-from-pvc.sh`, and `scripts/rehydrate-and-tune.sh` cover sample data loads, on-demand backups, and restores.
- **Makefile Targets**:
  - `make apply` - Apply the rendered manifest bundle in `k8s/all.yaml`.
  - `make postinit` - Rerun the Postgres post-init job and stream logs.
  - `make smoke` - Call `scripts/smoke.sh` for the configured namespace.
  - `make import-sample USER_ID=<uuid> N=<count>` - Bulk load sample records for a user.

## Performance Benchmarks

### Golden Baseline (2025-11-13)

**Dataset**: 1.20 M total rows with a 110 k-row hot tenant slice (hard-coded UUID `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`).

**Configuration**:
- Scaling factor: 1
- Query mode: prepared
- Clients: 64
- Threads: 12
- Duration: 60 s
- Maximum tries: 1

**Results**:
- **Transactions processed**: 1,682,715 (zero failures)
- **TPS**: 28,033.24 (excluding initial connection time)
- **Latency average**: 1.522 ms
- **Latency stddev**: 2.527 ms
- **Initial connection time**: 31.806 ms

**Artifacts**: `bench_sweep_20251113_034029.csv` and `bench_export_20251113_034029.csv` capture the full metric set and serve as the gold standard for future tuning.

### Performance Tuning Highlights

- **Planner Optimization**: `random_page_cost=1.1`, `cpu_index_tuple_cost=0.0005`, `work_mem` up to 128 MB, `track_io_timing=on`
- **Indexing**: GiN/GiST TRGM indexes on artist/name/label/catalog/search_norm, user+search composites, hot-slice indexes
- **Partitioning**: Hot-slice table (`records_hot.records_hot`) with 110k rows and active sync triggers
- **Extensions**: `pg_trgm`, `btree_gist`, `unaccent`, `pgcrypto`, `citext`
- **Cache Warming**: Prewarm scripts and cache warmers ensure hot data is in memory before benchmarks

### Benchmark Execution

The `scripts/run_pgbench_sweep.sh` script orchestrates comprehensive pgbench sweeps:
- Creates `bench.results` table with git metadata
- Prewarms hot partitions
- Sweeps over TRGM and KNN query variants
- Records metrics (p50/p95/p99/p999, IO deltas, WAL counts)
- Exports CSV summaries for analysis

**Sample CSV Output** (from 2025-11-13 sweep):
```
ts_utc,variant,clients,threads,duration_s,limit_rows,tps,ok_xacts,fail_xacts,err_pct,avg_ms,std_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,max_ms
2025-11-13T03:47:31Z,trgm,64,12,60,50,28033.239626,1682715,0,0.000,13.301317,7.851221,13.147,25.978,29.067,30.787,31.261,31.429
```

## Auth & Identity Flow

1. **Client Authentication** - Clients obtain JWTs via `/api/auth/login` (Caddy -> ingress -> gateway -> auth-service gRPC).
2. **API Gateway**:
   - Strips inbound `x-user-*` headers
   - Verifies JWT and checks Redis for revoked JTI
   - Injects `x-user-id`, `x-user-email`, and `x-user-jti` headers
   - Proxies to downstream services (HTTP or gRPC)
3. **Service Authorization** - Services scope queries by injected headers. Records service enforces ownership on every CRUD path and re-computes derived grades when media pieces update.
4. **Development Helper** - Set `DEBUG_FAKE_AUTH=1` on the gateway deployment to allow trusted curl/k6 traffic to supply `x-user-id` directly (UUID validated).

`services/records-service/src/lib/cache.ts` provides `cached`, `makeSearchKey`, and `invalidateSearchKeysForUser`. Mutations call the invalidation helper to clear search, autocomplete, facet, and price-stat caches per user.

## Observability & Diagnostics

### Current State
- **Prometheus/Grafana** - Arrive via `kube-prometheus-stack`. Custom ServiceMonitors scrape gateway, services, nginx, and haproxy `/metrics` endpoints.
- **Metrics Export** - Gateway exports per-route/method/status counters; edge Nginx exposes cache hit/miss gauges; records service emits Prisma timings.

### Coming Soon
- **OpenTelemetry** - Distributed tracing instrumentation for gRPC and HTTP calls
- **Jaeger** - Trace visualization and analysis
- **Service Mesh** - Istio or Linkerd for advanced traffic management, mTLS, and observability
- **Enhanced Dashboards** - Grafana dashboards for gRPC latency, HTTP/2/3 performance, and database metrics

### Key Scripts
- `scripts/verify-dev.sh` - End-to-end cluster sanity checks
- `scripts/diag-caddy.sh`, `scripts/diag-gateway.sh`, `scripts/quic-tune-kind.sh` - Ingress and QUIC inspection
- `scripts/perf_runner.sh`, `scripts/perf_smoke.sh`, `scripts/load/k6-*.js` - Load/perf harnesses
- `services/records-service/src/lib/singleflight_cache.lua` - Redis Lua helper for single-flight caching to prevent request stampedes
- `scripts/pg-connectivity-check.sh`, `scripts/run-postinit-debug-pod.sh` - Database connectivity + post-init debugging
- `scripts/test-http2-http3-strict-tls.sh` - HTTP/2, HTTP/3, and strict TLS validation
- `scripts/test-microservices-http2-http3.sh` - End-to-end microservice testing via HTTP/2 and HTTP/3
- `scripts/test-full-chain-with-rotation.sh` - Full chain validation with CA rotation

## Maintenance & Backups

- **CronJobs** - Under `infra/k8s/base/cron-jobs` perform nightly `pg_dump`, weekly `pg_basebackup`, and Redis snapshots. Secrets such as `pg-backup-pgpass.secret.yaml` and `pg-repl.secret.yaml` house credentials.
- **Backups** - `backups/` and `records-*.tar.gz` artifacts are produced locally and intentionally remain untracked.
- **Rollout Helpers** - `scripts/rollout-caddy.sh`, `scripts/rollout-latest.sh`, `scripts/rollout-unstick.sh` wrap common `kubectl` commands.
- **Database Recovery** - `scripts/rehydrate-and-tune.sh` automates the full restore + tuning + warmup + pgbench sequence.

## Roadmap

- **Observability Stack** - Complete OpenTelemetry instrumentation, Jaeger integration, and service mesh (Istio/Linkerd) deployment
- **Database Performance** - Continue tuning toward 28k TPS baseline; investigate KNN hot-slice routing
- **gRPC Expansion** - Migrate remaining services to gRPC; add streaming support
- **Production Hardening** - Separate production overlays with external TLS provisioning, secrets management, and enhanced security policies
- **Kafka Integration** - Complete messaging infrastructure for real-time updates and event streaming

## Contributing

- Use Node 20+ and pnpm 9.x. Install workspaces from repo root via `pnpm install`.
- Keep runtime images slim; tools like pnpm and Prisma CLI stay in the build stage.
- Update both base and overlay manifests when tweaking infrastructure; `repair-kustomize-structure.sh` can fix patch ordering if Kustomize complains.
- Add or update smoke tests (`scripts/smoke*.sh`, `scripts/test-*.sh`) when changing behavior. Prefer `k6` scripts for perf regressions.
- Follow conventional commits (`type(scope): summary`) so the changelog stays readable.

## License

MIT (or customize to your needs).
