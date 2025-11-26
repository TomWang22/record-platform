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
│              Port 443 (HTTPS) | Port 8443 (HTTPS) | Port 5000 (h2c)        │
│                                                                              │
│  Features:                                                                   │
│  - Zero-downtime CA rotation via admin API (localhost:2019)                │
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

**Implementation**: Services connect via `host.docker.internal:PORT` from Kubernetes pods, with dedicated ports:
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
- ✅ 100% success rate (120/120 and 60/60 requests)
- ✅ ~16-17 second rotation time
- ✅ Zero downtime achieved

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
- **Kafka**: Event streaming, real-time messaging

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
    ├─► Monitor eBay API
    │   └─► Track Auction Prices
    │
    └─► Write: Auction Monitor DB (5438) - auction_monitor.auction_results
        └─► Store Price History
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

## Infrastructure as Code

### Terraform

**Purpose**: Declarative Kubernetes infrastructure provisioning.

**Structure**:
- `main.tf`: Provider configuration and main resources
- `variables.tf`: Input variables (namespace, environment, kubeconfig)
- `outputs.tf`: Output values (namespace, kubeconfig path, service ports)
- `kubernetes.tf`: Kubernetes resources (namespaces, ConfigMaps)

**Usage**:
```bash
cd infra/terraform
terraform init
terraform plan    # Dry-run
terraform apply   # Apply changes
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

**Usage**:
```bash
cd infra/ansible
ansible-playbook playbooks/deploy-services.yml --check  # Dry-run
ansible-playbook playbooks/deploy-services.yml          # Deploy
```

## Observability & Monitoring

### Metrics (Prometheus)

**Collection**:
- ServiceMonitors: Auto-discovery of service metrics
- PodMonitors: Pod-level metrics collection
- Scrape interval: 15-30 seconds
- Retention: 30 days

**Key Metrics**:
- Request rate, latency, error rate per service
- gRPC call metrics (success/failure, latency)
- Database connection pool metrics
- Cache hit/miss rates
- HTTP/2 and HTTP/3 connection metrics

### Tracing (Jaeger)

**Instrumentation**:
- OpenTelemetry SDK for Node.js and Python
- Automatic trace propagation via gRPC metadata
- Custom spans for business logic

**Trace Flow**:
```
Client Request
    │
    ├─► Caddy (span: edge)
    ├─► API Gateway (span: gateway)
    ├─► Backend Service (span: service)
    └─► Database Query (span: db)
```

### Logging

**Structured Logging**:
- JSON format for easy parsing
- Correlation IDs for request tracing
- Log levels: DEBUG, INFO, WARN, ERROR

**Log Aggregation**:
- Kubernetes pod logs via `kubectl logs`
- Future: Centralized logging with ELK stack or Loki

## Performance Optimizations

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

### Caching Strategy

**Redis Caching**:
- Search results cached with normalized keys
- User-specific cache invalidation
- Singleflight pattern prevents cache stampedes

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

**Strict TLS Enforcement**:
- TLS 1.2 and 1.3 only
- TLS 1.1 and below rejected
- Validated via test scripts

**Certificate Management**:
- mkcert for local development
- Kubernetes secrets for certificate storage
- Zero-downtime CA rotation via admin API

### Network Security

**Service Isolation**:
- Kubernetes network policies (future)
- Database isolation (8 separate instances)
- Redis password protection

**Ingress Security**:
- TLS termination at Caddy
- Host-based routing
- Rate limiting at multiple layers

## Deployment Strategy

### Zero-Downtime Deployments

**RollingUpdate Strategy**:
- `maxUnavailable: 0`: Never have zero pods running
- `maxSurge: 1`: One extra pod during rollout
- `replicas: 2+`: Multiple replicas for true zero-downtime

**CA Rotation**:
- Admin API reload: ~16 seconds, 100% success
- Pod restart fallback: If admin API fails
- Multi-node cluster: Required for pod-by-pod rotation

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

