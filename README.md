# Record Platform

Record Platform is a Kubernetes-first microservices stack for managing a personal record collection while exercising modern edge patterns. The stack spans Node.js/Express services, Prisma/Postgres data, Redis-backed caching, and a suite of observability and operational tools. The latest revamp replaces the Docker Compose dev story with Kustomize-driven Kubernetes, adds a Caddy front door that speaks HTTP/2 and HTTP/3, and ships automation scripts for day-to-day ops.

## Highlights
- **✅ Multi-protocol edge (HTTP/2, HTTP/3, gRPC)** - Caddy terminates TLS/QUIC and forwards into nginx-ingress; **all tests passing** including HTTP/2, HTTP/3, and gRPC flows via `scripts/test-microservices-http2-http3.sh`.
- **✅ Full gRPC inter-service communication** - All services communicate via gRPC with protocol buffers; Caddy routes gRPC requests using `protocol grpc` matcher with h2c transport to backend services.
- **✅ Multi-database architecture** - **8 dedicated PostgreSQL instances** for service isolation, scalability, and independent scaling (auth, records, social, listings, shopping, auction-monitor, analytics, python-ai).
- **✅ Dual-database connections** - Services like auction-monitor and analytics-service connect to multiple databases for cross-service data access while maintaining data isolation.
- **Kubernetes-native workflows** - `infra/k8s` provides composable bases and overlays, with bootstrapping scripts that stand up Kind, build images, load them, and apply manifests.
- **Hardened gateway path** - API Gateway keeps the JWT guard, adds optional `DEBUG_FAKE_AUTH`, injects identity headers, and exposes detailed metrics.
- **Redis-assisted records caching** - `services/records-service/src/lib/cache.ts` adds normalized search keys, safe JSON encoding, and targeted invalidation hooks.
- **Kafka messaging** - Real-time messaging for forum posts, direct messages, and group chats via Kafka integration in social-service.
- **Operational tooling** - `scripts/` covers smoke tests, TLS helpers, QUIC tuning, backup/restore, load tests, and rollout automation.

## 🎉 Recent Breakthroughs

### Full Multi-Protocol Support ✅
**All tests passing** - Complete end-to-end validation of HTTP/2, HTTP/3 (QUIC), and gRPC communication:

- ✅ **Tests 1-14**: REST API via HTTP/2 and HTTP/3 (auth, records, social, listings)
- ✅ **Tests 15a-15j**: gRPC HealthCheck and business logic for **all 10 services**:
  - **15a-15g**: Core services (auth, records, social, listings, analytics, shopping)
  - **15h**: Shopping Service gRPC (port 50058)
  - **15i**: Auction Monitor gRPC (port 50059)
  - **15j**: Python AI Service gRPC (port 50060)
- ✅ **Caddy gRPC routing**: Uses `protocol grpc` matcher with service-specific path routing for all services
- ✅ **Dual transport support**: h2c (port 5000) for internal testing, TLS (port 8443) for production
- ✅ **Complete test coverage**: Registration, login, CRUD operations, messaging, group chats, listings search, auction monitoring, AI predictions

Key technical achievements:
- **Caddy gRPC routing**: Implemented service-specific gRPC routing using `protocol grpc` matcher and `path_regexp` for service identification
- **h2c support**: Added internal port 5000 for plaintext HTTP/2 gRPC testing, with automatic fallback to TLS port 8443
- **Proto file management**: All proto files loaded from ConfigMap, with lazy loading in analytics-service to prevent startup crashes
- **Timeout handling**: Fixed grpcurl timeout conflicts by using native `-max-time` flag instead of wrapper functions
- **Health checks**: Caddy health endpoint (`/_caddy/healthz`) working for both HTTP/2 and HTTP/3

### Multi-Database Architecture ✅
**8 dedicated PostgreSQL instances** for complete service isolation and independent scaling:

- ✅ **Main DB (5433)**: `records` schema for core record collection data
- ✅ **Auth DB (5437)**: Dedicated `auth` schema for user authentication and JWT management
- ✅ **Social DB (5434)**: `social` schema for forum posts, comments, and messaging
- ✅ **Listings DB (5435)**: `listings` schema for marketplace data, auctions, and watchlists
- ✅ **Shopping DB (5436)**: `shopping` schema for carts, orders, and purchase history
- ✅ **Auction Monitor DB (5438)**: `auction_monitor` schema for auction results and price tracking
- ✅ **Analytics DB (5439)**: `analytics` schema for price snapshots and analytics data
- ✅ **Python AI DB (5440)**: `python_ai` schema for AI model persistence and predictions

Key architectural benefits:
- **Service isolation**: Each service has its own database, preventing cross-service data conflicts
- **Independent scaling**: Databases can be scaled independently based on service load
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service queries while maintaining isolation
- **Schema separation**: Clear boundaries between service domains with dedicated schemas
- **Redis authentication**: All services use password-protected Redis connections
- **Kafka integration**: Real-time messaging for forum posts, direct messages, and group chats

## Why This Exists
I have been cataloging vinyl for a little over a year, and this codebase sits at the intersection of that hobby and a desire to level up on distributed systems and observability. The earlier Docker Compose stack was enough to track spins, but I wanted to understand how real platforms layer ingress controllers, service meshes, CI/CD-friendly manifests, and QUIC edges. Every migration choice (Caddy front door, nginx micro-cache, HAProxy fan-in, the Kustomize base/overlay split) is framed so a curious collector can trace data flow from a record search UI all the way to Postgres buffers and Grafana dashboards. The repo keeps personal workflow sharp (fast search, authenticated inserts) while remaining a playground for new infra ideas.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client (Browser/Mobile)                            │
│                    HTTP/3 (QUIC) | HTTP/2 | HTTP/1.1                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Caddy (Host-Side Edge)                              │
│              TLS Termination (TLS 1.2/1.3) + mkcert CA                      │
│         HTTP/2 + HTTP/3 (QUIC) + gRPC Routing (protocol grpc)              │
│              Port 443 (HTTPS) | Port 8443 (HTTPS) | Port 5000 (h2c)        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ingress-nginx (Kubernetes Cluster)                       │
│                         host: record.local                                  │
└──────────────────────┬───────────────────────────┬──────────────────────────┘
                       │                           │
        REST /api/*    │                           │  gRPC /service.*
        (HTTP/2/3)     │                           │  (HTTP/2 h2c/TLS)
                       ▼                           ▼
        ┌──────────────────────┐      ┌──────────────────────────────┐
        │  Nginx Edge (8080)   │      │    API Gateway (4000)        │
        │  - Static Assets     │      │    - JWT Verification        │
        │  - Micro-cache       │──────▶│    - Rate Limiting          │
        │  - Rate Limiting     │      │    - Identity Injection      │
        └──────────────────────┘      │    - HTTP → gRPC Proxy       │
                       │               └──────────────┬───────────────┘
                       │                              │
                       ▼                              │
        ┌──────────────────────┐                     │
        │   HAProxy (8081)     │                     │
        │   - Keep-alive Pool  │                     │
        │   - Load Balancing   │                     │
        └──────────┬───────────┘                     │
                   │                                 │
                   └──────────────┬──────────────────┘
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────────────┐
        │              Kubernetes Services (gRPC + HTTP)              │
        ├─────────────────────────────────────────────────────────────┤
        │                                                              │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
        │  │ Auth Service │  │Records Service│  │Listings Service│    │
        │  │   (4001)     │  │    (4002)    │  │    (4003)    │     │
        │  │ gRPC:50051   │  │ gRPC:50051   │  │ gRPC:50057   │     │
        │  │ HTTP:4001    │  │ HTTP:4002    │  │ HTTP:4003    │     │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
        │         │                 │                 │              │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
        │  │Analytics     │  │Social Service│  │Shopping      │     │
        │  │Service (4004)│  │    (4006)    │  │Service (4007)│     │
        │  │ gRPC:50054   │  │ gRPC:50056   │  │ gRPC:50058   │     │
        │  │ HTTP:4004    │  │ HTTP:4006    │  │ HTTP:4007    │     │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
        │         │                 │                 │              │
        │  ┌──────────────┐  ┌──────────────┐                        │
        │  │Auction Monitor│  │Python AI     │                        │
        │  │    (4008)    │  │Service (5005)│                        │
        │  │ gRPC:50059   │  │ gRPC:50060   │                        │
        │  │ HTTP:4008    │  │ HTTP:5005    │                        │
        │  └──────────────┘  └──────────────┘                        │
        └─────────────────────────────────────────────────────────────┘
                                  │
                                  │ gRPC/HTTP
                                  │
        ┌─────────────────────────┴─────────────────────────────────────┐
        │              External Databases (Docker Compose)              │
        │                    (Outside Kubernetes)                       │
        ├───────────────────────────────────────────────────────────────┤
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │  Postgres   │  │Postgres Auth │  │Postgres Social│       │
        │  │  (Main DB)  │  │   (5437)     │  │   (5434)     │       │
        │  │   (5433)    │  │              │  │              │       │
        │  │ - records   │  │ - auth       │  │ - social      │       │
        │  │   schema    │  │   schema     │  │   schema      │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │Postgres      │  │Postgres      │  │Postgres      │       │
        │  │Listings(5435)│  │Shopping(5436)│  │Auction Mon(5438)│     │
        │  │              │  │              │  │              │       │
        │  │ - listings   │  │ - shopping   │  │ - auction_   │       │
        │  │   schema     │  │   schema     │  │   monitor    │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │Postgres      │  │Postgres      │  │    Redis     │       │
        │  │Analytics(5439)│ │Python AI(5440)│ │   (6379)     │       │
        │  │              │  │              │  │ - JWT Cache  │       │
        │  │ - analytics  │  │ - python_ai  │  │ - Search     │       │
        │  │   schema     │  │   schema     │  │   Cache      │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐                                           │
        │  │    Kafka     │                                           │
        │  │   (9092)     │                                           │
        │  │ - Messaging  │                                           │
        │  │ - Events     │                                           │
        │  │ - Forum Posts│                                           │
        │  │ - Group Chat │                                           │
        │  └──────────────┘                                           │
        └───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Observability Stack (Kubernetes)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Prometheus  │  │   Grafana    │  │    Jaeger    │  │OTel Collector│  │
│  │  (Metrics)   │  │(Visualization)│  │  (Tracing)   │  │  (OTLP)      │  │
│  │              │  │              │  │              │  │              │  │
│  │ - Scrapes    │  │ - Dashboards │  │ - Distributed│  │ - Receives   │  │
│  │   /metrics   │  │ - Alerts     │  │   Traces     │  │   traces/    │  │
│  │ - 30d        │  │ - Queries    │  │ - Query UI   │  │   metrics    │  │
│  │   retention  │  │              │  │              │  │ - Exports to │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │   Jaeger/    │  │
│                                                          │   New Relic  │  │
│  ┌──────────────┐  ┌──────────────┐                    └──────────────┘  │
│  │   Linkerd    │  │ ServiceMesh  │                                       │
│  │  (Optional)  │  │   Metrics    │                                       │
│  │              │  │              │                                       │
│  │ - mTLS       │  │ - Topology   │                                       │
│  │ - Traffic    │  │ - Traffic    │                                       │
│  │   Management │  │   Flow       │                                       │
│  └──────────────┘  └──────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Notes

**Edge & Routing:**
- **Caddy** runs on the host, terminates TLS (TLS 1.2/1.3), and supports HTTP/2 + HTTP/3 (QUIC) + gRPC
- **Caddy gRPC routing**: Uses `protocol grpc` matcher to detect gRPC requests and routes by service name in path (e.g., `/auth.*` → auth-service)
- **Dual gRPC transport**: Port 5000 (h2c/plaintext) for internal testing, Port 8443 (TLS) for production
- **ingress-nginx** routes `/` to Nginx edge (static assets + micro-cache) and `/api/*` directly to API Gateway
- **Nginx Edge** serves the Next.js webapp and proxies API requests through HAProxy
- **HAProxy** maintains keep-alive pools and load balances to API Gateway

**Inter-Service Communication:**
- **API Gateway** communicates with backend services via **gRPC** (except Python AI Service which uses HTTP)
- **Caddy gRPC proxy**: Routes gRPC requests directly to services using h2c (HTTP/2 cleartext) transport
- Services expose both HTTP (for health/metrics) and gRPC endpoints on separate ports
- gRPC provides type-safe, efficient inter-service communication with protocol buffers
- Proto definitions in `proto/` directory (auth.proto, records.proto, listings.proto, social.proto, analytics.proto)
- **gRPC reflection**: Enabled on all services for tooling support (grpcurl, etc.)

**Data Layer:**
- **All databases run outside Kubernetes** in Docker Compose for stability and easier management
- **8 dedicated PostgreSQL instances** for service isolation and independent scaling:
  - **Main DB (5433)**: `records` schema for core record collection data
  - **Auth DB (5437)**: Dedicated `auth` schema for user authentication and JWT management
  - **Social DB (5434)**: `social` schema for forum posts, comments, and messaging
  - **Listings DB (5435)**: `listings` schema for marketplace data, auctions, and watchlists
  - **Shopping DB (5436)**: `shopping` schema for carts, orders, and purchase history
  - **Auction Monitor DB (5438)**: `auction_monitor` schema for auction results and price tracking
  - **Analytics DB (5439)**: `analytics` schema for price snapshots and analytics data
  - **Python AI DB (5440)**: `python_ai` schema for AI model persistence and predictions
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases:
  - **Auction Monitor**: Reads from `listings.watchlist` (port 5435), writes to `auction_monitor.auction_results` (port 5438)
  - **Analytics Service**: Reads from `listings.search_history` (port 5435), writes to `analytics.price_snapshots` (port 5439)
- **Redis** (6379): Password-protected JWT revocation cache, search result caching, rate limiting
- **Kafka** (9092): Event streaming, real-time messaging for forum posts, direct messages, and group chats
- Services connect via `host.docker.internal:PORT` from Kubernetes pods

**Observability:**
- **Prometheus** scrapes metrics from all services via ServiceMonitors/PodMonitors
- **Grafana** provides dashboards and visualization
- **Jaeger** collects distributed traces via OpenTelemetry
- **OpenTelemetry Collector** receives OTLP from services and exports to Jaeger/Prometheus/New Relic
- **Linkerd** (optional) provides service mesh with mTLS and traffic management

## Core Services

| Component | Port | Protocol | Notes |
|-----------|------|----------|-------|
| **API Gateway** | 4000 | HTTP/gRPC | Node/Express gateway; verifies JWTs, enforces rate limit, injects `x-user-*`, proxies HTTP to gRPC, exports `/metrics`, supports `DEBUG_FAKE_AUTH` |
| **Auth Service** | 4001/50051 | HTTP/gRPC | Handles register/login/logout, persists to dedicated Auth DB (port 5437) `auth` schema via Prisma, gRPC server on port 50051 |
| **Records Service** | 4002/50051 | HTTP/gRPC | CRUD + search over records, uses Redis for search caching, enforces user ownership, gRPC on port 50051 |
| **Listings Service** | 4003/50057 | HTTP/gRPC | Public catalogue endpoints, eBay integration, gRPC interface on port 50057 for marketplace data |
| **Analytics Service** | 4004/50054 | HTTP/gRPC | Authenticated aggregations, price snapshots, dual-DB (listings + analytics), multi-core worker pool, gRPC on port 50054 |
| **Social Service** | 4006/50056 | HTTP/gRPC | Forum posts, comments, votes, user messaging, threaded conversations, gRPC on port 50056 |
| **Shopping Service** | 4007/50058 | HTTP/gRPC | Shopping cart, checkout, order management, wishlist, purchase history, gRPC on port 50058 |
| **Auction Monitor** | 4008/50059 | HTTP/gRPC | Monitors auction trends, price tracking, dual-DB (listings read + auction-monitor write), gRPC on port 50059 |
| **Python AI Service** | 5005/50060 | HTTP/gRPC | FastAPI service for AI/ML predictions, grade recommendations, Discogs/eBay integration, chatbot interface, gRPC on port 50060 |
| **Web App (Next.js)** | 3001 | HTTP | React/Next.js frontend with TypeScript, serves via Nginx edge, includes dashboard, forum, messaging, collection management, auction monitoring, insights, and integrations pages |
| **Nginx Edge** | 8080 | HTTP | Serves static UI assets, proxies `/api` through HAProxy, micro-caching, rate limiting |
| **HAProxy** | 8081 | HTTP | Keep-alive pools to gateway, load balancing, stats on port 8404 |

## Supporting Infrastructure

### Edge & Routing
- **Caddy** (`Caddyfile`, `caddy-*.yaml`) - Host-side HTTP/2 + HTTP/3 front door with TLS termination. Mounts local cert bundle under `/etc/caddy/certs`, trusts `certs/dev-root.pem`. Supports QUIC (HTTP/3) and HTTP/2.
- **Ingress** (`infra/k8s/overlays/dev/ingress.yaml`) - nginx ingress controller routing for Kind. Routes `/` to Nginx edge and `/api/*` to API Gateway. Supports gRPC with `backend-protocol: "GRPC"` annotations.
- **HAProxy** (`infra/k8s/base/haproxy`) - Maintains keep-alive pools to gateway, load balancing, stats on `:8404`, keeps gateway replicas warm.

### Data Layer (External - Docker Compose)
**All databases run outside Kubernetes** in Docker Compose for stability and easier management:

#### PostgreSQL Instances (8 dedicated databases)
- **Postgres Main** (`docker-compose.yml:postgres`) - Port 5433, hosts `records` schema for core collection data
- **Postgres Auth** (`docker-compose.yml:postgres-auth`) - Port 5437, dedicated `auth` schema for user authentication and JWT management
- **Postgres Social** (`docker-compose.yml:postgres-social`) - Port 5434, hosts `social` schema (forum posts, comments, messages)
- **Postgres Listings** (`docker-compose.yml:postgres-listings`) - Port 5435, hosts `listings` schema (marketplace data, auctions, watchlists, search_history)
- **Postgres Shopping** (`docker-compose.yml:postgres-shopping`) - Port 5436, hosts `shopping` schema (carts, orders, wishlists, purchase history)
- **Postgres Auction Monitor** (`docker-compose.yml:postgres-auction-monitor`) - Port 5438, hosts `auction_monitor` schema (auction results, price tracking)
- **Postgres Analytics** (`docker-compose.yml:postgres-analytics`) - Port 5439, hosts `analytics` schema (price snapshots, analytics data)
- **Postgres Python AI** (`docker-compose.yml:postgres-python-ai`) - Port 5440, hosts `python_ai` schema (AI model persistence, predictions)

#### Dual-Database Connections
Some services connect to multiple databases for cross-service data access:
- **Auction Monitor Service**: 
  - Reads from `listings.watchlist` (port 5435) to monitor watched items
  - Writes to `auction_monitor.auction_results` (port 5438) using `auction_monitor.upsert_auction_result()` function
- **Analytics Service**:
  - Reads from `listings.search_history` (port 5435) for search analytics
  - Writes to `analytics.price_snapshots` (port 5439) for price trend analysis

#### Supporting Infrastructure
- **Redis** (`docker-compose.yml:redis`) - Port 6379, password-protected, JWT revocation cache, search result caching, rate limiting
- **Kafka** (`docker-compose.yml:kafka`) - Port 9092, event streaming, real-time messaging for forum posts, direct messages, and group chats

Services connect via `host.docker.internal:PORT` from Kubernetes pods. Connection strings are configured in `infra/k8s/base/config/app-config.yaml` with `POSTGRES_URL_*` environment variables.

### Observability
- **Prometheus** (`infra/k8s/base/observability`) - Metrics collection via kube-prometheus-stack, 30-day retention, 50Gi storage
- **Grafana** - Visualization dashboards, pre-configured datasources, custom dashboards for microservices
- **Jaeger** - Distributed tracing, receives traces via OpenTelemetry Collector
- **OpenTelemetry Collector** - Receives OTLP (traces/metrics/logs), exports to Jaeger/Prometheus/New Relic
- **Linkerd** (optional) - Service mesh with mTLS, traffic management, auto-injection
- **ServiceMonitors/PodMonitors** - Auto-discovery and scraping of service metrics

### Monitoring & Operations
- **ServiceMonitors** (`infra/k8s/base/monitoring`) - Target gateway, services, nginx, haproxy, exporters
- **Cron Jobs** (`infra/k8s/base/cron-jobs`) - Nightly Postgres dumps, Redis snapshots, basebackups, WAL archiving
- **Exporters** (`infra/k8s/base/exporters`) - nginx-exporter, haproxy-exporter for metrics collection

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
- `scripts/test-http2-http3-strict-tls.sh` verifies health/API reachability over HTTP/2 and HTTP/3 using a helper container that runs `curl --http3` inside the Kind control-plane network namespace. It enforces TLS 1.2/1.3 and logs (but does not fail) if TLS 1.1 is still reachable.
- `scripts/test-microservices-http2-http3.sh` drives the auth + records flows (registration via HTTP/2, login via HTTP/3, HTTP/2 record creation) and reuses the same HTTP/3 helper for QUIC coverage. When the DB is under load (e.g., while `run_pgbench_sweep.sh` runs) the records write may return 503; the script logs a warning so you can re-run once the benchmark finishes.
- `scripts/h3-matrix.sh`, `scripts/diag-caddy-h3.sh`, and `scripts/diag-caddy-h3-extended.sh` remain available for low-level inspection (ALPN, SNI, upstream TLS handshakes).
- HTTP/1.1/TLS 1.2 stays enabled intentionally for compatibility; new clients are expected to negotiate HTTP/2 or HTTP/3 automatically.
- Redistribute regenerated certs out-of-band; they intentionally stay out of Git history.

## Data & Migrations

### Database Architecture
- **8 dedicated PostgreSQL instances** running in Docker Compose (outside Kubernetes) for service isolation and independent scaling:
  - **Main DB (5433)**: `records` schema for core record collection data
  - **Auth DB (5437)**: Dedicated `auth` schema for user authentication and JWT management
  - **Social DB (5434)**: `social` schema (forum posts, comments, messages, groups)
  - **Listings DB (5435)**: `listings` schema (marketplace data, auctions, watchlists, search_history)
  - **Shopping DB (5436)**: `shopping` schema (carts, orders, wishlists, purchase history)
  - **Auction Monitor DB (5438)**: `auction_monitor` schema (auction results, price tracking)
  - **Analytics DB (5439)**: `analytics` schema (price snapshots, analytics data)
  - **Python AI DB (5440)**: `python_ai` schema (AI model persistence, predictions)
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service queries while maintaining data isolation
- **Redis (6379)**: Password-protected, JWT revocation cache, search result caching, rate limiting
- **Kafka (9092)**: Event streaming, real-time messaging for forum posts, direct messages, and group chats

### Schema Management
- Prisma schemas and migrations live in each service directory
- Apply migrations via Prisma CLI:
  ```bash
  pnpm -C services/records-service prisma migrate deploy
  pnpm -C services/auth-service prisma migrate deploy
  pnpm -C services/social-service prisma migrate deploy
  ```
- Database initialization scripts in `infra/db/`:
  - `03-database.sql` - Main database schemas
  - `04-social-schema.sql` - Forum and messaging tables
  - `05-listings-schema.sql` - Listings and marketplace tables

### Data Operations
- `scripts/import-sample-data.sh` - Sample data loads
- `scripts/backup-now.sh` - On-demand backups
- `scripts/restore-from-pvc.sh` - Restore from backups
- Cron jobs perform nightly dumps and weekly basebackups
- Services connect via `host.docker.internal:PORT` from Kubernetes pods

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

1. **Client Authentication**: Clients obtain JWTs via `/api/auth/login` (Caddy → ingress → gateway → auth-service via gRPC)
2. **API Gateway Processing**:
   - Strips inbound `x-user-*` headers
   - Verifies JWT and checks Redis for revoked JTI
   - Injects `x-user-id`, `x-user-email`, and `x-user-jti` headers
   - Proxies HTTP requests to gRPC backend services
3. **Service Authorization**: Services receive identity via headers and scope queries accordingly. Records service enforces ownership on every CRUD path.
4. **Development Helper**: Set `DEBUG_FAKE_AUTH=1` on gateway deployment to allow trusted curl/k6 traffic to supply `x-user-id` directly (UUID validated).

### gRPC Communication
- API Gateway uses gRPC clients (`services/common/src/grpc-clients.ts`) to communicate with backend services
- Proto definitions in `infra/k8s/base/config/proto/` (auth.proto, records.proto, listings.proto, social.proto)
- Services expose gRPC servers on their respective ports
- Ingress supports gRPC with `backend-protocol: "GRPC"` annotations and ALPN negotiation

### Caching
- `services/records-service/src/lib/cache.ts` provides `cached`, `makeSearchKey`, and `invalidateSearchKeysForUser`
- Mutations call invalidation helpers to clear search, autocomplete, facet, and price-stat caches per user
- Redis Lua scripts (`singleflight_cache.lua`) prevent request stampedes

## Observability & Diagnostics

### Metrics & Monitoring
- **Prometheus** scrapes metrics from all services via ServiceMonitors/PodMonitors (15-30s intervals)
- **Grafana** dashboards for microservices, Kubernetes cluster, and custom business metrics
- Gateway exports per-route/method/status counters; edge Nginx exposes cache hit/miss gauges; services emit gRPC/HTTP timings
- **Access Grafana**: `kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80` → http://localhost:3000 (admin/Admin123!)

### Distributed Tracing
- **Jaeger** collects traces via OpenTelemetry Collector
- **OpenTelemetry** instrumentation available for Node.js and Python services
- **Access Jaeger**: `kubectl -n observability port-forward svc/jaeger 16686:16686` → http://localhost:16686
- See `infra/k8s/base/observability/otel-instrumentation.md` for instrumentation guide

### Service Mesh (Optional)
- **Linkerd** provides mTLS, traffic management, and service-level metrics
- **Linkerd Viz** dashboard: `linkerd viz dashboard`
- Auto-injection: `kubectl annotate namespace record-platform linkerd.io/inject=enabled`

### Diagnostic Scripts
- `scripts/verify-dev.sh` - End-to-end cluster sanity checks
- `scripts/diag-caddy.sh`, `scripts/diag-gateway.sh`, `scripts/quic-tune-kind.sh` - Ingress and QUIC inspection
- `scripts/perf_runner.sh`, `scripts/perf_smoke.sh`, `scripts/load/k6-*.js` - Load/perf harnesses
- `scripts/pg-connectivity-check.sh` - Database connectivity from Kubernetes pods to Docker Compose
- `infra/k8s/scripts/access-observability.sh` - Quick access to Grafana, Prometheus, Jaeger
- `infra/k8s/scripts/install-observability.sh` - Complete observability stack installer

### Documentation
- `infra/k8s/OBSERVABILITY.md` - Comprehensive observability guide
- `infra/k8s/GRAFANA-GUIDE.md` - Grafana usage and dashboard creation
- `infra/k8s/base/observability/otel-instrumentation.md` - OpenTelemetry instrumentation guide

## Maintenance & Backups
- CronJobs under `infra/k8s/base/cron-jobs` perform nightly `pg_dump`, weekly `pg_basebackup`, and Redis dumps. Secrets such as `pg-backup-pgpass.secret.yaml` and `pg-repl.secret.yaml` house credentials.
- `backups/` and `records-*.tar.gz` artifacts are produced locally and intentionally remain untracked.
- Rollout helpers (`scripts/rollout-caddy.sh`, `scripts/rollout-latest.sh`, `scripts/rollout-unstick.sh`) wrap common `kubectl` commands.
- Use `scripts/fix_pg.sh`, `scripts/debug-postinit.sh`, and `scripts/diag-caddy-h3-extended.sh` while finishing the DB repair and TLS rotation work noted in the commit message.

## Features

### Web Application (React/Next.js)
- **Modern Frontend Stack**: Next.js 14+ with React, TypeScript, and Tailwind CSS
- **Collection Management**: Full CRUD for records with search, filtering, and categorization
- **Dashboard**: Overview of collection statistics, recent activity, and quick actions
- **Forum**: Reddit-style discussion forum with posts, comments, upvotes, and flairs
- **Messaging**: User-to-user messaging with types/flair, threaded conversations, and real-time updates via Kafka
- **Marketplace**: eBay integration, listings management, price tracking, and watchlists
- **Auction Monitor**: Real-time auction tracking with trend visualization and price alerts
- **Insights & AI**: Price recommendations, grade predictions, collection analytics, and AI-powered chatbot
- **Integrations**: Discogs OAuth (starter), external marketplace connections
- **Responsive Design**: Mobile-friendly UI with modern component library

### Backend Services
- **gRPC Inter-Service Communication**: Type-safe, efficient protocol buffer-based communication
- **Multi-Database Architecture**: 8 dedicated PostgreSQL instances for complete service isolation (auth, records, social, listings, shopping, auction-monitor, analytics, python-ai)
- **Dual-DB Connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service data access
- **Event Streaming**: Kafka integration for real-time messaging (forum posts, direct messages, group chats) and event processing
- **Caching Layer**: Password-protected Redis for JWT revocation, search results, and performance optimization
- **Observability**: Full observability stack with Prometheus, Grafana, Jaeger, OpenTelemetry

## Roadmap
- Complete forum and messaging backend integration with database persistence
- Expand Kafka integration for real-time notifications and event processing
- Add OpenTelemetry instrumentation to all services for distributed tracing
- Create custom Grafana dashboards for business metrics and SLOs
- Set up Prometheus alerting rules and notification channels
- Harden production overlays (separate values, secrets management, external TLS provisioning)
- Implement service-level SLOs and error budgets

## Contributing
- Use Node 20+ and pnpm 9.x. Install workspaces from repo root via `pnpm install`.
- Keep runtime images slim; tools like pnpm and Prisma CLI stay in the build stage.
- Update both base and overlay manifests when tweaking infrastructure; `repair-kustomize-structure.sh` can fix patch ordering if Kustomize complains.
- Add or update smoke tests (`scripts/smoke*.sh`, `scripts/tests.sh`) when changing behavior. Prefer `k6` scripts for perf regressions.
- Follow conventional commits (`type(scope): summary`) so the changelog stays readable.

## License
MIT (or customize to your needs).
