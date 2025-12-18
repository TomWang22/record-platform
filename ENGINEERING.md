# Record Platform - Engineering Documentation

This document provides in-depth technical documentation for the Record Platform architecture, design decisions, and implementation details. For a high-level overview, see [`README.md`](README.md).

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Design Decisions](#design-decisions)
3. [Technology Stack](#technology-stack)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Service Communication Patterns](#service-communication-patterns)
6. [Infrastructure as Code](#infrastructure-as-code)
7. [Observability & Monitoring](#observability--monitoring)
8. [Performance Optimizations](#performance-optimizations)
9. [Security Architecture](#security-architecture)
10. [Deployment Strategy](#deployment-strategy)

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                       │
│                    HTTP/3 (QUIC) | HTTP/2 | HTTP/1.1                        │
│                    Web App (Next.js) | Mobile | API Clients                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Edge Layer (Caddy)                                   │
│              TLS Termination (TLS 1.2/1.3) + mkcert CA                      │
│         HTTP/2 + HTTP/3 (QUIC) + gRPC Routing (protocol grpc)              │
│         NodePort Service (30443 TCP/UDP) | Port 8443 (HTTPS) | Port 5000 (h2c) │
│                                                                              │
│  Architecture:                                                               │
│  - NodePort Service: Multiple replicas with load balancing                   │
│  - RollingUpdate: maxUnavailable=0 for zero-downtime deployments            │
│  - Pod Anti-Affinity: Distributes pods across nodes for HA                  │
│                                                                              │
│  Features:                                                                   │
│  - Zero-downtime CA rotation via admin API (localhost:2019)                │
│  - True zero-downtime: Pod-by-pod rotation with multiple replicas          │
│  - Strict TLS enforcement (TLS 1.2/1.3 only)                                │
│  - Protocol detection and routing                                            │
│  - QUIC (HTTP/3) support with automatic fallback                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Kubernetes Ingress Layer                                 │
│                    ingress-nginx (Kubernetes Cluster)                        │
│                         host: record.local                                  │
│                                                                              │
│  Routing Rules:                                                              │
│  - / → Nginx Edge (static assets + micro-cache)                            │
│  - /api/* → API Gateway (JWT verification + gRPC proxy)                    │
│  - gRPC requests → Direct service routing via protocol detection            │
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
        │              Microservices Layer (Kubernetes)               │
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
        │              Data Layer (External - Docker Compose)          │
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
        │  │ PLAINTEXT:9092│                                          │
        │  │   SSL:9093   │                                           │
        │  │ - Messaging  │                                           │
        │  │ - Events     │                                           │
        │  │ - Forum Posts│                                           │
        │  │ - Group Chat │                                           │
        │  │ - Strict TLS │                                           │
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

## Design Decisions

### Why Caddy Over Nginx/Traefik?

**Decision**: Use Caddy as the edge reverse proxy instead of Nginx or Traefik.

**Rationale**:
1. **Native HTTP/3 (QUIC) Support**: Caddy has first-class HTTP/3 support without complex configuration
2. **Automatic TLS**: Built-in Let's Encrypt integration (though we use mkcert for local dev)
3. **Admin API**: Critical for zero-downtime CA rotation via `localhost:2019`
4. **Protocol Detection**: Native `protocol grpc` matcher for gRPC routing
5. **Simpler Configuration**: Caddyfile syntax is more readable than Nginx configs
6. **Performance**: Competitive with Nginx for our use case

**Trade-offs**:
- Less mature ecosystem than Nginx
- Smaller community, but active development
- Admin API security considerations (bound to localhost only)

### Why 8 Separate PostgreSQL Instances?

**Decision**: Use 8 dedicated PostgreSQL instances instead of a single database with multiple schemas.

**Rationale**:
1. **Service Isolation**: Complete data isolation prevents cross-service data conflicts
2. **Independent Scaling**: Each database can be scaled independently based on service load
3. **Backup Strategy**: Independent backup/restore per service
4. **Connection Pooling**: Service-specific connection pools prevent resource contention
5. **Schema Evolution**: Services can evolve schemas without affecting others
6. **Multi-tenancy**: Clear boundaries for future multi-tenant support

**Trade-offs**:
- Higher resource usage (8 instances vs 1)
- More complex connection management
- Cross-service queries require dual-DB connections (auction-monitor, analytics-service)

**Implementation**: Services connect via Kubernetes Service names (e.g., `postgres-auth-external.record-platform.svc.cluster.local:5437`) which route through Kubernetes Endpoints to Docker Compose postgres containers at `host.docker.internal:PORT` (192.168.65.254 on macOS with Docker Desktop). All 8 postgres databases have corresponding Kubernetes Services and Endpoints configured. Dedicated ports:
- Main DB: 5433 (records schema)
- Auth DB: 5437 (auth schema)
- Social DB: 5434 (social schema)
- Listings DB: 5435 (listings schema)
- Shopping DB: 5436 (shopping schema)
- Auction Monitor DB: 5438 (auction_monitor schema)
- Analytics DB: 5439 (analytics schema)
- Python AI DB: 5440 (python_ai schema)

### Why gRPC Over REST for Inter-Service Communication?

**Decision**: Use gRPC for all inter-service communication instead of REST.

**Rationale**:
1. **Type Safety**: Protocol buffers provide compile-time type checking
2. **Performance**: Binary protocol is more efficient than JSON
3. **Streaming**: Native support for request/response streaming
4. **Code Generation**: Auto-generated client/server code reduces boilerplate
5. **HTTP/2 Multiplexing**: Single connection handles multiple concurrent requests
6. **Service Discovery**: Built-in with Kubernetes service names

**Implementation**:
- All services expose gRPC servers on dedicated ports (50051-50060)
- API Gateway proxies HTTP requests to gRPC backend services
- Caddy routes gRPC requests using `protocol grpc` matcher
- Dual transport: h2c (port 5000) for internal testing, TLS (port 8443) for production

**Trade-offs**:
- Less human-readable than JSON (requires tooling to inspect)
- Browser support requires gRPC-Web proxy
- Learning curve for developers unfamiliar with protocol buffers

### Why Kubernetes Over Docker Compose?

**Decision**: Migrate from Docker Compose to Kubernetes (Kind for local dev).

**Rationale**:
1. **Production Parity**: Local dev environment matches production
2. **Service Discovery**: Native Kubernetes service discovery
3. **Resource Management**: CPU/memory limits and requests
4. **Rolling Updates**: Zero-downtime deployments with RollingUpdate strategy
5. **Observability**: Native integration with Prometheus, Grafana, Jaeger
6. **Scalability**: Easy horizontal scaling with replicas
7. **Kustomize**: Base/overlay pattern for environment-specific configs

**Trade-offs**:
- More complex setup than Docker Compose
- Higher resource requirements
- Steeper learning curve
- Databases still run in Docker Compose (stability and easier management)

### Why Zero-Downtime CA Rotation?

**Decision**: Implement zero-downtime certificate authority rotation.

**Rationale**:
1. **Production Requirement**: Certificate rotation shouldn't cause service interruption
2. **Security**: Regular CA rotation is a security best practice
3. **Compliance**: Some industries require regular certificate rotation
4. **User Experience**: No downtime during certificate updates

**Implementation**:
1. **Caddy Admin API**: Use `localhost:2019` to reload configuration without pod restart
2. **Continuous Health Checks**: Test scripts run continuous requests during rotation
3. **Kubernetes Secrets**: New certificates mounted via secrets
4. **Fallback Strategy**: Pod restart if admin API fails

**Results**:
- ✅ **100% success rate** (validated with k6 distributed load testing)
- ✅ **1-2 second rotation time** (consistently fast, 8-10x faster than previous 16-17s)
- ✅ **Maximum proven throughput**: **~397 req/s** (71,447 requests in 180s) with **0% failures** and **0.76% drops**
- ✅ **Optimal k6 configuration**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs) - **production-ready**
- ✅ **Breaking point identified**: 260/160 configuration shows 0.08% failures (violates zero-downtime requirement)
- ✅ **Zero downtime achieved** with k6 distributed load testing under extreme production load
- ✅ **k6 optimization**: Constant-arrival-rate executor with connection reuse achieves optimal performance
- ✅ **Performance progression**: Tested configurations from 100/50 to 250/150, all maintaining 0% failures

**Trade-offs**:
- Admin API must be accessible (port-forward during rotation)
- Certificate file updates may require pod restart (Caddy caches in memory)
- Multi-node cluster recommended for true zero-downtime with pod restarts

## Technology Stack

### Edge & Routing
- **Caddy**: HTTP/2, HTTP/3 (QUIC), gRPC routing, TLS termination
- **ingress-nginx**: Kubernetes ingress controller
- **Nginx**: Static asset serving, micro-caching
- **HAProxy**: Keep-alive pools, load balancing

### Application Layer
- **Node.js 20+**: Runtime for all microservices
- **Express**: HTTP server framework
- **TypeScript**: Type-safe development
- **Next.js 14+**: React framework for web app
- **Python 3.11+**: FastAPI for AI service

### Data Layer
- **PostgreSQL 16**: 8 dedicated instances for service isolation
- **Redis 7**: JWT revocation cache, search result caching
- **Kafka**: Event streaming, real-time messaging. **Strict TLS enabled** with SSL listener on port 9093. SSL certificates stored in `kafka-ssl-secret`.

### Inter-Service Communication
- **gRPC**: Protocol buffer-based RPC
- **Protocol Buffers**: Schema definition and code generation
- **HTTP/2**: Transport for gRPC (h2c and TLS)

### Infrastructure
- **Kubernetes (Kind)**: Local development cluster
- **Kustomize**: Configuration management
- **Terraform**: Infrastructure as Code
- **Ansible**: Configuration management and deployment

### Observability
- **Prometheus**: Metrics collection
- **Grafana**: Visualization and dashboards
- **Jaeger**: Distributed tracing
- **OpenTelemetry**: Instrumentation standard

### Development Tools
- **Prisma**: ORM and database migrations
- **pnpm**: Package manager
- **Docker**: Containerization
- **mkcert**: Local certificate generation

## Data Flow Diagrams

### Authentication Flow

```
Client Request
    │
    ▼
Caddy (TLS Termination)
    │
    ▼
ingress-nginx
    │
    ▼
API Gateway (4000)
    │
    ├─► JWT Verification (Redis cache check)
    │
    ├─► Auth Service (gRPC:50051)
    │   │
    │   └─► Auth DB (5437) - auth schema
    │
    └─► Response with JWT
```

### Record Search Flow

```
Client Request: GET /api/records/search?q=...
    │
    ▼
Caddy → ingress-nginx → API Gateway
    │
    ├─► JWT Verification
    │
    └─► Records Service (gRPC:50051)
        │
        ├─► Redis Cache Check
        │   └─► Cache Hit → Return Results
        │
        └─► Cache Miss
            │
            ├─► Main DB (5433) - records schema
            │   └─► Search Query (trgm, knn, or percent)
            │
            └─► Cache Results → Return
```

### Real-Time Messaging Flow

```
Client: POST /api/social/messages
    │
    ▼
Caddy → ingress-nginx → API Gateway
    │
    └─► Social Service (gRPC:50056)
        │
        ├─► Social DB (5434) - social schema
        │   └─► Store Message
        │
        └─► Kafka Producer
            │
            └─► Kafka Topic: messages
                │
                └─► Kafka Consumer (Social Service)
                    │
                    └─► WebSocket/SSE → Client
```

### Auction Monitoring Flow

```
Auction Monitor Service (4008)
    │
    ├─► Read: Listings DB (5435) - listings.watchlist
    │   └─► Get Watched Items
    │
    ├─► Platform Adapters (eBay API, Discogs API, Scraping)
    │   ├─► Rate Limiting (Redis Lua scripts)
    │   ├─► Caching (Redis with singleflight pattern)
    │   └─► Browser Pool (Puppeteer for scraping)
    │
    ├─► Data Pipeline
    │   ├─► Normalization (platform-specific → unified schema)
    │   ├─► Validation (required fields, data types, business rules)
    │   ├─► Deduplication (exact match, URL match, fuzzy matching)
    │   └─► Confidence Scoring (completeness, source reliability, freshness)
    │
    └─► Write: Auction Monitor DB (5438)
        ├─► raw_listings (staging)
        ├─► normalized_listings (validated, high-confidence)
        └─► price_history (time-series)
```

## Service Communication Patterns

### gRPC Communication

All inter-service communication uses gRPC with protocol buffers:

1. **API Gateway → Backend Services**: HTTP request converted to gRPC call
2. **Service-to-Service**: Direct gRPC calls using service discovery
3. **Caddy gRPC Routing**: Routes gRPC requests by service name in path

**Protocol Buffer Definitions**:
- `proto/auth.proto`: Authentication and user management
- `proto/records.proto`: Record collection CRUD operations
- `proto/listings.proto`: Marketplace and auction data
- `proto/social.proto`: Forum posts, comments, messaging
- `proto/analytics.proto`: Price snapshots and analytics
- `proto/shopping.proto`: Shopping cart and orders
- `proto/auction-monitor.proto`: Auction monitoring and price tracking
- `proto/python-ai.proto`: AI predictions and recommendations

### HTTP Endpoints

Services expose HTTP endpoints for:
- Health checks: `GET /healthz`
- Metrics: `GET /metrics` (Prometheus format)
- gRPC reflection: For tooling support (grpcurl)

### Caching Strategy

**Redis Caching**:
- **JWT Revocation**: Blacklist revoked tokens
- **Search Results**: Normalized search keys with user-specific invalidation
- **Rate Limiting**: Per-user rate limit counters

**Cache Invalidation**:
- Mutations trigger targeted cache invalidation
- User-specific cache keys prevent cross-user data leakage
- Lua scripts prevent cache stampedes (singleflight pattern)

## Infrastructure as Code & Disaster Recovery

### One-Command Bootstrap

**Purpose**: Instant platform deployment and disaster recovery.

**Bootstrap Script** (`scripts/bootstrap-platform.sh`):
- **Complete platform deployment** in a single command
- Orchestrates Terraform + Ansible + Docker + Kubernetes
- **Disaster recovery**: Instant cluster recreation
- **Idempotent**: Safe to run multiple times

**Features**:
- Prerequisites checking (Terraform, Ansible, kubectl, kind, docker)
- Kind cluster creation/verification
- Terraform initialization and application
- Ansible collection installation and service deployment
- Docker image building and loading
- Kubernetes resource deployment via Kustomize
- Health checks and status reporting

**Usage**:
```bash
# Full bootstrap
./scripts/bootstrap-platform.sh

# Preview changes (dry-run)
./scripts/bootstrap-platform.sh --dry-run

# Skip Docker builds
./scripts/bootstrap-platform.sh --skip-build

# Teardown (disaster recovery reset)
./scripts/bootstrap-platform.sh --destroy

# Custom configuration
./scripts/bootstrap-platform.sh --cluster my-cluster --env prod
```

**Disaster Recovery Workflow**:
1. **Teardown**: `./scripts/bootstrap-platform.sh --destroy` (removes infrastructure)
2. **Recreate**: `./scripts/bootstrap-platform.sh` (instantly recreates everything)
3. **Database Restoration**: Restore from backups (see Backup Strategy section)
4. **Verification**: Run integration tests to verify platform health

**Documentation**: See `docs/BOOTSTRAP.md` for complete guide.

### Terraform

**Purpose**: Declarative Kubernetes infrastructure provisioning.

**Structure**:
- `main.tf`: Provider configuration and main resources
- `variables.tf`: Input variables (namespace, environment, kubeconfig)
- `outputs.tf`: Output values (namespace, kubeconfig path, service ports)
- `kubernetes.tf`: Kubernetes resources (namespaces, ConfigMaps)

**Disaster Recovery**:
- Infrastructure state stored in Terraform
- Enables instant infrastructure recreation
- Idempotent operations (safe to run multiple times)
- State management: Local by default, remote backend for production (S3, GCS, etc.)

**Usage**:
```bash
cd infra/terraform
terraform init
terraform plan    # Dry-run
terraform apply   # Apply changes
terraform destroy # Teardown (use bootstrap script instead)
```

### Ansible

**Purpose**: Configuration management and service deployment.

**Structure**:
- `ansible.cfg`: Ansible configuration
- `requirements.yml`: Kubernetes collections
- `inventory/hosts.yml`: Kubernetes host configuration
- `playbooks/deploy-services.yml`: Service deployment playbook

**Safety Features**:
- `skip_cert_management: true`: Doesn't touch certificates
- `skip_caddy_config: true`: Doesn't modify Caddy config
- Dry-run support: `ansible-playbook --check`
- **Idempotent**: Safe to run multiple times

**Disaster Recovery**:
- Idempotent playbooks enable consistent service deployment
- Kubernetes API-based (no state files required)
- Safe to re-run after infrastructure recreation

**Usage**:
```bash
cd infra/ansible
ansible-playbook playbooks/deploy-services.yml --check  # Dry-run
ansible-playbook playbooks/deploy-services.yml          # Deploy
```

### Database Redundancy & Disaster Recovery

**Current State**: Databases run in Docker Compose (external to Kubernetes) for stability and easier management.

**Production Requirements**:
- **PostgreSQL**: 
  - Use managed database services (AWS RDS, Google Cloud SQL, Azure Database)
  - **Automatic backups**: Point-in-time recovery, daily snapshots
  - **Read replicas**: For read-heavy workloads and failover
  - **Multi-AZ deployment**: High availability across availability zones
  - **Connection pooling**: PgBouncer for efficient connection management
- **Redis**:
  - Use managed Redis (AWS ElastiCache, Google Cloud Memorystore)
  - **Replication**: Master-replica setup for failover
  - **Persistence**: RDB snapshots and AOF for data durability
  - **High availability**: Automatic failover to replica
- **Kafka**:
  - Use managed Kafka (AWS MSK, Confluent Cloud)
  - **Replication**: Multi-broker replication for fault tolerance
  - **High availability**: Automatic leader election and partition reassignment
  - **Durability**: Replicated topics with configurable replication factor
  - **Strict TLS**: SSL/TLS encryption enabled on port 9093
  - **SSL Certificates**: Managed via Kubernetes secrets (`kafka-ssl-secret`)
  - **Client Authentication**: Configurable (`none` for now, `required` for strict TLS)

**Backup Strategy** (Current):
- Nightly `pg_dump` for all databases
- Weekly `pg_basebackup` for point-in-time recovery
- Redis snapshots nightly
- WAL archiving for continuous backup
- **Restore**: `scripts/restore-from-pvc.sh` or `scripts/restore-from-upload.sh`

**Disaster Recovery Plan**:
1. **Infrastructure**: Bootstrap script recreates Kubernetes cluster
2. **Services**: Ansible playbooks deploy all services
3. **Databases**: Restore from backups (managed services handle this automatically)
4. **Data**: Restore from latest backup or point-in-time recovery
5. **Verification**: Run integration tests to verify platform health

## Observability & Monitoring

### Complete Observability Stack

**Components**:
1. **Prometheus** - Metrics collection and alerting
2. **Grafana** - Visualization and dashboards
3. **Jaeger** - Distributed tracing
4. **OpenTelemetry Collector** - Unified observability data pipeline
5. **New Relic** (Optional) - Cloud observability platform
6. **Linkerd** (Optional) - Service mesh with advanced observability

**Installation**:
- **Automated**: `bash infra/k8s/scripts/install-observability.sh`
- **Via Bootstrap**: Included in `./scripts/bootstrap-platform.sh`
- **Helm Charts**: `prometheus-community/kube-prometheus-stack` for Prometheus + Grafana

### Metrics (Prometheus)

**Deployment**:
- **Helm Chart**: `prometheus-community/kube-prometheus-stack`
- **Storage**: 50Gi PVC with 30-day retention
- **Namespace**: `monitoring`
- **Configuration**: `infra/k8s/base/observability/prometheus-deploy.yaml`

**Collection**:
- **ServiceMonitors** (`infra/k8s/base/monitoring/servicemonitors.yaml`): Auto-discovery of service metrics
  - Targets: api-gateway, auth-service, records-service, listings-service, analytics-service, social-service, shopping-service, python-ai-service, auction-monitor, nginx, haproxy
- **PodMonitors** (`infra/k8s/base/observability/podmonitors.yaml`): Pod-level metrics collection
- **Scrape interval**: 15-30 seconds
- **Retention**: 30 days
- **AlertManager**: Integrated alerting with notification channels

**Key Metrics**:
- Request rate, latency, error rate per service
- gRPC call metrics (success/failure, latency)
- Database connection pool metrics
- Cache hit/miss rates
- HTTP/2 and HTTP/3 connection metrics
- Kubernetes cluster metrics (CPU, memory, network)

**Access**:
```bash
kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090
# http://localhost:9090
```

### Visualization (Grafana)

**Deployment**:
- **Helm Chart**: Included in `kube-prometheus-stack`
- **Storage**: 10Gi PVC for dashboards and data sources
- **Namespace**: `monitoring`
- **Default Credentials**: `admin/Admin123!` (change for production)

**Features**:
- Pre-configured datasources: Prometheus, Jaeger, Loki (optional)
- Custom dashboards: `infra/k8s/base/observability/grafana-dashboards.yaml`
- Dashboard provisioning: Auto-loads dashboards from ConfigMaps
- Alerting: Integrated with Prometheus AlertManager

**Access**:
```bash
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
# http://localhost:3000 (admin/Admin123!)
```

### Distributed Tracing (Jaeger)

**Deployment**:
- **Manifest**: `infra/k8s/base/observability/jaeger-deploy.yaml`
- **Namespace**: `observability`
- **Storage**: In-memory (dev) or persistent storage (production)
- **Receives traces**: Via OpenTelemetry Collector

**Instrumentation**:
- OpenTelemetry SDK for Node.js and Python
- Automatic trace propagation via gRPC metadata
- Custom spans for business logic
- See `infra/k8s/base/observability/otel-instrumentation.md` for guide

**Trace Flow**:
```
Client Request
    │
    ├─► Caddy (span: edge)
    ├─► API Gateway (span: gateway)
    ├─► Backend Service (span: service)
    └─► Database Query (span: db)
```

**Access**:
```bash
kubectl -n observability port-forward svc/jaeger 16686:16686
# http://localhost:16686
```

### OpenTelemetry Collector

**Deployment**:
- **Manifest**: `infra/k8s/base/observability/otel-collector-deploy.yaml`
- **Namespace**: `observability`
- **Configuration**: ConfigMap with OTLP receivers and exporters

**Receivers**:
- **OTLP**: gRPC (port 4317), HTTP (port 4318)
- **Prometheus**: Scrapes Prometheus metrics

**Processors**:
- **Batch**: Batches traces and metrics for efficient export
- **Memory Limiter**: Prevents OOM by limiting memory usage
- **Resource Detection**: Adds resource attributes (pod, node, etc.)

**Exporters**:
- **Jaeger**: Exports traces to Jaeger backend
- **Prometheus**: Exports metrics to Prometheus
- **New Relic**: Exports traces and metrics to New Relic (optional)
- **Logging**: Debug logging for troubleshooting

**Pipelines**:
- **Traces**: OTLP → Batch → Jaeger + New Relic
- **Metrics**: Prometheus + OTLP → Batch → Prometheus + New Relic
- **Logs**: (Future) OTLP → Batch → Loki/ELK

**Configuration**:
```yaml
# infra/k8s/base/observability/otel-collector-deploy.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  jaeger:
    endpoint: jaeger.observability.svc.cluster.local:14250
  prometheus:
    endpoint: "0.0.0.0:8889"
  newrelic:
    apikey: ${NEW_RELIC_LICENSE_KEY}
    endpoint: https://otlp.nr-data.net
```

### New Relic Integration (Optional)

**Purpose**: Cloud observability platform for production monitoring.

**Setup**:
1. Get New Relic license key from https://one.newrelic.com/admin-portal/api-keys/home
2. Create secret: `kubectl create secret generic newrelic-secret --from-literal=license-key='YOUR_KEY' -n observability`
3. OpenTelemetry Collector automatically exports to New Relic

**Configuration**:
- **Secret**: `infra/k8s/base/observability/newrelic-secret.yaml`
- **Exporter**: Configured in OpenTelemetry Collector
- **Endpoint**: `https://otlp.nr-data.net` (New Relic OTLP endpoint)

**Features**:
- Traces and metrics exported to New Relic
- APM (Application Performance Monitoring)
- Infrastructure monitoring
- Custom dashboards and alerts

**Production Setup**: See `infra/k8s/OBSERVABILITY-PRODUCTION-SETUP.md` for comprehensive setup and troubleshooting guide.

**Quick Fix Script**: Run `bash infra/k8s/scripts/fix-observability-production.sh` to automatically fix common issues:
- Grafana CrashLoopBackOff
- Prometheus Helm chart failures
- OpenTelemetry Collector duplicate pods
- Linkerd/Istio control plane restarts
- DNS resolution issues
- Sidecar injection problems

### Service Mesh (Linkerd - Optional)

**Purpose**: Service mesh with mTLS, traffic management, and advanced observability.

**Installation**:
- **Script**: `infra/k8s/scripts/install-linkerd.sh`
- **CLI Required**: `curl -sL https://run.linkerd.io/install-edge | sh`

**Features**:
- **mTLS**: Automatic mutual TLS between services
- **Traffic Management**: Request routing, retries, timeouts, circuit breakers
- **Metrics**: Service-level metrics (request rate, latency, success rate)
- **Topology**: Visual service dependency graph
- **Auto-injection**: Automatic sidecar injection via namespace annotation
- **Linkerd Viz**: Dashboard for service mesh visualization

**Usage**:
```bash
# Install Linkerd
bash infra/k8s/scripts/install-linkerd.sh

# Enable auto-injection
kubectl annotate namespace record-platform linkerd.io/inject=enabled

# Access dashboard
linkerd viz dashboard
```

**Benefits**:
- Automatic mTLS between services
- Service-level observability without code changes
- Traffic splitting for canary deployments
- Request-level retries and timeouts

### Logging

**Structured Logging**:
- JSON format for easy parsing
- Correlation IDs for request tracing
- Log levels: DEBUG, INFO, WARN, ERROR

**Log Aggregation** (Current):
- Kubernetes pod logs via `kubectl logs`
- **Future**: Centralized logging with ELK stack or Loki

**Access**:
```bash
# View service logs
kubectl -n record-platform logs -f deployment/api-gateway

# View all pods in namespace
kubectl -n record-platform logs -f --all-containers=true
```

### Documentation

- `infra/k8s/OBSERVABILITY.md` - Comprehensive observability guide
- `infra/k8s/GRAFANA-GUIDE.md` - Grafana usage and dashboard creation
- `infra/k8s/base/observability/otel-instrumentation.md` - OpenTelemetry instrumentation guide

## Shopping Cart Architecture

### Amazon-Style Cart Design

**Problem Statement:**
Marketplace platforms require sophisticated cart experiences where users frequently
encounter multiple identical items (same title, condition) that need differentiation.
Industry leaders (Amazon, eBay) solve this through catalog identification and user
notes.

**Why This Matters:**
- **User Experience**: Users need to distinguish between multiple identical items
  in their cart (e.g., two "Beatles - Abbey Road" records, both "Very Good" condition,
  but one has original packaging and one doesn't)
- **Seller Flexibility**: Sellers can list the same item multiple times with different
  catalog IDs (e.g., different pressings, different sellers, different batches)
- **Purchase Clarity**: Buyers can add notes to remember why they added an item or
  distinguish between similar items
- **Marketplace Standards**: Aligns with industry-standard UX patterns from Amazon,
  eBay, and other major marketplaces

**Investigation of Alternatives:**
- **Option 1: Use listing ID only** - Rejected: Listing ID changes when item is
  reposted, doesn't help differentiate identical items
- **Option 2: Composite key (title + condition)** - Rejected: Too restrictive,
  prevents sellers from listing same item multiple times
- **Option 3: Catalog ID + Notes (Chosen)** - Best: Provides seller flexibility
  (catalog ID) and buyer clarity (notes), aligns with industry standards

### Technical Implementation

**Database Schema:**
- **Listings DB**: `catalog_id VARCHAR(128)` in `listings.listings` table
  - Unique constraint on `(user_id, title, condition, catalog_id)` when catalog_id
    is provided
  - Index on `catalog_id` for fast lookups
  - Allows NULL catalog_id for items without catalog distinction
- **Shopping DB**: `notes TEXT` in `shopping.shopping_cart` table
  - User-specific notes per cart item
  - Allows differentiation of items with same condition

**Cross-Service Data Enrichment:**
- Shopping service connects to listings database to fetch item details
- Uses `listingsPool` connection pool for efficient cross-database queries
- Enriches cart items with listing metadata (image, title, condition, catalog_id)
  before returning to frontend

**API Design:**
- **GET /cart**: Returns enriched cart items with full listing details
- **POST /cart**: Accepts optional `notes` field for new cart items
- **PUT /cart/:itemId**: Allows updating `notes` field for existing cart items
- **POST /listings**: Accepts optional `catalog_id` in request body
- **PUT /listings/:id**: Allows updating `catalog_id` for existing listings

**Frontend Implementation:**
- Amazon-style grid layout with responsive design
- Visual badges for condition and catalog ID
- Inline editing for notes with optimistic updates
- Lazy loading for images to reduce initial page load

**Performance Considerations:**
- Cart GET endpoint performs one additional query per item to fetch listing details
- Consider caching listing details if cart contains many items
- Index on `catalog_id` ensures fast lookups

## Performance Optimizations

### Performance Testing & Benchmarking

**Comprehensive Percentile Coverage**:
- All performance testing scripts (k6 and pgbench) include extended percentile coverage: **p50, p95, p99, p999, p9999, p99999, p999999, p9999999, and p100**
- **p9999999 (99.99999th percentile)**: Enables detection of extreme tail latencies (1 in 10 million requests) for comprehensive performance analysis
- **k6 scripts**: `scripts/load/k6-mixed.js`, `scripts/load/k6-reads.js`, `scripts/load/all-in-one-k6.js`, `scripts/load/k6-summary-handler.js`
- **pgbench scripts**: Service-specific benchmark scripts for auth, social, listings, shopping, analytics, auction-monitor, and python-ai services
- **Database schema**: All benchmark results stored in `bench.results` table with full percentile columns
- **CSV export**: Results exported to CSV with all percentile metrics for analysis

**Benchmark Execution**:
- **Service-specific benchmarks**: Each service has its own pgbench sweep script
- **Multiple client counts**: Tests run with varying client counts (8, 16, 24, 32, 48, 64, etc.)
- **Extended duration**: Higher client counts use extended test durations (3x) for stability
- **Cold cache support**: Optional cold cache phase for realistic performance testing
- **Fast temp tablespace**: Optional RAM-based temp files to reduce p999 spikes

**Performance Metrics**:
- **Throughput (TPS)**: Transactions per second
- **Latency percentiles**: p50, p95, p99, p999, p9999, p99999, p999999, p9999999, p100
- **Cache hit ratio**: Database buffer cache effectiveness
- **I/O metrics**: Disk I/O timing and statistics
- **CPU usage**: CPU share and utilization

### Database Optimizations

**Partitioning**:
- Records table partitioned by `created_at` (monthly partitions)
- Improves query performance for time-based queries
- Easier data archival

**Indexing Strategy**:
- **trgm (trigram)**: Fast prefix matching for search
- **knn (vector)**: Semantic search using embeddings
- **percent**: Percentage-based filtering

**Connection Pooling**:
- Prisma connection pool per service
- Configurable pool size based on service load

### Shopping Cart Architecture

### Amazon-Style Cart Design

**Problem Statement:**
Marketplace platforms require sophisticated cart experiences where users frequently
encounter multiple identical items (same title, condition) that need differentiation.
Industry leaders (Amazon, eBay) solve this through catalog identification and user
notes.

**Why This Matters:**
- **User Experience**: Users need to distinguish between multiple identical items
  in their cart (e.g., two "Beatles - Abbey Road" records, both "Very Good" condition,
  but one has original packaging and one doesn't)
- **Seller Flexibility**: Sellers can list the same item multiple times with different
  catalog IDs (e.g., different pressings, different sellers, different batches)
- **Purchase Clarity**: Buyers can add notes to remember why they added an item or
  distinguish between similar items
- **Marketplace Standards**: Aligns with industry-standard UX patterns from Amazon,
  eBay, and other major marketplaces

**Investigation of Alternatives:**
- **Option 1: Use listing ID only** - Rejected: Listing ID changes when item is
  reposted, doesn't help differentiate identical items
- **Option 2: Composite key (title + condition)** - Rejected: Too restrictive,
  prevents sellers from listing same item multiple times
- **Option 3: Catalog ID + Notes (Chosen)** - Best: Provides seller flexibility
  (catalog ID) and buyer clarity (notes), aligns with industry standards

### Technical Implementation

**Database Schema:**
- **Listings DB**: `catalog_id VARCHAR(128)` in `listings.listings` table
  - Unique constraint on `(user_id, title, condition, catalog_id)` when catalog_id
    is provided
  - Index on `catalog_id` for fast lookups
  - Allows NULL catalog_id for items without catalog distinction
- **Shopping DB**: `notes TEXT` in `shopping.shopping_cart` table
  - User-specific notes per cart item
  - Allows differentiation of items with same condition

**Cross-Service Data Enrichment:**
- Shopping service connects to listings database to fetch item details
- Uses `listingsPool` connection pool for efficient cross-database queries
- Enriches cart items with listing metadata (image, title, condition, catalog_id)
  before returning to frontend

**API Design:**
- **GET /cart**: Returns enriched cart items with full listing details
- **POST /cart**: Accepts optional `notes` field for new cart items
- **PUT /cart/:itemId**: Allows updating `notes` field for existing cart items
- **POST /listings**: Accepts optional `catalog_id` in request body
- **PUT /listings/:id**: Allows updating `catalog_id` for existing listings

**Frontend Implementation:**
- Amazon-style grid layout with responsive design
- Visual badges for condition and catalog ID
- Inline editing for notes with optimistic updates
- Lazy loading for images to reduce initial page load

**Performance Considerations:**
- Cart GET endpoint performs one additional query per item to fetch listing details
- Consider caching listing details if cart contains many items
- Index on `catalog_id` ensures fast lookups

### Caching Strategy

**Redis Caching**:
- Search results cached with normalized keys
- User-specific cache invalidation
- Singleflight pattern prevents cache stampedes
- **Auction Monitor**: Platform search results with Lua singleflight (prevents thundering herd and cache stampede)

**Nginx Micro-Cache**:
- Short TTL (5-10 seconds) for static assets
- Cache headers for browser caching

### HTTP/3 (QUIC) Benefits

**Performance Improvements**:
- Reduced latency with 0-RTT connection establishment
- Better performance on lossy networks
- Multiplexing without head-of-line blocking

**Implementation**:
- Caddy handles QUIC automatically
- Fallback to HTTP/2 if QUIC unavailable
- Client support required (modern browsers, curl with HTTP/3)

## Security Architecture

### Authentication & Authorization

**Production-Tier Authentication (Auth Service)**:

**Google OAuth 2.0**:
- Full OAuth flow with Google Cloud Console integration
- Published OAuth app allows any Google user to sign in (not just test users)
- Consent screen with privacy policy and terms of service URLs
- Callback URL routing via ngrok for local development/testing
- Client ID and Secret stored in Kubernetes secrets
- Routes: `/api/auth/google` (initiate), `/api/auth/google/callback` (callback)

**SMS/Phone Verification**:
- Multi-provider abstraction layer with lazy-loaded SDKs
- Supported providers: Mock (default), Twilio, AWS SNS, Vonage, MessageBird
- Provider selection via `SMS_PROVIDER` environment variable
- Mock provider for development/testing with `/api/auth/sms/mock/messages` endpoint
- Lazy loading prevents build failures if optional dependencies are missing
- Rate limiting and verification code generation

**Passkey/WebAuthn**:
- Modern passwordless authentication using WebAuthn API
- Mock data support for testing (controlled via `ALLOW_MOCK_PASSKEY_DATA`)
- Production-ready WebAuthn configuration (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`)
- Client-side validation with server-side verification
- Routes: `/api/auth/passkeys/register/start`, `/api/auth/passkeys/register/finish`, `/api/auth/passkeys/login/start`, `/api/auth/passkeys/login/finish`

**MFA/TOTP**:
- Time-based one-time password (TOTP) support
- QR code generation for authenticator apps
- Verification code validation
- Routes: `/api/auth/mfa/setup`, `/api/auth/mfa/verify`, `/api/auth/mfa/disable`

**Privacy & Terms Pages**:
- Required for OAuth consent screen compliance
- Served directly from auth-service (`/privacy`, `/terms`)
- Separate ingress routing to bypass rewrite-target conflicts
- HTML pages with proper styling and content
- Accessible via public URLs for Google Cloud Console configuration

**JWT-Based Authentication**:
- Access tokens: Short-lived (15 minutes)
- Refresh tokens: Long-lived (7 days)
- Token revocation: Redis blacklist

**API Gateway Security**:
- JWT verification on all `/api/*` routes
- Rate limiting per user
- Identity injection: `x-user-id`, `x-user-email`, `x-user-jti` headers

**Service Authorization**:
- Services receive identity via headers
- Records service enforces ownership on CRUD operations
- Role-based access control (future)

### TLS Security

**k6 Load Test TLS Configuration**:
- **CA Certificate**: Mounted at `/etc/ssl/certs/k6-ca.crt` in k6 pods
- **Environment Variable**: `SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt` set in all k6 test jobs
- **ConfigMap**: `k6-ca-cert` contains `ca.crt` (mkcert root CA) for all namespaces
- **Scripts Updated**: All k6 JavaScript test scripts removed `insecureSkipTLSVerify: true` for production-ready testing
- **Validation**: Tests fail if CA certificate is missing, ensuring strict TLS is always enforced
- **Shopping Service Tests**: All shopping service k6 tests (`k6-shopping-stress.js`, `k6-shopping-ramp.js`, `k6-shopping-db-validation.js`, `k6-bottleneck-finder.js`) use strict TLS verification with CA certificate validation
- **Test Scripts**: `run-k6-shopping.sh` and `find-bottlenecks.sh` enforce strict TLS by mounting CA certificate ConfigMap and setting `SSL_CERT_FILE` environment variable
- **ClusterIP Access**: Tests use ClusterIP FQDN (`caddy-h3.ingress-nginx.svc.cluster.local:443`) for in-cluster testing to avoid NodePort TLS passthrough issues in Kind clusters

**Strict TLS Enforcement**:
- **Edge Layer**: Caddy configured with `protocols tls1.2 tls1.3` - only TLS 1.2 and 1.3 are accepted; TLS 1.1 and below are rejected.
- **Service-Level TLS**: All services enforce strict TLS with:
  - `NODE_TLS_REJECT_UNAUTHORIZED=1` environment variable (rejects self-signed certificates)
  - CA certificate mounted from `dev-root-ca` Kubernetes secret at `/certs/dev-root.pem`
  - `NODE_EXTRA_CA_CERTS=/certs/dev-root.pem` for Node.js CA trust store
  - Volume mount: `dev-root-ca` secret with `dev-root.pem` key
- **Services with Strict TLS**: auth-service, listings-service, records-service, social-service, shopping-service, analytics-service, api-gateway, python-ai-service
- **gRPC Health Checks**: Services with gRPC endpoints use `grpc.health.v1.Health/Check` protocol (HTTP/2/3) for Kubernetes health probes:
  - **auth-service**: Uses `grpc-health-probe` binary for gRPC health checks
  - **python-ai-service**: Uses native Kubernetes `grpc` probe type
  - **Other services**: HTTP health checks via `/healthz` endpoint
- **Validation**: Test scripts verify strict TLS enforcement:
  - `scripts/test-http2-http3-strict-tls.sh` - Tests TLS 1.2/1.3 acceptance and TLS 1.1 rejection
  - `scripts/test-full-chain-with-rotation.sh` - Full chain validation with strict TLS

**Certificate Management**:
- mkcert for local development
- Kubernetes secrets for certificate storage (`dev-root-ca` secret in `record-platform` namespace)
- Zero-downtime CA rotation via admin API
- CA certificate distributed to all services via volume mounts

### Network Security

**Service Isolation**:
- Kubernetes network policies (future)
- Database isolation (8 separate instances)
- Redis password protection

**Ingress Security**:
- TLS termination at Caddy
- Host-based routing
- Rate limiting at multiple layers

**Kafka Strict TLS**:
- **SSL/TLS Encryption**: Kafka configured with strict TLS on port 9093
- **Status**: ✅ Fully configured and operational
- **SSL Certificates**: Generated and stored in `kafka-ssl-secret` Kubernetes secret
  - CA certificate (ca-cert.pem, ca-key.pem)
  - Broker certificate (broker-cert.pem, broker-key.pem)
  - Keystore (kafka.keystore.jks)
  - Truststore (kafka.truststore.jks)
- **Environment Variables**: All required Confluent Kafka SSL env vars configured:
  - `KAFKA_SSL_KEYSTORE_LOCATION=/etc/kafka/secrets`
  - `KAFKA_SSL_KEYSTORE_FILENAME=kafka.keystore.jks`
  - `KAFKA_SSL_KEYSTORE_CREDENTIALS` (from secret)
  - `KAFKA_SSL_KEY_CREDENTIALS` (from secret)
  - `KAFKA_SSL_TRUSTSTORE_LOCATION=/etc/kafka/secrets`
  - `KAFKA_SSL_TRUSTSTORE_FILENAME=kafka.truststore.jks`
  - `KAFKA_SSL_TRUSTSTORE_CREDENTIALS` (from secret)
  - `KAFKA_SSL_CLIENT_AUTH=none` (can be set to `required` for strict TLS)
- **Listeners**: 
  - PLAINTEXT (9092): Available for migration
  - SSL (9093): Primary listener with strict TLS
- **Service Configuration**: Python AI service and other services use SSL port (9093)
- **Certificate Management**: Certificates mounted from Kubernetes secret, passwords stored securely
- **Documentation**: See `docs/kafka-ssl-setup.md` for complete setup guide

## Deployment Strategy

### Zero-Downtime Deployments

**NodePort Service Architecture**:
- **Migration from hostNetwork**: Changed from `hostNetwork: true` to `NodePort` service type
- **Multiple Replicas**: 2+ replicas with pod anti-affinity for high availability
- **Service Type**: NodePort (ports 30443 TCP/UDP for HTTPS, 30050 for gRPC h2c)
- **Load Balancing**: Kubernetes Service provides built-in load balancing across replicas
- **Benefits**: Enables multiple pods to run simultaneously, true zero-downtime CA rotation

**RollingUpdate Strategy**:
- `maxUnavailable: 0`: Never have zero pods running
- `maxSurge: 1`: One extra pod during rollout
- `replicas: 2+`: Multiple replicas for true zero-downtime
- **Pod Anti-Affinity**: Prefers pods on different nodes for better high availability

**CA Rotation**:
- **Optimized rotation script**: 1-2 seconds, 100% success rate
- **Direct Kubernetes patch**: Fastest rollout restart method (~0.4s)
- **Pod-by-pod rotation**: New pods come online before old pods terminate
- **Zero downtime**: Multiple replicas ensure continuous service availability
- **k6 distributed load testing**: Validated with k6 constant-arrival-rate executor
- **Maximum proven throughput**: **~397 req/s** (71,447 requests in 180s) with **0% failures**
- **Optimal k6 configuration**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs)
- **Breaking point**: 260/160 configuration shows 0.08% failures (violates zero-downtime)
- **Performance progression**: Tested 100/50 → 250/150, all maintaining 0% failures
- **k6 optimization**: Connection reuse, random jitter, constant-arrival-rate executor
- **Optimizations**: Removed PORT detection, eliminated output overhead, direct merge patch
- **Multi-node cluster**: Recommended for optimal pod distribution and HA

### Database Migrations

**Prisma Migrations**:
- Version-controlled schema changes
- Per-service migration strategy
- Rollback support via migration history

**Migration Process**:
1. Create migration: `pnpm prisma migrate dev`
2. Test migration: Apply to dev database
3. Deploy migration: `pnpm prisma migrate deploy` in production

### Backup Strategy

**Automated Backups**:
- Nightly `pg_dump` for all databases
- Weekly `pg_basebackup` for point-in-time recovery
- Redis snapshots nightly
- WAL archiving for continuous backup

**Backup Storage**:
- Local backups in `backups/` directory
- Future: Cloud storage integration (S3, GCS)

## Recovery Procedures & Troubleshooting

> **📖 Comprehensive Troubleshooting Guide**: For detailed documentation of all cluster stabilization issues, root causes, and solutions, see [`Runbook.md`](../Runbook.md). The Runbook covers 12 major issues including TLS handshake timeouts, missing secrets/configmaps, Kafka SSL configuration, Caddy errors, resource constraints, probe issues, and more.

### Service Recovery

**Diagnosis**:
1. Check pod status: `kubectl -n record-platform get pods`
2. Check pod events: `kubectl -n record-platform describe pod <pod-name>`
3. Check service logs: `kubectl -n record-platform logs -l app=<service> -c app --tail=200`
4. Check service endpoints: `kubectl -n record-platform get endpoints <service-name>`

**Common Issues**:
- **Pod CrashLoopBackOff**: Check logs for errors, verify environment variables, check resource limits
- **502 Bad Gateway**: Downstream service unavailable, verify service endpoints and health
- **503 Service Unavailable**: Health check failures, database/Redis connectivity issues
- **504 Gateway Timeout**: Proxy timeout too short, service response time too long

**Recovery Steps**:
1. Restart service: `kubectl -n record-platform rollout restart deployment/<service>`
2. Verify rollout: `kubectl -n record-platform rollout status deployment/<service>`
3. Check logs: Monitor logs for errors after restart
4. Test endpoint: `curl -k https://record.local:8443/api/<service>/healthz`

### Database Recovery

**Diagnosis**:
1. Check disk space: `df -h` and `docker system df`
2. Check database connectivity: `psql -h localhost -p <port> -U postgres -d <db> -c "SELECT 1"`
3. Check database logs: `docker-compose logs postgres-* | tail -100`
4. Check database pods: `kubectl -n record-platform get pods -l app=postgres`

**Common Issues**:
- **"No space left on device"**: Disk full, need cleanup
- **Connection refused**: Database not running, port mismatch
- **Connection timeout**: Network issues, firewall blocking
- **Authentication failed**: Wrong credentials, user doesn't exist

**Recovery Steps**:
1. Cleanup disk space: `docker system prune -a --volumes`
2. Restart databases: `docker-compose restart postgres-*`
3. Check connectivity: Test connection from service pod
4. Restore from backup: `make pg.restore.dump` (see `docs/postgres-infra-setup.md`)

### API Gateway Recovery

**Diagnosis**:
1. Check gateway logs: `kubectl -n record-platform logs -l app=api-gateway -c app --tail=500`
2. Check proxy errors: Filter logs for "proxy error", "502", "upstream error"
3. Check Redis connection: Filter logs for "redis", "Redis"
4. Test gateway health: `curl -k https://record.local:8443/api/healthz`

**Common Issues**:
- **502 Bad Gateway**: Downstream service unavailable
- **Socket hang up**: Service connection timeout
- **Token revocation failing**: Redis connection issue
- **Path rewrite issues**: Incorrect pathRewrite logic

**Recovery Steps**:
1. Check downstream services: Verify all services are healthy
2. Check Redis: Verify Redis connectivity and password
3. Restart gateway: `kubectl -n record-platform rollout restart deployment/api-gateway`
4. Verify routes: Test all proxy routes with curl

### Linkerd Recovery

**Diagnosis**:
1. Check Linkerd status: `linkerd check`
2. Check Linkerd pods: `kubectl -n linkerd get pods`
3. Check CoreDNS: `kubectl -n kube-system get pods -l k8s-app=kube-dns`
4. Check injection: `kubectl -n record-platform get pods -o jsonpath='{.items[*].metadata.annotations.linkerd\.io/inject}'`

**Common Issues**:
- **502 errors with Linkerd**: DNS resolution issues, control plane unavailable
- **Proxy not starting**: Linkerd control plane issues
- **mTLS failures**: Certificate issues, control plane connectivity

**Recovery Steps**:
1. Fix CoreDNS: `kubectl -n kube-system rollout restart deployment/coredns`
2. Restart Linkerd: `kubectl -n linkerd rollout restart deployment --all`
3. Re-enable injection: `kubectl annotate namespace record-platform linkerd.io/inject=enabled --overwrite`
4. Restart services: `kubectl -n record-platform rollout restart deployment --all`

**Disable Linkerd** (if causing issues):
1. Disable injection: `kubectl annotate namespace record-platform linkerd.io/inject- --overwrite`
2. Delete pods: `kubectl -n record-platform delete pods --all`
3. Verify removal: `kubectl -n record-platform get pods`

### Health Check Recovery

**Diagnosis**:
1. Check probe status: `kubectl -n record-platform describe pod <pod> | grep -A 10 "Liveness\|Readiness"`
2. Check probe failures: `kubectl -n record-platform get events | grep -E "Unhealthy|Failed"`
3. Test health endpoint: `curl -k https://record.local:8443/api/<service>/healthz`
4. Check service logs: Look for health check related errors

**Common Issues**:
- **Health check timeout**: Timeout too short, database/Redis slow
- **Health check failing**: Service not responding, dependency unavailable
- **Probe errors**: Incorrect probe configuration, service not ready

**Recovery Steps**:
1. Increase timeouts: Update `livenessProbe.timeoutSeconds` and `readinessProbe.timeoutSeconds` to 5s
2. Add internal timeouts: Add timeouts to database/Redis checks in health endpoint
3. Restart service: `kubectl -n record-platform rollout restart deployment/<service>`
4. Monitor logs: Watch for health check improvements

### Emergency Recovery

**Complete Platform Reset** (use with extreme caution):
1. **Backup**: `./scripts/backup-now.sh`
2. **Scale down**: `kubectl -n record-platform scale deployment --replicas=0 --all`
3. **Cleanup** (if safe): `kubectl -n record-platform delete pods --all`
4. **Restart**: `./scripts/bootstrap-platform.sh`
5. **Restore**: `make pg.restore.dump`

**Quick Recovery**:
1. Restart all: `kubectl -n record-platform rollout restart deployment --all`
2. Wait for ready: `kubectl -n record-platform wait --for=condition=ready pod --all --timeout=300s`
3. Verify health: Run test script `./scripts/test-microservices-http2-http3.sh`

### Performance Troubleshooting

**Slow Queries**:
1. Check database logs: Look for slow query logs
2. Check connection pools: Verify pool sizes and usage
3. Check indexes: Verify indexes exist for query patterns
4. Check query plans: Use `EXPLAIN ANALYZE` for slow queries

**High Memory Usage**:
1. Check resource limits: `kubectl -n record-platform describe pod <pod> | grep -A 5 "Limits\|Requests"`
2. Check memory leaks: Monitor memory usage over time
3. Check connection pools: Too many connections can cause high memory
4. Check caching: Verify Redis cache is working correctly

**High CPU Usage**:
1. Check CPU limits: Verify CPU requests/limits are appropriate
2. Check query performance: Slow queries can cause high CPU
3. Check worker threads: Verify thread pool sizes
4. Check load: Verify if load is expected or abnormal

## Auction Monitor Data Pipeline Architecture

### Overview

The Auction Monitor service implements a comprehensive data pipeline for ingesting, normalizing, validating, and storing auction listings from multiple platforms (eBay, Discogs, Buyee, YahooJP, CarousellHK, RecordCity). The pipeline ensures data quality before feeding into Analytics Service and Python AI Service.

**Key Features**:
- **Granular Percentiles (p1-p99)**: Calculates every percentile from p1 to p99 (not just p25, p50, p75, p95) for precise price positioning and better AI predictions
- **Discogs Price History**: Browser automation for full sales arc scraping (not just low/median/high)
- **Service Integrations**: Provides price analytics to Social Service (negotiation assistance), Shopping Service (buyer evaluation), and Listings Service (seller optimization)
- **Data Quality Engine**: Multi-factor confidence scoring (0.0-1.0) with enrichment bonuses
- **Comprehensive Documentation**: See `services/auction-monitor/SERVICE_INTEGRATIONS.md` for complete integration details

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Platform Adapters (Extract Layer)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   eBay API   │  │ Discogs API  │  │  Buyee       │        │
│  │  (Official)  │  │  (Official)  │  │  (Scraping)  │        │
│  │              │  │              │  │  Puppeteer   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  YahooJP     │  │ CarousellHK  │  │ RecordCity   │        │
│  │  (Scraping)  │  │  (Scraping)  │  │  (Multi-Region)│       │
│  │  Puppeteer   │  │  Puppeteer   │  │  Puppeteer   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
│  Rate Limiting: Redis Lua scripts (token-bucket, sliding-window)│
│  Caching: Redis with Lua singleflight (prevents thundering herd)│
│  Browser Pool: Puppeteer browser instance management            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Data Normalizer (Transform Layer)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Schema Mapping: Platform-specific → Unified schema         │
│  - Field Normalization: Currencies, conditions, formats, URLs │
│  - Price Conversion: Multi-currency support                   │
│  - Proxy Fee Calculation: Buyee/YahooJP total cost            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Validation Engine (Quality Layer)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Required Fields: Title, price, URL, external ID            │
│  - Data Types: Numeric validation, URL validation            │
│  - Business Rules: Price ranges, date validation              │
│  - Completeness Scoring: 0.0-1.0 based on field population   │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Staging Pipeline (Load Layer)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Store Raw: auction_monitor.raw_listings                   │
│  2. Normalize: Platform-specific → Unified schema             │
│  3. Validate: Required fields, data types, business rules     │
│  4. Deduplicate: Exact match, URL match, fuzzy matching       │
│  5. Enrich: Discogs catalog matching (future)                 │
│  6. Score Confidence: Multi-factor (0.0-1.0)                  │
│  7. Store Normalized: Only if valid & confidence ≥ 0.5        │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              PostgreSQL (Staging & Normalized)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  raw_listings: Raw platform data, validation status          │
│  normalized_listings: Unified schema, confidence scores       │
│  price_history: Time-series price snapshots                   │
│  user_watches: User-defined search criteria                   │
│  watch_matches: Listings matching user watches                │
│  platform_health: Platform availability monitoring            │
│  data_quality_metrics: Quality tracking per platform          │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Analytics Service Integration                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Ingests from normalized_listings (confidence ≥ 0.7)        │
│  - **Granular percentile calculation (p1-p99)** - every percentile│
│  - Historical comparison and trend analysis                   │
│  - **Discogs price history integration** (full sales arc)     │
│  - Time-series storage for price snapshots                    │
│  - **Service integrations**: Social, Shopping, Listings        │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Python AI Service Integration                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Consumes clean, validated data from Analytics Service       │
│  - ML models trained on high-quality data (confidence ≥ 0.7)  │
│  - **Uses granular percentiles (p1-p99)** for precise analysis│
│  - Price predictions, deal detection, recommendations         │
│  - **Service integrations**: Social (negotiation), Shopping (evaluation), Listings (optimization)│
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

#### 1. Two-Stage Storage (Raw → Normalized)

**Decision**: Store raw platform data separately from normalized data.

**Rationale**:
- **Reprocessing**: Raw data can be reprocessed if normalization logic changes
- **Debugging**: Original platform data preserved for troubleshooting
- **Quality Analysis**: Compare raw vs normalized to identify data quality issues
- **Audit Trail**: Complete history of data transformations

**Implementation**:
- `raw_listings`: Stores original JSONB data from platforms
- `normalized_listings`: Stores unified schema with validation results
- Foreign key relationship: `normalized_listings.raw_listing_id → raw_listings.id`

#### 2. Redis Rate Limiting with Lua Scripts

**Decision**: Use Redis Lua scripts for atomic rate limiting operations.

**Rationale**:
- **Atomic Operations**: Lua scripts execute atomically, preventing race conditions
- **Distributed Rate Limiting**: Works across multiple service instances
- **Multiple Strategies**: Token bucket, sliding window, fixed window
- **Performance**: Single round-trip to Redis per rate limit check

**Implementation**:
- **Token Bucket**: Refills tokens at a constant rate, allows bursts
- **Sliding Window**: Tracks requests in a rolling time window
- **Fixed Window**: Simple counter per time window
- **Platform-Specific**: Each platform has its own rate limit configuration

**Example**:
```typescript
// eBay: 5000 requests/day (token bucket)
await rateLimiter.acquire('ebay', {
  requests: 5000,
  window: '24h',
  strategy: 'token-bucket'
})

// Buyee: 1 request/2s (fixed window)
await rateLimiter.acquire('buyee', {
  requests: 1,
  window: '2s',
  strategy: 'fixed-window'
})
```

#### 3. Redis Caching with Lua Singleflight

**Decision**: Implement singleflight pattern using Lua scripts to prevent thundering herd.

**Rationale**:
- **Thundering Herd Prevention**: Only one request fetches data, others wait for result
- **Cache Stampede Prevention**: Prevents multiple simultaneous cache misses
- **Atomic Lock Management**: Lua scripts ensure atomic lock acquisition/release
- **Fail-Open**: Falls back to direct fetch if Redis is unavailable

**Implementation**:
- **Lock Acquisition**: First request acquires lock, fetches data
- **Wait Pattern**: Other requests wait for data to be set (polling)
- **Lock Release**: Data setter releases lock atomically
- **Timeout Handling**: Waits up to 10 seconds, then fetches directly

**Example**:
```typescript
// Multiple requests for same data
const data = await cache.getOrSet(
  'ebay:search:beatles',
  async () => {
    // Only one request executes this
    return await ebayAdapter.search({ query: 'beatles' })
  },
  { ttl: 300 }  // Cache for 5 minutes
)
```

**Lua Script Flow**:
1. Check if data exists → Return if cache hit
2. Try to acquire lock → If acquired, return "LOCK_ACQUIRED"
3. If lock exists → Return "LOCK_EXISTS" (client-side polling)
4. Lock holder fetches data → Sets data and releases lock
5. Waiting requests → Poll for data, return when available

#### 4. Browser Pool Management

**Decision**: Reuse Puppeteer browser instances instead of creating new ones per request.

**Rationale**:
- **Performance**: Browser startup is expensive (~2-3 seconds)
- **Resource Efficiency**: Reuses browser instances across requests
- **Connection Limits**: Manages page count per browser
- **Error Recovery**: Automatically removes closed/disconnected browsers

**Implementation**:
- **Pool Size**: Configurable max browsers (default: 3)
- **Pages Per Browser**: Configurable max pages (default: 5)
- **Automatic Cleanup**: Removes disconnected browsers
- **Graceful Shutdown**: Closes all browsers on service shutdown

#### 5. Confidence Scoring

**Decision**: Multi-factor confidence score (0.0-1.0) to filter low-quality data.

**Rationale**:
- **Data Quality Gate**: Only high-confidence data (≥0.7) feeds to Analytics/AI
- **Source Reliability**: Official APIs (0.95) vs scraping (0.70-0.75)
- **Completeness**: Penalizes missing required/important fields
- **Freshness**: Penalizes stale data
- **Enrichment Bonus**: Rewards catalog number matches

**Factors**:
- **Completeness**: Percentage of required/important fields populated
- **Source Reliability**: Platform-specific reliability score
- **Validation Errors**: Penalty for each validation error
- **Warnings**: Smaller penalty for validation warnings
- **Enrichment**: Bonus for Discogs catalog matches (future)

**Thresholds**:
- **≥0.7**: High confidence, fed to Analytics Service (with granular percentiles p1-p99)
- **≥0.8**: Very high confidence, optimal for Python AI Service
- **0.5-0.7**: Medium confidence, stored but not analyzed
- **<0.5**: Low confidence, stored in raw_listings only

**Granular Percentiles**:
- **Implementation**: Calculates every percentile from p1 to p99 (not just p25, p50, p75, p95)
- **Benefits**: Precise price positioning, better negotiation guidance, accurate AI predictions
- **Storage**: All percentiles stored in `price_history.metadata` for detailed analysis
- **Price Position**: Calculates which percentile current price falls into (0.0-1.0)

### Platform-Specific Implementation

#### Official APIs (eBay, Discogs)

**Advantages**:
- High reliability (0.95 confidence)
- Structured data, easy to parse
- Rate limits documented
- No anti-bot measures

**Challenges**:
- API key management
- Rate limit compliance
- OAuth for user-specific data (eBay)

#### Web Scraping (Buyee, YahooJP, CarousellHK, RecordCity)

**Advantages**:
- Access to platforms without APIs
- Can extract additional data not in APIs

**Challenges**:
- HTML structure changes break scrapers
- Anti-bot measures (CAPTCHAs, rate limiting)
- Lower reliability (0.70-0.75 confidence)
- Requires browser automation (Puppeteer)

**Mitigation**:
- **Rate Limiting**: Respectful scraping (1-2 requests/second)
- **Error Handling**: Graceful degradation, retry logic
- **Monitoring**: Track scraping success rates
- **Browser Pool**: Efficient resource usage

### Data Quality Metrics

**Tracking**:
- Total ingested vs validated listings per platform
- Average confidence and completeness scores
- Duplicate detection rates
- Enrichment rates (catalog number matches)
- Platform health (uptime, response times)

**Alerting**:
- Low confidence scores (<0.7 average)
- High failure rates (>10%)
- Platform downtime
- Data quality degradation

### Performance Optimizations

1. **Redis Caching**: Reduces redundant API calls and scraping
2. **Browser Pool**: Reuses expensive browser instances
3. **Rate Limiting**: Prevents platform blocking
4. **Batch Processing**: Processes multiple listings in parallel
5. **Database Indexes**: Fast lookups for deduplication and matching

### Service Integrations

**Social Service Integration**:
- **Negotiation Assistance**: Price context (granular percentiles p1-p99) for buyer/seller negotiations
- **Mood Analysis**: Python AI analyzes negotiation mood based on price position
- **Bigger Context**: Market trends, new drops detection
- **API Endpoints**: `GET /analytics/price-percentiles`, `POST /python-ai/negotiation-assist`
- **Example**: Buyer offers $45, system shows it's at p25 (good deal), suggests seller might accept $47-48 (p50-p60 range)

**Shopping Service Integration**:
- **Buyer Evaluation**: Price assessment using granular percentiles (p1-p99)
- **Negotiation Suggestions**: OBO (or best offer) recommendations based on percentile position
- **Auction Temperature**: Bid activity analysis, watcher count, time remaining
- **API Endpoints**: `GET /analytics/evaluate-price`, `GET /analytics/auction-temperature`
- **Example**: Item at $50 (p60), system suggests negotiating to $45-48 range with 65% success probability

**Listings Service Integration**:
- **Seller Optimization**: Pricing guidance using granular percentiles (p1-p99)
- **Listing Recommendations**: Title, description, photo suggestions based on successful listings
- **Price Positioning**: Optimal listing price based on percentile analysis
- **API Endpoints**: `GET /analytics/pricing-guidance`, `GET /analytics/successful-listings`, `POST /python-ai/optimize-listing`
- **Example**: Seller lists at $60 (above p75), system recommends $48 (p50) for better visibility

**Complete Integration Documentation**: See `services/auction-monitor/SERVICE_INTEGRATIONS.md` for detailed API specifications, example flows, and implementation status.

### Recent Enhancements

1. ✅ **Granular Percentiles**: p1-p99 calculation (replaces coarse p25/p50/p75/p95)
2. ✅ **Discogs Price History**: Browser automation for full sales arc (not just low/median/high)
3. ✅ **Service Integrations**: Social, Shopping, Listings service integration documentation
4. ✅ **Data Quality Engine**: Multi-factor confidence scoring with enrichment bonuses

### Future Enhancements

1. **Service Integration Endpoints**: Implement APIs for Social, Shopping, Listings services
2. **CAPTCHA Automation**: Integration with automated CAPTCHA solving services
3. **Additional Platforms**: Buyee, YahooJP, CarousellHK, RecordCity adapters
4. **Proxy Rotation**: Rotate IP addresses for scraping
5. **Machine Learning**: ML-based confidence scoring
6. **Real-Time Updates**: WebSocket/SSE for live price updates

## Future Enhancements

### Planned Improvements

1. **Service Mesh**: Full Linkerd integration for mTLS and traffic management
2. **Multi-Region**: Geographic distribution for lower latency
3. **GraphQL API**: Alternative to REST/gRPC for flexible queries
4. **Event Sourcing**: Complete audit trail of all changes
5. **CQRS**: Separate read/write models for better scalability
6. **Centralized Logging**: ELK stack or Loki for log aggregation
7. **Advanced Caching**: Multi-level caching with CDN integration
8. **API Versioning**: Support multiple API versions simultaneously

### Scalability Considerations

**Horizontal Scaling**:
- All services stateless (except database connections)
- Easy to scale with Kubernetes replicas
- Database read replicas for read-heavy workloads

**Vertical Scaling**:
- Resource requests/limits per service
- Database connection pool tuning
- Redis memory optimization

---

For questions or contributions, see [`README.md`](README.md) or open an issue.

