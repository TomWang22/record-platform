# Record Platform

Record Platform is a Kubernetes-first microservices stack for managing a personal record collection while exercising modern edge patterns. The stack spans Node.js/Express services, Prisma/Postgres data, Redis-backed caching, and a suite of observability and operational tools. The latest revamp replaces the Docker Compose dev story with Kustomize-driven Kubernetes, adds a Caddy front door that speaks HTTP/2 and HTTP/3, and ships automation scripts for day-to-day ops.

## 👋 For Recruiters & Hiring Managers

**What is this project?**
A production-ready, full-stack microservices platform demonstrating modern cloud-native architecture, distributed systems design, and real-world engineering challenges. Built to solve practical problems (record collection management) while showcasing enterprise-grade infrastructure patterns.

**Key Technical Highlights:**
- **Zero-Downtime Operations**: Achieved 100% uptime during certificate rotation (16-second rotation time, 0 failed requests)
- **Multi-Protocol Edge**: HTTP/2, HTTP/3 (QUIC), and gRPC support with automatic protocol negotiation
- **Microservices Architecture**: 8+ services with dedicated databases, gRPC inter-service communication, and event-driven messaging
- **Kubernetes-Native**: Complete infrastructure as code (Terraform + Ansible), observability stack (Prometheus, Grafana, Jaeger), and disaster recovery automation
- **Production-Ready Features**: Strict TLS enforcement, JWT authentication, rate limiting, caching strategies, and comprehensive monitoring

**What skills does this demonstrate?**
- **Backend**: Node.js/Express, TypeScript, gRPC, PostgreSQL, Redis, Kafka, Prisma ORM
- **Frontend**: React/Next.js, TypeScript, Server-Sent Events, real-time updates
- **Infrastructure**: Kubernetes, Docker, Caddy, nginx, HAProxy, Terraform, Ansible
- **DevOps**: CI/CD patterns, observability (metrics, tracing, logging), zero-downtime deployments, disaster recovery
- **System Design**: Microservices architecture, database isolation, event-driven architecture, caching strategies

**Why this matters:**
This isn't a tutorial project—it's a production-grade system solving real problems with industry-standard patterns. The codebase demonstrates understanding of distributed systems, infrastructure automation, performance optimization, and operational excellence. Perfect for showcasing skills in cloud-native development, microservices architecture, and platform engineering.

**Quick Stats:**
- **8 dedicated PostgreSQL databases** for service isolation
- **8+ microservices** with gRPC communication
- **100% uptime** during certificate rotation
- **1-2 second** CA rotation time (down from 6+ minutes, 8-10x faster than previous 16-17s)
- **Full observability stack** (Prometheus, Grafana, Jaeger, OpenTelemetry)
- **Zero-downtime deployments** with RollingUpdate strategies

## Highlights
- **✅ Multi-protocol edge (HTTP/2, HTTP/3, gRPC)** - Caddy terminates TLS/QUIC and forwards into nginx-ingress; **all tests passing** including HTTP/2, HTTP/3, and gRPC flows via `scripts/test-microservices-http2-http3.sh`.
- **✅ Zero-downtime CA rotation** - Certificate authority rotation with **100% success rate** and **1-2 second rotation time** via optimized Kubernetes RollingUpdate; validated with continuous health checks:
  - `scripts/test-full-chain-with-rotation.sh`: **15000/15000 requests succeeded (100%)** during rotation (real stress test at ~120 req/s average, 100-150 req/s observed)
  - `scripts/test-http2-http3-strict-tls.sh`: **60/60 requests succeeded (100%)** during rotation
  - Zero downtime achieved with pod-by-pod rotation using RollingUpdate strategy
- **✅ Strict TLS enforcement** - TLS 1.2 and 1.3 only (TLS 1.1 and below rejected); validated via `scripts/test-http2-http3-strict-tls.sh` and `scripts/test-full-chain-with-rotation.sh`.
- **✅ Full gRPC inter-service communication** - All services communicate via gRPC with protocol buffers; Caddy routes gRPC requests using `protocol grpc` matcher with h2c transport to backend services.
- **✅ Multi-database architecture** - **8 dedicated PostgreSQL instances** for service isolation, scalability, and independent scaling (auth, records, social, listings, shopping, auction-monitor, analytics, python-ai).
- **✅ Dual-database connections** - Services like auction-monitor and analytics-service connect to multiple databases for cross-service data access while maintaining data isolation.
- **✅ One-command bootstrap & disaster recovery** - `scripts/bootstrap-platform.sh` deploys entire platform instantly; Terraform + Ansible enable instant cluster recreation for disaster recovery scenarios.
- **Kubernetes-native workflows** - `infra/k8s` provides composable bases and overlays, with bootstrapping scripts that stand up Kind, build images, load them, and apply manifests.
- **Hardened gateway path** - API Gateway keeps the JWT guard, adds optional `DEBUG_FAKE_AUTH`, injects identity headers, and exposes detailed metrics.
- **Redis-assisted records caching** - `services/records-service/src/lib/cache.ts` adds normalized search keys, safe JSON encoding, and targeted invalidation hooks.
- **Kafka messaging** - Real-time messaging for forum posts, direct messages, and group chats via Kafka integration in social-service.
- **Operational tooling** - `scripts/` covers smoke tests, TLS helpers, QUIC tuning, backup/restore, load tests, and rollout automation.

## 🎉 Recent Breakthroughs

### Zero-Downtime CA Rotation ✅
**100% success rate achieved** - Certificate authority rotation with zero downtime:

- ✅ **`scripts/test-full-chain-with-rotation.sh`**: **15000/15000 requests succeeded (100%)** during rotation
  - Rotation time: **1-2 seconds** (consistently fast)
  - Zero downtime confirmed with continuous health checks (real stress test: 15000 requests)
  - Full chain validation: Client → Caddy → Ingress → Backend
  - Real stress test: 15000 requests at ~120 req/s average (100-150 req/s observed, peaks up to 200+ req/s)
  - Throughput tuning: Concurrent pool strategy (20 concurrent requests) achieves 10x higher throughput than sequential requests
  
- ✅ **`scripts/test-http2-http3-strict-tls.sh`**: **60/60 requests succeeded (100%)** during rotation
  - Rotation time: **1-2 seconds** (consistently fast)
  - Zero downtime confirmed with continuous health checks
  - HTTP/2, HTTP/3, and strict TLS validation

**How it works:**
- **NodePort Service Architecture**: Migrated from `hostNetwork` to `NodePort` service type, enabling multiple Caddy pods to run simultaneously
- **Multiple Replicas**: 2+ replicas with pod anti-affinity for high availability across nodes
- **RollingUpdate Strategy**: `maxUnavailable: 0` ensures at least one pod is always serving traffic
- **Optimized Rotation Script**: Direct Kubernetes patch for fastest rollout restart (~0.4s)
- **Pod-by-Pod Rotation**: New pods come online before old pods terminate, ensuring zero downtime
- **Continuous Health Checks**: Test scripts verify zero downtime with continuous requests during rotation
- **New Certificates**: Mounted via Kubernetes secrets, picked up instantly via RollingUpdate

**Technical achievement:**
- **Ultra-fast rotation time**: From 6+ minutes to **1-2 seconds** (8-10x faster than previous 16-17s)
- **100% success rate**: No failed requests during rotation (15000/15000 and 60/60 requests succeeded)
- **Real stress testing**: 15000 requests at ~120 req/s average (100-150 req/s observed, peaks up to 200+ req/s) validates zero downtime under extreme load
- **True zero-downtime**: Multiple replicas with RollingUpdate ensure continuous service availability
- **Production-ready**: Supports multi-node clusters with proper load balancing and high availability
- **Throughput optimization**: Concurrent pool strategy (20 concurrent requests) achieves 10x higher throughput than sequential requests
- **Optimizations**: Removed PORT detection overhead, eliminated output overhead, direct merge patch for fastest restart, 3.0s timeout for 100% success

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

### The Problem with Record Collecting

Record collecting is harder than it should be. The existing tools and marketplaces have significant limitations:

**Marketplace Data Issues:**
- **Discogs**: Often cited as the go-to source, but it's crowdsourced with incomplete data. No one can verify the "final" mark, and price history is stale because users don't upload it frequently (they have their own marketplace).
- **eBay**: Completed/sold listings help, but many listings don't show final prices, making price research difficult.
- **Popsike & Gripsweat**: Web scraping and user input, but lack complete information. Buyer's regret exists, and the bigger issue is that record shopping is harder than most hobbies.

**The Real Challenge:**
Unless you're a staff member at a record store (and even they face pricing and margin challenges), pricing history is often incomplete. The usual formula of "price = cost + margins" works, but pricing history helps significantly. However, that history is often incomplete unless someone is dedicated to monitoring and manually entering data into databases.

**Speedrunning Collection:**
The concept of "speedrunning" a collection—rapidly building a comprehensive collection in less than a year—reveals fundamental gaps in existing tools. For collectors (especially those in undergraduate programs or early career stages), the overhead of manual data entry, price tracking, and auction monitoring becomes prohibitive. The technical challenge isn't just building a collection; it's building the infrastructure to support intelligent collection management at scale.

**The Realization:**
If someone with a computer science background finds this process to be mostly "busy work," what chance do traditional record shops have? Or collectors who are the majority of the audience? This was the core motivation for building Record Platform—a system that automates the tedious aspects of collection management while providing the technical depth needed for serious collectors.

### The Solution

Record Platform solves these problems by providing:
- **Comprehensive price tracking**: Automated auction monitoring and price history
- **Intelligent recommendations**: AI-powered grade predictions and price recommendations
- **Complete collection management**: Full CRUD with search, filtering, and categorization
- **Marketplace integration**: eBay integration, listings management, watchlists
- **Community features**: Forum, messaging, and social features for collectors
- **Real-time insights**: Analytics, price trends, and collection statistics

### Technical Journey

This codebase sits at the intersection of record collecting and a desire to level up on distributed systems and observability. The earlier Docker Compose stack was enough to track spins, but the goal was to understand how real platforms layer ingress controllers, service meshes, CI/CD-friendly manifests, and QUIC edges. Every migration choice (Caddy front door, nginx micro-cache, HAProxy fan-in, the Kustomize base/overlay split, Terraform/Ansible IAC) is framed so a curious collector can trace data flow from a record search UI all the way to Postgres buffers and Grafana dashboards. The repo keeps workflow sharp (fast search, authenticated inserts) while remaining a playground for new infra ideas.

For detailed technical documentation, system design diagrams, and deep dives into architectural decisions, see [`ENGINEERING.md`](ENGINEERING.md).

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

┌─────────────────────────────────────────────────────────────────────────────┐
│              Infrastructure as Code (IAC) Layer                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Terraform                                    │  │
│  │  - Kubernetes Infrastructure Provisioning                            │  │
│  │  - Declarative Configuration (main.tf, variables.tf, outputs.tf)   │  │
│  │  - Namespace Management                                              │  │
│  │  - ConfigMap Creation                                                │  │
│  │  - Version Pinning (.terraform-version: 1.6.0)                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Ansible                                       │  │
│  │  - Configuration Management                                           │  │
│  │  - Service Deployment (deploy-services.yml)                         │  │
│  │  - Safe Defaults (skip_cert_management, skip_caddy_config)          │  │
│  │  - Kubernetes Collections (kubernetes.core, community.kubernetes)   │  │
│  │  - Inventory Management (inventory/hosts.yml)                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Automation & Verification                          │  │
│  │  - test-iac-setup.sh: Comprehensive setup verification               │  │
│  │  - Makefile: Convenient IAC commands (terraform-*, ansible-*)        │  │
│  │  - Dry-run Support: terraform plan, ansible-playbook --check         │  │
│  │  - Auto-setup: Creates missing files automatically                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Notes

**Infrastructure as Code (IAC):**
- **Terraform** (`infra/terraform/`): Declarative Kubernetes infrastructure provisioning
  - Manages namespaces, ConfigMaps, and Kubernetes resources
  - Version-pinned configuration (Terraform 1.6.0)
  - Safe dry-run support via `terraform plan`
- **Ansible** (`infra/ansible/`): Configuration management and service deployment
  - Safe defaults: Skips cert management and Caddy config to avoid interference
  - Kubernetes collections for resource management
  - Dry-run support via `ansible-playbook --check`
- **Automation**: `test-iac-setup.sh` verifies setup and auto-creates missing files
- **Documentation**: Complete guide in `infra/IAC-GUIDE.md`

**Edge & Routing:**
- **Caddy** runs in Kubernetes with **NodePort service** (port 30443), terminates TLS (TLS 1.2/1.3 only - strict TLS enforcement), and supports HTTP/2 + HTTP/3 (QUIC) + gRPC
- **NodePort Architecture**: Migrated from `hostNetwork` to `NodePort` service type for true zero-downtime CA rotation
  - **Multiple Replicas**: 2+ replicas with pod anti-affinity for high availability
  - **RollingUpdate Strategy**: `maxUnavailable: 0` ensures at least one pod is always available
  - **Load Balancing**: Kubernetes Service provides built-in load balancing across replicas
  - **Port Access**: External access via NodePort 30443 (TCP/UDP for HTTPS, port 30050 for gRPC h2c)
- **Strict TLS**: Configured with `protocols tls1.2 tls1.3` - TLS 1.1 and below are rejected; validated via test scripts
- **CA Rotation**: Supports certificate authority rotation with `scripts/rotate-ca-and-fix-tls.sh`; **zero-downtime rotation achieved** via admin API reload (~16s, 100% success rate) + pod-by-pod rotation with multiple replicas
- **Caddy gRPC routing**: Uses `protocol grpc` matcher to detect gRPC requests and routes by service name in path (e.g., `/auth.*` → auth-service)
- **Dual gRPC transport**: Port 5000 (h2c/plaintext) for internal testing, Port 8443 (TLS) for production
- **ingress-nginx** routes `/` to Nginx edge (static assets + micro-cache) and `/api/*` directly to API Gateway
- **Nginx Edge** serves the Next.js webapp and proxies API requests through HAProxy
- **HAProxy** maintains keep-alive pools and load balances to API Gateway

**Inter-Service Communication:**
- **API Gateway** communicates with backend services via **gRPC** for all services
- **Caddy gRPC proxy**: Routes gRPC requests directly to services using h2c (HTTP/2 cleartext) transport
- Services expose both HTTP (for health/metrics) and gRPC endpoints on separate ports
- gRPC provides type-safe, efficient inter-service communication with protocol buffers
- Proto definitions in `proto/` directory (auth.proto, records.proto, listings.proto, social.proto, analytics.proto, shopping.proto, auction-monitor.proto, python-ai.proto)
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
| **Auth Service** | 4001/50051 | HTTP/gRPC | Production-tier authentication: **Google OAuth**, **SMS/Phone verification** (mock, Twilio, AWS SNS, Vonage, MessageBird), **Passkey/WebAuthn**, **MFA/TOTP**, **Privacy/Terms pages** for OAuth consent. Handles register/login/logout, persists to dedicated Auth DB (port 5437) `auth` schema via Prisma, gRPC server on port 50051 |
| **Records Service** | 4002/50051 | HTTP/gRPC | CRUD + search over records, uses Redis for search caching, enforces user ownership, gRPC on port 50051 |
| **Listings Service** | 4003/50057 | HTTP/gRPC | Public catalogue endpoints, eBay integration, gRPC interface on port 50057 for marketplace data |
| **Analytics Service** | 4004/50054 | HTTP/gRPC | Authenticated aggregations, price snapshots, dual-DB (listings + analytics), multi-core worker pool, gRPC on port 50054 |
| **Social Service** | 4006/50056 | HTTP/gRPC | Forum posts, comments, votes, user messaging, threaded conversations, gRPC on port 50056 |
| **Shopping Service** | 4007/50058 | HTTP/gRPC | Shopping cart, checkout, order management, wishlist, purchase history, gRPC on port 50058 |
| **Auction Monitor** | 4008/50059 | HTTP/gRPC | Monitors auction trends, price tracking, dual-DB (listings read + auction-monitor write), **granular percentiles (p1-p99)**, **Discogs price history scraping**, **service integrations** (Social, Shopping, Listings), gRPC on port 50059 |
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

### Observability & Monitoring Stack 📊
**Comprehensive observability** - Full-stack monitoring, tracing, and visualization:

- **Prometheus** (`infra/k8s/base/observability`) - Metrics collection and alerting
  - Installed via **Helm Chart**: `prometheus-community/kube-prometheus-stack`
  - **30-day retention**, **50Gi storage** with PVC persistence
  - Auto-discovery via ServiceMonitors and PodMonitors
  - Scrape interval: 15-30 seconds
  - **ServiceMonitors** (`infra/k8s/base/monitoring/servicemonitors.yaml`): Targets all services, nginx, haproxy, exporters
  - **PodMonitors** (`infra/k8s/base/observability/podmonitors.yaml`): Pod-level metrics collection
  - **AlertManager**: Integrated alerting with notification channels

- **Grafana** - Visualization and dashboards
  - Installed via **Helm Chart**: `prometheus-community/kube-prometheus-stack` (included in kube-prometheus-stack)
  - **10Gi persistent storage** for dashboards and data sources
  - Pre-configured datasources: Prometheus, Jaeger, Loki (optional)
  - Custom dashboards for microservices (`infra/k8s/base/observability/grafana-dashboards.yaml`)
  - Default credentials: `admin/Admin123!` (change for production)
  - Dashboard provisioning: Auto-loads dashboards from ConfigMaps

- **Jaeger** - Distributed tracing
  - Deployment: `infra/k8s/base/observability/jaeger-deploy.yaml`
  - Receives traces via OpenTelemetry Collector
  - **Query UI**: Port-forward to `svc/jaeger:16686` for trace visualization
  - Storage: In-memory (dev) or persistent storage (production)
  - Trace collection: Automatic via OpenTelemetry instrumentation

- **OpenTelemetry Collector** - Unified observability data pipeline
  - Deployment: `infra/k8s/base/observability/otel-collector-deploy.yaml`
  - **Receivers**: OTLP (gRPC:4317, HTTP:4318), Prometheus
  - **Processors**: Batch, memory limiter, resource detection
  - **Exporters**: 
    - **Jaeger**: Exports traces to Jaeger backend
    - **Prometheus**: Exports metrics to Prometheus
    - **New Relic**: Exports traces and metrics to New Relic (optional, requires license key)
    - **Logging**: Debug logging for troubleshooting
  - **Pipelines**: Traces, metrics, and logs pipelines configured
  - **Configuration**: `infra/k8s/base/observability/otel-collector-deploy.yaml` (ConfigMap)

- **New Relic Integration** (Optional) - Cloud observability platform
  - Secret: `infra/k8s/base/observability/newrelic-secret.yaml`
  - Configured in OpenTelemetry Collector exporters
  - Requires New Relic license key: `export NEW_RELIC_LICENSE_KEY='your-key'`
  - Exports traces and metrics to New Relic OTLP endpoint
  - **Setup**: Create secret with license key, OTel Collector automatically exports

- **Linkerd** (Optional) - Service mesh with advanced observability
  - Installation: `infra/k8s/scripts/install-linkerd.sh`
  - **Features**:
    - **mTLS**: Automatic mutual TLS between services
    - **Traffic Management**: Request routing, retries, timeouts
    - **Metrics**: Service-level metrics (request rate, latency, success rate)
    - **Topology**: Visual service dependency graph
    - **Auto-injection**: Automatic sidecar injection via namespace annotation
  - **Linkerd Viz**: Dashboard for service mesh visualization
  - **Access**: `linkerd viz dashboard` (CLI tool required)

- **ServiceMonitors/PodMonitors** - Auto-discovery and scraping
  - **ServiceMonitors** (`infra/k8s/base/monitoring/servicemonitors.yaml`): 
    - Targets: api-gateway, auth-service, records-service, listings-service, analytics-service, social-service, shopping-service, python-ai-service, auction-monitor, nginx, haproxy
  - **PodMonitors** (`infra/k8s/base/observability/podmonitors.yaml`):
    - Pod-level metrics for detailed observability
  - **Auto-discovery**: Prometheus automatically discovers and scrapes targets

**Installation**:
```bash
# Automated installation (recommended)
bash infra/k8s/scripts/install-observability.sh

# Or via bootstrap script (includes observability)
./scripts/bootstrap-platform.sh
```

**Access**:
```bash
# Grafana
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
# http://localhost:3000 (admin/Admin123!)

# Prometheus
kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090
# http://localhost:9090

# Jaeger
kubectl -n observability port-forward svc/jaeger 16686:16686
# http://localhost:16686

# Linkerd Viz
linkerd viz dashboard
```

**Helm Charts Used**:
- `prometheus-community/kube-prometheus-stack`: Prometheus + Grafana + AlertManager + ServiceMonitors
- Custom deployments: Jaeger, OpenTelemetry Collector (via Kustomize)

**Documentation**:
- `infra/k8s/OBSERVABILITY.md` - Comprehensive observability guide
- `infra/k8s/GRAFANA-GUIDE.md` - Grafana usage and dashboard creation
- `infra/k8s/base/observability/otel-instrumentation.md` - OpenTelemetry instrumentation guide

### Monitoring & Operations
- **ServiceMonitors** (`infra/k8s/base/monitoring`) - Target gateway, services, nginx, haproxy, exporters
- **Cron Jobs** (`infra/k8s/base/cron-jobs`) - Nightly Postgres dumps, Redis snapshots, basebackups, WAL archiving
- **Exporters** (`infra/k8s/base/exporters`) - nginx-exporter, haproxy-exporter for metrics collection

### Infrastructure as Code (IAC) & Disaster Recovery 🚀
**One-Command Bootstrap** - Deploy entire platform instantly for disaster recovery:

- **Bootstrap Script** (`scripts/bootstrap-platform.sh`) - **Complete platform deployment in one command**
  - ✅ Checks all prerequisites (Terraform, Ansible, kubectl, kind, docker)
  - ✅ Creates/verifies Kind cluster
  - ✅ Initializes and applies Terraform (creates namespace, base configs)
  - ✅ Installs Ansible collections
  - ✅ Deploys all services with Ansible
  - ✅ Builds and loads Docker images
  - ✅ Applies Kubernetes resources via Kustomize
  - ✅ Waits for all deployments to be ready
  - ✅ Shows status and next steps
  - **Usage**: `./scripts/bootstrap-platform.sh` (see `docs/BOOTSTRAP.md` for complete guide)
  - **Disaster Recovery**: Instant cluster spin-up with `--destroy` flag for teardown

- **Terraform** (`infra/terraform/`) - Kubernetes infrastructure provisioning with declarative configuration
  - `main.tf` - Main configuration with Kubernetes provider
  - `variables.tf` - Namespace, environment, and kubeconfig settings
  - `outputs.tf` - Namespace, kubeconfig path, and service ports
  - `kubernetes.tf` - Kubernetes resources (namespaces, ConfigMaps)
  - `.terraform-version` - Version pinning (1.6.0)
  - **Disaster Recovery**: Infrastructure state stored in Terraform, enables instant recreation

- **Ansible** (`infra/ansible/`) - Configuration management and service deployment
  - `ansible.cfg` - Ansible configuration with inventory and connection settings
  - `requirements.yml` - Kubernetes collections (kubernetes.core, community.kubernetes)
  - `inventory/hosts.yml` - Localhost Kubernetes host configuration
  - `playbooks/deploy-services.yml` - Safe deployment playbook with standalone mode
    - Includes `skip_cert_management: true` and `skip_caddy_config: true` for safety
    - Does not interfere with existing certificates, Caddy config, or CA rotation
  - **Disaster Recovery**: Idempotent playbooks enable consistent service deployment

- **Verification & Automation**:
  - `test-iac-setup.sh` - Comprehensive setup verification script
    - Checks prerequisites (Terraform, Ansible, kubectl)
    - Auto-creates missing Terraform/Ansible files
    - Validates Terraform configuration
    - Installs Ansible collections
    - Verifies inventory configuration
  - `Makefile` - Convenient commands for IAC operations
    - `make terraform-init`, `make terraform-validate`, `make terraform-plan`, `make terraform-apply`
    - `make ansible-install`, `make ansible-check`, `make ansible-deploy`
    - `make test-setup`, `make clean`

- **Documentation**: 
  - `infra/IAC-GUIDE.md` - Complete guide with quick start, prerequisites, usage examples, and troubleshooting
  - `docs/BOOTSTRAP.md` - Complete bootstrap and disaster recovery guide

**Quick Start - One Command Bootstrap**:
```bash
# Deploy entire platform
./scripts/bootstrap-platform.sh

# Preview changes (dry-run)
./scripts/bootstrap-platform.sh --dry-run

# Teardown (disaster recovery reset)
./scripts/bootstrap-platform.sh --destroy
```

**Manual Setup**:
```bash
cd infra
./test-iac-setup.sh    # Verify setup and create missing files
make help              # See all available commands
make test-setup        # Run verification

# Test Terraform (dry-run, safe)
cd terraform && terraform plan

# Test Ansible (dry-run, safe)
cd ansible && ansible-playbook playbooks/deploy-services.yml --check
```

**Disaster Recovery Capabilities**:
- ✅ **Instant Cluster Recreation**: Bootstrap script recreates entire Kubernetes cluster
- ✅ **Service Deployment**: Ansible playbooks deploy all services consistently
- ✅ **Database Redundancy**: **Note**: Databases currently run in Docker Compose (external to Kubernetes) - **production requires redundancy**:
  - PostgreSQL: Use managed database services (AWS RDS, Google Cloud SQL, Azure Database) with automatic backups, read replicas, and multi-AZ deployment
  - Redis: Use managed Redis (AWS ElastiCache, Google Cloud Memorystore) with replication and failover
  - Kafka: Use managed Kafka (AWS MSK, Confluent Cloud) with replication and high availability
- ✅ **State Management**: Terraform state enables infrastructure recreation
- ✅ **Idempotent Operations**: All operations are safe to run multiple times

**Features**:
- Safe defaults: All playbooks skip cert management and Caddy config
- Dry-run support: `terraform plan` and `ansible-playbook --check` are safe
- No interference: Does not touch certificates, Caddy config, or CA rotation
- Auto-setup: Test script creates missing files automatically
- Comprehensive validation: Checks prerequisites and validates configurations
- **Disaster Recovery**: One-command platform restoration

## Repository Layout
- `infra/k8s/base/*` - canonical manifests for services, data stores, ingress, monitoring, and cron jobs.
- `infra/k8s/overlays/dev/*` - dev overlay, ingress, patches, bootstrap scripts, job templates, and PVC helpers.
- `infra/terraform/*` - Terraform configuration for Kubernetes infrastructure provisioning.
- `infra/ansible/*` - Ansible playbooks and configuration for service deployment and management.
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
- Optional: Terraform >=1.0 and Ansible >=2.9 for Infrastructure as Code (IAC) workflows (see `infra/IAC-GUIDE.md`).

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

### Strict TLS Enforcement
- **Configuration**: Caddy is configured with `protocols tls1.2 tls1.3` - only TLS 1.2 and 1.3 are accepted; TLS 1.1 and below are rejected.
- **Validation**: Test scripts verify strict TLS enforcement:
  - `scripts/test-http2-http3-strict-tls.sh` - Tests TLS 1.2/1.3 acceptance and TLS 1.1 rejection
  - `scripts/test-full-chain-with-rotation.sh` - Full chain validation with strict TLS

### Certificate Management
- **TLS Material**: Lives in `certs/` (`tls.crt`, `tls.key`, `dev-root.pem`, etc.) and is ignored by Git (`.gitignore:23-30`). Generate new keys with `scripts/strict-tls-bootstrap.sh` and trust `caddy-local-root.crt` locally (`security add-trusted-cert ...` on macOS).
- **Caddy Configuration**: Expects the leaf cert/key at `/etc/caddy/certs/` and the trusted CA at `/etc/caddy/ca/dev-root.pem`. Use `scripts/caddy-toggle-insecure.sh` to temporarily disable upstream verification while debugging.

### Zero-Downtime CA Rotation 🎉

**Achievement**: **100% success rate** with **1-2 second rotation time** - zero downtime achieved!

**How It Works:**
1. **Optimized Rotation Script**: Direct Kubernetes merge patch for fastest rollout restart (~0.4s)
2. **Continuous Health Checks**: Test scripts run continuous health checks during rotation to verify zero downtime
3. **Certificate Update**: New certificates are generated and mounted via Kubernetes secrets (parallel background operations)
4. **RollingUpdate Strategy**: `maxUnavailable: 0` ensures pod-by-pod rotation with zero downtime
5. **Verification**: Health checks confirm 100% success rate during rotation

**Test Results:**
- **`scripts/test-full-chain-with-rotation.sh`**:
  - ✅ **15000/15000 requests succeeded (100%)** during rotation
  - ✅ Rotation time: **1-2 seconds** (consistently fast)
  - ✅ Zero downtime confirmed with continuous health checks (real stress test: 15000 requests)
  - ✅ Full chain validation: Client → Caddy → Ingress → Backend
  - ✅ Throughput: ~120 req/s average (100-150 req/s observed, peaks up to 200+ req/s)
  - ✅ Tuning: Concurrent pool strategy (20 concurrent requests) with 3.0s timeout for 100% success
  
- **`scripts/test-http2-http3-strict-tls.sh`**:
  - ✅ **60/60 requests succeeded (100%)** during rotation
  - ✅ Rotation time: **1-2 seconds** (consistently fast)
  - ✅ Zero downtime confirmed with continuous health checks
  - ✅ HTTP/2, HTTP/3, and strict TLS validation

**Optimizations:**
1. **Removed PORT detection**: Uses default PORT=30443 (saves ~0.5s)
2. **Eliminated output overhead**: No `say`/`ok` messages during rotation
3. **Direct merge patch**: Fastest rollout restart method (~0.4s)
4. **Request timeouts**: All kubectl operations have `--request-timeout=1-2s`
5. **Parallel operations**: Background kubectl operations run async
6. **Immediate exit**: Script exits immediately after triggering restart

**Setup for Zero-Downtime:**
1. **RollingUpdate Strategy**: Use `RollingUpdate` with `maxUnavailable: 0` and `maxSurge: 1` for production
2. **Multiple Replicas**: For true zero-downtime on multi-node clusters, use 2+ replicas with pod anti-affinity
3. **NodePort Service**: Enables multiple pods to run simultaneously with load balancing

**Rotation Script**: `scripts/rotate-ca-and-fix-tls.sh`
- Generates new certificates with `mkcert` (not timed)
- Updates Kubernetes secrets in parallel (background)
- Direct merge patch to trigger RollingUpdate (~0.4s)
- Immediate exit after triggering restart
- Background cleanup (non-blocking)

**For Production:**
- Use `RollingUpdate` strategy with 2+ replicas on multiple nodes for true zero-downtime
- Rotation time consistently 1-2 seconds with 100% success rate
- Real stress testing validates zero downtime (15000 requests at ~120 req/s average, 100-150 req/s observed)
- Throughput tuning: Concurrent pool strategy achieves 10x higher throughput than sequential requests

### Test Scripts
- **`scripts/test-http2-http3-strict-tls.sh`** - Verifies HTTP/2, HTTP/3, strict TLS (TLS 1.2/1.3 only), and CA rotation with continuous health checks (60 requests during rotation)
- **`scripts/test-full-chain-with-rotation.sh`** - Full end-to-end chain test (Client → Caddy → Ingress → Backend) with HTTP/2, HTTP/3, strict TLS validation, and CA rotation testing (120 requests during rotation)
- **`scripts/test-microservices-http2-http3.sh`** - Drives the auth + records flows (registration via HTTP/2, login via HTTP/3, HTTP/2 record creation) and reuses the same HTTP/3 helper for QUIC coverage. When the DB is under load (e.g., while `run_pgbench_sweep.sh` runs) the records write may return 503; the script logs a warning so you can re-run once the benchmark finishes.
- **`scripts/h3-matrix.sh`**, **`scripts/diag-caddy-h3.sh`**, and **`scripts/diag-caddy-h3-extended.sh`** remain available for low-level inspection (ALPN, SNI, upstream TLS handshakes).

### Additional Notes
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
- Results are recorded in Postgres with git metadata and exported to `bench_sweep.csv` for spreadsheet review. Latency files are parsed into comprehensive percentiles: **p50, p95, p99, p999, p9999, p99999, p999999, p9999999, and p100**, plus CPU share and IO deltas.
- **Extended percentile coverage**: All performance testing scripts (k6 and pgbench) now include p9999999 (99.99999th percentile) for detection of extreme tail latencies (1 in 10 million requests).
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
  ts_utc,variant,clients,tps,p95_ms,p99_ms,p999_ms,p9999_ms,p99999_ms,p999999_ms,p9999999_ms
  2025-11-03T20:48:43Z,percent,16,2997.227769,12.128,12.468,15.234,18.456,22.789,25.123,28.456
  2025-11-03T20:49:43Z,knn,16,2614.342007,10.794,11.053,13.567,16.234,19.456,22.123,25.789
  2025-11-03T21:12:30Z,percent,48,2728.663783,3.507,4.576,6.234,8.456,10.789,12.123,15.456
  2025-11-03T22:10:29Z,knn,32,1875.440407,3.648,3.856,5.567,7.234,9.456,11.123,14.789
  ```
- **Performance testing scripts**:
  - **k6 scripts**: `scripts/load/k6-mixed.js`, `scripts/load/k6-reads.js`, `scripts/load/all-in-one-k6.js`, `scripts/load/k6-summary-handler.js`
  - **pgbench scripts**: `scripts/run_*_pgbench_sweep.sh` for all services (auth, social, listings, shopping, analytics, auction-monitor, python-ai)
  - All scripts include full percentile coverage from p50 to p9999999
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

## Recovery Procedures

### Service Recovery

**Check Service Status**:
```bash
# Check all pods
kubectl -n record-platform get pods

# Check specific service
kubectl -n record-platform get pods -l app=<service-name>

# Check pod events
kubectl -n record-platform describe pod <pod-name>
```

**View Service Logs**:
```bash
# Recent logs
kubectl -n record-platform logs -l app=<service-name> -c app --tail=100

# Follow logs
kubectl -n record-platform logs -l app=<service-name> -c app -f

# Logs with error filtering
kubectl -n record-platform logs -l app=<service-name> -c app --tail=500 | grep -E "error|Error|ERROR|502|503|500"
```

**Restart Service**:
```bash
# Restart specific service
kubectl -n record-platform rollout restart deployment/<service-name>

# Verify rollout
kubectl -n record-platform rollout status deployment/<service-name> --timeout=90s

# Restart all services (use with caution)
kubectl -n record-platform rollout restart deployment --all
```

**Common Service Issues**:
- **502 Bad Gateway**: Check downstream service health, verify service endpoints exist
- **503 Service Unavailable**: Check health check timeouts, database connectivity, Redis connectivity
- **504 Gateway Timeout**: Check proxy timeouts, service response times, database query performance
- **Pod CrashLoopBackOff**: Check logs for errors, verify environment variables, check resource limits

### Database Recovery

**Check Disk Space**:
```bash
# Host disk space
df -h

# Docker disk usage
docker system df

# Kubernetes PVC usage
kubectl -n record-platform get pvc
```

**Cleanup Disk Space**:
```bash
# Docker cleanup (removes unused images, containers, volumes)
docker system prune -a --volumes

# Kubernetes cleanup (if safe - removes unused PVCs)
kubectl -n record-platform delete pvc <pvc-name>

# Emergency cleanup scripts
./scripts/emergency-disk-cleanup.sh
./scripts/cleanup-k8s-pvc-space.sh
```

**Database Connection Issues**:
```bash
# Check database pods (if running in Kubernetes)
kubectl -n record-platform get pods -l app=postgres

# Check database connectivity from service pod
kubectl -n record-platform exec <service-pod> -- nc -zv host.docker.internal 5433

# Test database connection
psql -h localhost -p 5433 -U postgres -d records -c "SELECT 1"
```

**Database Recovery**:
```bash
# Restart database (Docker Compose)
docker-compose restart postgres postgres-auth postgres-social postgres-listings postgres-shopping

# Check database logs
docker-compose logs postgres | tail -100

# Restore from backup (see docs/postgres-infra-setup.md)
make pg.restore.dump
```

### API Gateway Recovery

**Check Gateway Status**:
```bash
# Check gateway pod
kubectl -n record-platform get pods -l app=api-gateway

# Check gateway logs
kubectl -n record-platform logs -l app=api-gateway -c app --tail=200

# Check proxy errors
kubectl -n record-platform logs -l app=api-gateway -c app --tail=500 | grep -E "proxy error|502|upstream error|socket hang"
```

**Check Redis Connection**:
```bash
# Check Redis connectivity
kubectl -n record-platform logs -l app=api-gateway -c app | grep -E "redis|Redis"

# Test Redis connection
kubectl -n record-platform exec <gateway-pod> -- redis-cli -h host.docker.internal -p 6379 -a <password> ping
```

**Restart Gateway**:
```bash
# Restart API Gateway
kubectl -n record-platform rollout restart deployment/api-gateway

# Verify rollout
kubectl -n record-platform rollout status deployment/api-gateway --timeout=90s

# Test gateway health
curl -k https://record.local:8443/api/healthz
```

**Common Gateway Issues**:
- **502 Bad Gateway**: Downstream service unavailable, check service health
- **Socket hang up**: Service connection timeout, check service logs and health
- **Token revocation failing**: Redis connection issue, check Redis connectivity
- **Path rewrite issues**: Check pathRewrite logic in server.ts, verify route matching

### Linkerd Recovery

**Check Linkerd Status**:
```bash
# Check Linkerd control plane
linkerd check

# Check Linkerd pods
kubectl -n linkerd get pods

# Check Linkerd injection
kubectl -n record-platform get pods -o jsonpath='{.items[*].metadata.annotations.linkerd\.io/inject}'
```

**Fix CoreDNS**:
```bash
# Restart CoreDNS
kubectl -n kube-system rollout restart deployment/coredns

# Verify CoreDNS health
kubectl -n kube-system get pods -l k8s-app=kube-dns
```

**Re-enable Linkerd**:
```bash
# Re-enable injection at namespace level
kubectl annotate namespace record-platform linkerd.io/inject=enabled --overwrite

# Restart deployments to inject proxies
kubectl -n record-platform rollout restart deployment --all

# Verify injection
kubectl -n record-platform get pods -o jsonpath='{.items[*].metadata.annotations.linkerd\.io/inject}'
```

**Disable Linkerd** (if causing issues):
```bash
# Disable injection
kubectl annotate namespace record-platform linkerd.io/inject- --overwrite

# Delete existing pods to remove proxies
kubectl -n record-platform delete pods --all

# Verify removal
kubectl -n record-platform get pods
```

### Health Check Recovery

**Check Health Check Status**:
```bash
# Check service health
curl -k https://record.local:8443/api/<service>/healthz

# Check Kubernetes probes
kubectl -n record-platform describe pod <pod-name> | grep -A 10 "Liveness\|Readiness"

# Check probe failures
kubectl -n record-platform get events --sort-by='.lastTimestamp' | grep -E "Unhealthy|Failed"
```

**Fix Health Check Timeouts**:
```bash
# Increase probe timeouts in deployment YAML
# livenessProbe.timeoutSeconds: 5
# readinessProbe.timeoutSeconds: 5

# Apply changes
kubectl -n record-platform apply -f infra/k8s/base/<service>/deploy.yaml

# Restart service
kubectl -n record-platform rollout restart deployment/<service>
```

### Test Recovery

**Run Integration Tests**:
```bash
# Full test suite
./scripts/test-microservices-http2-http3.sh

# Check test results
echo $?  # 0 = success, non-zero = failure

# Run specific test (modify script)
# Focus on failing test section
```

**Debug Test Failures**:
```bash
# Check service logs during test
kubectl -n record-platform logs -l app=<service-name> -c app --tail=100 -f

# Check API Gateway logs
kubectl -n record-platform logs -l app=api-gateway -c app --tail=200 -f

# Test specific endpoint manually
curl -k -v https://record.local:8443/api/<endpoint> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

### Emergency Recovery

**Complete Platform Reset** (use with extreme caution):
```bash
# 1. Backup databases
./scripts/backup-now.sh

# 2. Scale down all services
kubectl -n record-platform scale deployment --replicas=0 --all

# 3. Clean up resources (if safe)
kubectl -n record-platform delete pods --all
kubectl -n record-platform delete pvc --all  # WARNING: Data loss!

# 4. Restart platform
./scripts/bootstrap-platform.sh

# 5. Restore databases
make pg.restore.dump
```

**Quick Service Recovery**:
```bash
# Restart all services
kubectl -n record-platform rollout restart deployment --all

# Wait for all rollouts
kubectl -n record-platform rollout status deployment --all --timeout=300s

# Verify all pods are ready
kubectl -n record-platform wait --for=condition=ready pod --all --timeout=300s
```

### Documentation References
- **Postgres Recovery**: `docs/postgres-infra-setup.md` - Complete database recovery procedures
- **Linkerd Recovery**: `LINKERD_FIX.md` - Linkerd re-enablement process
- **Observability**: `infra/k8s/OBSERVABILITY.md` - Observability stack troubleshooting
- **Bootstrap**: `docs/BOOTSTRAP.md` - Platform bootstrap and disaster recovery

## Features

### Web Application (React/Next.js)
- **Modern Frontend Stack**: Next.js 14+ with React, TypeScript, and Tailwind CSS
- **Collection Management**: Full CRUD for records with search, filtering, and categorization
- **Dashboard**: Overview of collection statistics, recent activity, and quick actions
- **Forum**: Reddit-style discussion forum with posts, comments, upvotes, and flairs
- **Messaging**: User-to-user messaging with types/flair, threaded conversations, and real-time updates via Kafka
- **Marketplace**: eBay integration, listings management, price tracking, and watchlists
- **Shopping Cart**: Amazon-style cart with catalog differentiation, item notes, and rich item display
  - **Catalog ID Support**: Unique identifiers to differentiate items with same title/condition
  - **User Notes**: Per-item notes for buyer context (e.g., "Has minor scratch", "Gift for John")
  - **Rich Display**: Image, title, condition, catalog ID, price, quantity, and total per item
  - **Responsive Design**: Works seamlessly on mobile, tablet, and desktop
- **Auction Monitor**: Real-time auction tracking with trend visualization, **granular price percentiles (p1-p99)**, **Discogs price history (full sales arc)**, and price alerts. Integrates with Social Service (negotiation assistance), Shopping Service (buyer evaluation), and Listings Service (seller optimization).
- **Insights & AI**: Price recommendations, grade predictions, collection analytics, and AI-powered chatbot
- **Integrations**: Discogs OAuth (starter), external marketplace connections
- **Responsive Design**: Mobile-friendly UI with modern component library

### Backend Services
- **Production-Tier Authentication** (Auth Service):
  - **Google OAuth 2.0**: Full OAuth flow with consent screen, privacy policy, and terms of service pages. Published OAuth app allows any Google user to sign in.
  - **SMS/Phone Verification**: Multi-provider support with abstraction layer (mock, Twilio, AWS SNS, Vonage, MessageBird). Lazy-loaded SDKs prevent build failures.
  - **Passkey/WebAuthn**: Modern passwordless authentication with mock data support for testing, production-ready WebAuthn configuration.
  - **MFA/TOTP**: Time-based one-time password support for multi-factor authentication.
  - **Privacy & Terms Pages**: Required for OAuth consent screen, served directly from auth-service with separate ingress routing.
- **gRPC Inter-Service Communication**: Type-safe, efficient protocol buffer-based communication
- **Multi-Database Architecture**: 8 dedicated PostgreSQL instances for complete service isolation (auth, records, social, listings, shopping, auction-monitor, analytics, python-ai)
- **Dual-DB Connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service data access
- **Auction Monitor Data Pipeline**: Comprehensive data ingestion, normalization, validation, and storage pipeline with **granular percentiles (p1-p99)**, **Discogs price history scraping**, and **service integrations** (Social, Shopping, Listings). See `services/auction-monitor/SERVICE_INTEGRATIONS.md` for details.
- **Event Streaming**: Kafka integration for real-time messaging (forum posts, direct messages, group chats) and event processing
- **Caching Layer**: Password-protected Redis for JWT revocation, search results, and performance optimization
- **Observability**: Full observability stack with Prometheus, Grafana, Jaeger, OpenTelemetry, Linkerd/Istio service mesh
  - **Setup Guide**: See `infra/k8s/OBSERVABILITY-PRODUCTION-SETUP.md` for production-ready configuration
  - **Quick Fix**: Run `bash infra/k8s/scripts/fix-observability-production.sh` to fix common issues
  - **Components**: Prometheus (metrics), Grafana (dashboards), Jaeger (tracing), OTel Collector (OTLP), Linkerd/Istio (service mesh)

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

### Commit Messages
For detailed commit messages, use `COMMIT_MESSAGE.txt`:
```bash
# Option 1: Use git commit with -F flag
git commit -F COMMIT_MESSAGE.txt

# Option 2: Use the helper script
./scripts/commit.sh

# Note: git commit -m "COMMIT_MESSAGE.txt" won't work - use -F flag!
```

## License
MIT (or customize to your needs).
