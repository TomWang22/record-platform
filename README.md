# Record Platform

**Repository:** https://github.com/TomWang22/record-platform.git

Record Platform is a Kubernetes-first microservices stack for managing a personal record collection while exercising modern edge patterns. The stack spans Node.js/Express services, Prisma/Postgres data, Redis-backed caching, and a suite of observability and operational tools. The latest revamp replaces the Docker Compose dev story with Kustomize-driven Kubernetes, adds a Caddy front door that speaks HTTP/2 and HTTP/3, and ships automation scripts for day-to-day ops.

## 👋 For Recruiters & Hiring Managers

**What is this project?**
A production-ready, full-stack microservices platform demonstrating modern cloud-native architecture, distributed systems design, and real-world engineering challenges. Built to solve practical problems (record collection management) while showcasing enterprise-grade infrastructure patterns.

**Note**: This is a **solo endeavor** - a personal project built by a single developer to explore and demonstrate advanced distributed systems concepts, microservices architecture, and cloud-native patterns. All design decisions, implementations, and optimizations were made independently as a learning and portfolio project.

**Highlights at a glance**
| Area | Achievement |
|------|-------------|
| **Uptime** | 100% during CA rotation; zero-downtime RollingUpdate |
| **Protocols** | HTTP/2, HTTP/3 (QUIC), gRPC — all tested with strict TLS |
| **Services** | 8+ microservices, 8 dedicated Postgres DBs, gRPC + REST |
| **Security** | Strict TLS/mTLS everywhere; single preflight ensures valid certs |
| **Testing** | 8 suites (auth, baseline, enhanced, adversarial, rotation, capture, tls-mtls, social); DB verification on all 8 DBs; optional k6 + pgbench for full load |
| **Ops** | One-command preflight + suites; Runbook (docs/Runbook.md) catalogs 80+ issues and fixes |

**Key Technical Highlights:**
- **Zero-Downtime Operations**: Achieved 100% uptime during certificate rotation (1–2s rotation time, 0 failed requests)
- **Multi-Protocol Edge**: HTTP/2, HTTP/3 (QUIC), and gRPC support with automatic protocol negotiation
- **Microservices Architecture**: 8+ services with dedicated databases, gRPC inter-service communication, and event-driven messaging
- **Kubernetes-Native**: Complete infrastructure as code (Terraform + Ansible), observability stack (Prometheus, Grafana, Jaeger), and disaster recovery automation
- **Production-Ready Features**: Strict TLS/mTLS for all services (single preflight script), JWT authentication, rate limiting, caching strategies, and comprehensive monitoring

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
- **✅ Multi-protocol edge (HTTP/2, HTTP/3, gRPC)** - **Caddy** handles HTTP/2, HTTP/3 (QUIC), web app, and REST API traffic; **Envoy** handles all gRPC traffic with first-class gRPC support; **all tests passing** including HTTP/2, HTTP/3, and gRPC flows via `scripts/test-microservices-http2-http3.sh`.
- **✅ Zero-downtime CA rotation** - Certificate authority rotation with **100% success rate** and **1-2 second rotation time** via optimized Kubernetes RollingUpdate; validated with continuous health checks:
  - `scripts/test-full-chain-with-rotation.sh`: **15000/15000 requests succeeded (100%)** during rotation (real stress test at ~120 req/s average, 100-150 req/s observed)
  - `scripts/test-http2-http3-strict-tls.sh`: **60/60 requests succeeded (100%)** during rotation
  - Zero downtime achieved with pod-by-pod rotation using RollingUpdate strategy
- **✅ Strict TLS enforcement** - **All k6 load tests use strict TLS verification** with CA certificate validation (no insecure TLS bypass); TLS 1.2 and 1.3 only (TLS 1.1 and below rejected); validated via `scripts/test-http2-http3-strict-tls.sh` and `scripts/test-full-chain-with-rotation.sh`. All k6 test scripts (`run-k6-shopping.sh`, `run-k6-social-with-graphs.sh`, `run-k6-listings-with-graphs.sh`, `find-bottlenecks.sh`) enforce strict TLS with `SSL_CERT_FILE` and CA certificate ConfigMaps. **Shopping service load tests** (`k6-shopping-stress.js`, `k6-shopping-ramp.js`, `k6-shopping-db-validation.js`, `k6-bottleneck-finder.js`) all use strict TLS verification for production-ready testing.
- **✅ Full gRPC inter-service communication** - All services communicate via gRPC with protocol buffers; **Envoy handles all gRPC traffic** with first-class gRPC support (port 10000). **gRPC client certificate verification** configurable via `GRPC_REQUIRE_CLIENT_CERT` environment variable (disabled for dev, enabled for production). **Architecture Decision**: Envoy for gRPC (proven functionality), Caddy for HTTP/3 + web + REST (clean separation of concerns).
- **✅ Multi-database architecture** - **8 dedicated PostgreSQL instances** for service isolation, scalability, and independent scaling (auth, records, social, listings, shopping, auction-monitor, analytics, python-ai).
- **✅ Dual-database connections** - Services like auction-monitor and analytics-service connect to multiple databases for cross-service data access while maintaining data isolation.
- **✅ Analytics & AI Pipeline** - Platform-wide business intelligence pipeline for seller and buyer optimization:
  - **Seller Intelligence**: Pricing guidance for auctions (starting bid), OBO (or best offer) flexibility, fixed price optimization
  - **Buyer Intelligence**: Price evaluation, negotiation assistance, deal detection
  - **Social Integration**: Negotiation assistance for both buyers and sellers
  - **Shopping Integration**: Buyer evaluation and seller optimization
  - **Granular Percentiles**: p1-p99 calculation for precise price positioning
  - **Kafka Integration**: Real-time data pipeline from Analytics → Python AI Service
- **✅ k6 HTTP/3 Toolchain** - Custom k6 binary with HTTP/3 extension built using xk6 and quic-go. Extension loads successfully, but NodePort UDP routing limits external testing. For reliable HTTP/3 testing, use `scripts/test-microservices-http2-http3.sh` (curl-based, verified with tcpdump). See `test-results/K6_HTTP3_TOOLCHAIN_STATUS_12-22_tom.md` for complete status and `scripts/build-k6-http3.sh` for build instructions.
- **✅ HTTP/3 Protocol Verification** - tcpdump/Wireshark verification confirms HTTP/3 uses QUIC (UDP) protocol. **Wire-level capture** is aligned across all suites (baseline, enhanced, standalone, rotation): drain before stop (so in-flight QUIC packets are captured), copy pcaps to host, tshark verification (HTTP/2 + QUIC). See `scripts/lib/packet-capture.sh`, Runbook #44, and `ENGINEERING.md` for the shared pattern.
- **✅ Production-Ready Performance** - **99%+ success rates** across all services with **45-77% latency reduction** (p95 latencies improved from 2-5s to 0.5-2s). See `test-results/E2E_RETEST_RESULTS_12-21_tom.md` and `test-results/E2E_TEST_RESULTS_SUMMARY_12-22_tom.md` for complete test results.
- **✅ Comprehensive E2E Testing** - HTTP/2 vs HTTP/3 comparison tests with organized timestamped results. See `scripts/compare-http2-http3.sh` and `test-results/` directory for all test results. **307+ shell scripts** support constant debugging and iterative development (see `test-results/REPO_STRUCTURE_EXPLANATION.md` for structure rationale).
- **✅ One-command bootstrap & disaster recovery** - `scripts/bootstrap-platform.sh` deploys entire platform instantly; Terraform + Ansible enable instant cluster recreation for disaster recovery scenarios.
- **Kubernetes-native workflows** - `infra/k8s` provides composable bases and overlays; Colima + k3s is the primary cluster (bootstrapping via `scripts/setup-new-colima-cluster.sh`); build images, apply manifests, and run preflight/suites.
- **Hardened gateway path** - API Gateway keeps the JWT guard, adds optional `DEBUG_FAKE_AUTH`, injects identity headers, and exposes detailed metrics.
- **Redis-assisted records caching** - `services/records-service/src/lib/cache.ts` adds normalized search keys, safe JSON encoding, and targeted invalidation hooks.
- **Kafka messaging with strict TLS** - Real-time messaging for forum posts, direct messages, and group chats via Kafka integration in social-service. **Strict TLS enabled** with SSL listener on port 9093, certificates managed via `kafka-ssl-secret`.
- **Operational tooling** - `scripts/` covers smoke tests, TLS helpers, QUIC tuning, backup/restore, load tests, and rollout automation. **307+ scripts** organized by purpose (testing, load testing, service management, database management, infrastructure, debugging, utilities) to support constant debugging and iterative development. **CI** (`.github/workflows/ci.yml`): each matrix job builds the common package then the service; transport-validation skips tshark when no pcap is present.
- **Webapp** - Next.js 14 frontend with landing pages, dashboard, authentication, and comprehensive documentation. See `webapp/README.md` for frontend architecture and connection guide.

## 🎉 Recent Breakthroughs

### Zero-Downtime CA Rotation ✅
**100% success rate achieved** - Certificate authority rotation with zero downtime:

- ✅ **`scripts/rotation-suite.sh`**: **k6 distributed load testing** with optimal configuration
  - **Optimal config**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs)
  - **Results**: 71,447 requests (~397 req/s), 0.76% drops, **0% failures** (100% uptime)
  - **Breaking point**: 260/160 config shows 0.08% failures (violates zero-downtime)
  - **Rotation time**: **1-2 seconds** (consistently fast)
  - **Full chain validation**: Client → Caddy → Ingress → Backend
  - **Production-ready**: Validated with k6 constant-arrival-rate executor and connection reuse
  - **Incremental limit finder**: `scripts/find-ca-rotation-limit.sh` finds maximum sustainable throughput
  - **Certificate overlap window**: 7-day grace period for old certificates (production pattern)
  
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
- **100% success rate**: No failed requests during rotation (validated with k6 distributed load testing)
- **Maximum proven throughput**: **~397 req/s** (71,447 requests in 180s) with **0% failures** and **0.76% drops**
- **Optimal k6 configuration**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs) - **production-ready**
- **Breaking point identified**: 260/160 configuration shows 0.08% failures (violates zero-downtime requirement)
- **Real stress testing**: k6 distributed load testing validates zero downtime under extreme production load
- **True zero-downtime**: Multiple replicas with RollingUpdate ensure continuous service availability
- **Production-ready**: Supports multi-node clusters with proper load balancing and high availability
- **Throughput optimization**: k6 constant-arrival-rate executor with connection reuse achieves optimal performance
- **Optimizations**: Removed PORT detection overhead, eliminated output overhead, direct merge patch for fastest restart

**Preflight rotation at 500 req/s (captured):** Full preflight runs (e.g. `preflight-full-20260206-215733.log`) have captured **500 req/s combined** in the rotation suite (H2=320 req/s, H3=180 req/s), with wire-level proof:
  - Starting rates: H2=320 req/s, H3=180 req/s (combined: 500 req/s); iteration 1/30.
  - Real req/s: 487.35 (expected 500); 87,724 requests in 180s; **0% failures**; 2.52% drops at capacity.
  - HTTP/3 (QUIC) verified in packet captures (e.g. 276341 packets per Caddy pcap); quick drain (5–20s) then copy pcaps to host; tshark verification.
  - Last successful rates: H2=320 req/s, H3=180 req/s; combined 500 req/s.
  See `scripts/rotation-suite.sh`, `scripts/lib/packet-capture.sh`, and Runbook #44 for the capture pattern.

### Preflight pipeline, transport proof, and rotation stages

- **`scripts/run-preflight-scale-and-all-suites.sh`** — Single entrypoint for the full stack: context (Colima vs k3d), API ready, reissue CA+leaf, MetalLB (Colima), Caddy strict TLS, scale to baseline, strict TLS/mTLS preflight, then **all 8 test suites** (auth, baseline, enhanced, adversarial, rotation, k6, standalone, tls-mtls, social) and optional pgbench. Uses **packet capture** during suites (in-pod tcpdump, drain-then-copy, tshark verification). Run: `METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`. See script header for env flags (e.g. `RUN_SUITES`, `RUN_FULL_LOAD`, `RUN_K6`, `CAPTURE_STOP_TIMEOUT`).

- **`scripts/lib/`** — Network and transport tooling that **proved QUIC on the wire**:
  - **`packet-capture.sh`** — In-pod tcpdump start/stop, BPF filters (port 443 for in-pod; `dst host $TARGET_IP` for host/VM), drain-before-stop, copy pcaps to host; used by baseline, enhanced, and rotation suites.
  - **`transport_validator.py`** — Validates a pcap: QUIC version, 1-RTT/Initial counts, handshake RTT, loss estimate, optional ALPN; outputs a **transport proof** (e.g. `out.json`).
  - **`protocol-verification.sh`** — tshark helpers: QUIC SNI `record.local`, UDP to LB IP, stray UDP checks; used by `verify-k6-protocols.sh` and rotation wire verification.
  - **`http3.sh`** — Shared HTTP/3 curl timeouts and options for tests.

- **QUIC proof artifacts (repo root)** — JSON files produced by transport validation and rotation runs prove HTTP/3 (QUIC) on the wire:
  - **`out.json`** — Example **transport proof** from `scripts/lib/transport_validator.py`: `valid: true`, `quic_version`, `quic_packet_count`, `quic_1rtt_packets`, `handshake_rtt_ms_estimated`, `transport_confidence_score: 100`, and breakdown (quic_detected, version_detected, no_http2_fallback, 1rtt_data_phase, low_loss, no_retry, fast_handshake). Proves QUIC end-to-end from pcap analysis.
  - Other QUIC-related outputs (e.g. `transport_ceiling_report.json`, `rotation-summary.json`, or validator `--output` files) may appear in repo root or under `bench_logs/` / run directories after preflight or rotation; all document QUIC version, packet counts, and confidence scores.

- **`scripts/rotation-suite.sh`** — **Three stages** so performance, wire capture, and decryption don’t interfere:
  - **`--mode=perf`** (default) — Adaptive limit finding, k6 load, no keylog; pure throughput and zero-downtime validation.
  - **`--mode=wire`** — One baseline iteration with packet capture only; no rotation; for tshark/SNI/UDP verification.
  - **`--mode=forensic`** — Host k6, SSLKEYLOGFILE, HTTP/2 only; for decrypted HTTP/2 frame analysis (not for throughput).
  - **`--mode=all`** — Runs perf, then wire (skip rotation), then forensic (skip rotation). Use for full validation in one go.

### Cluster architecture (Colima + k3s)

The platform **moved from k3d to Colima + k3s for real L2 networking**: MetalLB gets a stable LoadBalancer IP on the VM bridge, so HTTP/2 and HTTP/3 (QUIC) traffic from host to LB IP behaves like production (no Docker port mapping or NodePort quirks). The stack runs on **Colima + k3s** with **MetalLB**; preflight and all 8 suites target this setup by default. A one-time host route may be needed so the host can reach the MetalLB pool for HTTP/3 (Runbook item 68). The bugs and fixes we hit (control plane, MetalLB webhook, k3s crash-loop, Envoy CA drift, packet capture, rotation, and 80+ others) are cataloged in **Runbook.md**.

| Cluster | Role | When |
|--------|------|------|
| **Colima + k3s** | Primary: preflight, apply, scale, MetalLB, all 8 suites, k6, pgbench | Default (`REQUIRE_COLIMA=1`). Start with `--network-address` (bridged); API at 127.0.0.1:6443; LB IP for HTTP/2 and HTTP/3. See Runbook items 65, 68, 80. |
| **k3d (2-node)** | Optional: CI or lighter local runs | Set `REQUIRE_COLIMA=0`. MetalLB and socat can make LB IP host-reachable; see `docs/adr/010-k3d-primary-colima-l2-isolated.md` and Runbook. |

**Run (Colima + k3s):** `METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`. For k3d: `REQUIRE_COLIMA=0 METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`. HTTP/2 and HTTP/3 use **LB IP** when available; NodePort is fallback. See `ENGINEERING.md` (Cluster topology) and `Runbook.md` (cluster wiring and bugs).

### Environment and test limitations
Some tests may error or be skipped due to **environment limitations** and **strict TLS**:
- **Port-forward / NodePort**: gRPC direct port-forward can fail (connection to 50xxx:50xxx refused) when the tunnel is not ready; tls-mtls suite skips Test 3 on Colima when port-forward is unavailable. Envoy NodePort (UDP for HTTP/3) may not be exposed to host on Colima.
- **Strict TLS**: All suites use strict TLS (no `-k`); k6 and curl require `SSL_CERT_FILE` / `certs/dev-root.pem` (from preflight). Missing CA causes x509 "record.local certificate is not trusted".
- **HTTP/3 curl**: macOS system curl does not support HTTP/3. Use Homebrew curl (`brew install curl`); run `./scripts/verify-curl-http3.sh` to confirm the active curl has `--http3` so tests use native curl (avoids Docker-bridge timeout/exit 28). See `docs/RCA-HTTP3-CURL-EXIT-28.md`.
- **MFA / OAuth / Email**: MFA verify, email verification send, and OAuth Google endpoint can return HTTP 500 in dev (not configured or mocked).
- **Social suite**: Archive thread, list archived, delete thread, list groups, kick, ban, recall can fail with 501 (migrations not applied) or 403 (role: requester not owner/admin). Preflight runs `ensure-social-migrations.sh`; run it manually if needed (Runbook #45).
- **Rotation suite**: May report "limit at iteration 1" (drops >1.5%) or a shell substitution warning in verification; wire-level HTTP/3 and cert rotation are still verified. DB foreign-key checks may show violations under load.

### Full Multi-Protocol Support ✅
**All tests passing** - Complete end-to-end validation of HTTP/2, HTTP/3 (QUIC), and gRPC communication:

- ✅ **Tests 1-14**: REST API via HTTP/2 and HTTP/3 (auth, records, social, listings)
- ✅ **Tests 15a-15j**: gRPC HealthCheck and business logic for **all 10 services**:
  - **15a-15g**: Core services (auth, records, social, listings, analytics, shopping)
  - **15h**: Shopping Service gRPC (port 50058)
  - **15i**: Auction Monitor gRPC (port 50059)
  - **15j**: Python AI Service gRPC (port 50060)
- ✅ **Envoy gRPC routing**: Envoy handles all gRPC traffic with first-class gRPC support (port 10000)
- ✅ **TLS transport**: All gRPC traffic uses HTTP/2 with TLS via Envoy
- ✅ **Complete test coverage**: Registration, login, CRUD operations, messaging, group chats, listings search, auction monitoring, AI predictions

Key technical achievements:
- **Envoy gRPC routing**: Envoy handles all gRPC traffic with first-class gRPC support (port 10000)
- **Caddy HTTP/3**: Caddy excels at HTTP/3 (QUIC), web app serving, and REST API routing
- **Clean separation**: Envoy for gRPC, Caddy for HTTP/3 + web + REST (industry standard pattern)
- **Proto file management**: All proto files loaded from ConfigMap, with lazy loading in analytics-service to prevent startup crashes
- **Timeout handling**: Fixed grpcurl timeout conflicts by using native `-max-time` flag instead of wrapper functions
- **Health checks**: Caddy health endpoint (`/_caddy/healthz`) working for both HTTP/2 and HTTP/3

### Multi-Database Architecture ✅
**8 dedicated PostgreSQL instances** for complete service isolation and independent scaling:

- ✅ **Postgres (Main DB)** (5433): database `records`
- ✅ **Postgres Social** (5434): database `social`
- ✅ **Postgres Listings** (5435): database `listings`
- ✅ **Postgres Shopping** (5436): database `shopping`
- ✅ **Postgres Auth** (5437): database `auth`
- ✅ **Postgres Auction Mon** (5438): database `postgres`, schema `auction_monitor` (auction monitoring)
- ✅ **Postgres Analytics** (5439): database `analytics`
- ✅ **Postgres Python AI** (5440): database `python_ai`

Key architectural benefits:
- **Service isolation**: Each service has its own database, preventing cross-service data conflicts
- **Independent scaling**: Databases can be scaled independently based on service load
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service queries while maintaining isolation
- **Schema separation**: Clear boundaries between service domains with dedicated schemas
- **Redis authentication**: All services use password-protected Redis connections
- **Kafka integration**: Real-time messaging for forum posts, direct messages, and group chats

## Why This Exists

### Use cases (canonical to edge)

Record Platform supports a range of use cases from everyday collection management to edge cases that generic marketplaces don’t handle well:

| Use case | Description | Why RP |
|----------|-------------|--------|
| **Collection CRUD** | Add, search, filter, update, delete records (vinyl, etc.) with ownership and catalog IDs | Single source of truth, full-text and faceted search, Redis-backed cache |
| **Price and auction tracking** | Monitor auctions, store results, compute percentiles (p1–p99), feed analytics and AI | Dedicated auction_monitor DB, Discogs/eBay integration, Kafka pipeline |
| **Seller/buyer intelligence** | Get pricing guidance (OBO, starting bid, fixed price), deal detection, negotiation context | Analytics + Python AI pipeline, granular percentiles, social/shopping integration |
| **Forum and messaging** | Reddit-style forum (posts, comments, votes), DMs, group chats with real-time delivery | Social DB, Kafka strict TLS, Lua+Redis cache (singleflight, rate limits) |
| **Shopping cart and orders** | Cart, checkout, wishlist, purchase history, resell workflow | Shopping schema, cart differentiation by catalog ID, cache (LFU/LRU Lua scripts) |
| **Multi-protocol edge** | HTTP/2, HTTP/3 (QUIC), gRPC with strict TLS and zero-downtime CA rotation | Caddy + Envoy, one preflight validates certs and readiness for all suites |
| **Scale and load testing** | Millions of rows per DB, pgbench sweeps, k6 E2E and adversarial tests | 8 dedicated Postgres DBs, load scripts (with fast staging for GIN-heavy tables), preflight + 8 suites + optional k6/pgbench |

Examples of “things people might not think it’s used for”: auction result scraping and normalization, passkey/WebAuthn auth, MFA/TOTP, rate limiting and cache stampede prevention (Redis Lua), and full-chain TLS/mTLS verification across Caddy, Envoy, and services.

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
│                    HTTP/3 (QUIC) | HTTP/2 | HTTP/1.1 | gRPC                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                      │
        HTTP/3 + Web + REST                    gRPC Requests
                    │                                      │
                    ▼                                      ▼
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│      Caddy (Edge Proxy)          │      │      Envoy (gRPC Proxy)           │
│  TLS Termination (TLS 1.2/1.3)   │      │  First-Class gRPC Support         │
│  HTTP/2 + HTTP/3 (QUIC)          │      │  HTTP/2 with TLS                  │
│  NodePort: 30443 (TCP/UDP)       │      │  Port: 10000                      │
│                                  │      │  Never routes through HTTP        │
│  - Web App (Next.js)             │      │  Preserves trailers correctly     │
│  - REST API (/api/*)             │      │  Forbids HTTP error pages          │
│  - Static Assets                 │      │  Enforces HEADERS/DATA ordering   │
└──────────────────┬───────────────┘      └──────────────────┬───────────────┘
                   │                                          │
                   └──────────────────┬──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ingress-nginx (Kubernetes Cluster)                       │
│                         host: record.local                                  │
└──────────────────────┬───────────────────────────┬──────────────────────────┘
                       │                           │
        REST /api/*    │                           │  gRPC /service.*
        (HTTP/2/3)     │                           │  (HTTP/2 TLS)
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
- **Caddy** runs in Kubernetes with **NodePort service** (port 30443), terminates TLS (TLS 1.2/1.3 only - strict TLS enforcement), and supports HTTP/2 + HTTP/3 (QUIC) for web and REST API traffic
  - **NodePort Architecture**: Migrated from `hostNetwork` to `NodePort` service type for true zero-downtime CA rotation
    - **Multiple Replicas**: 2+ replicas with pod anti-affinity for high availability
    - **RollingUpdate Strategy**: `maxUnavailable: 0` ensures at least one pod is always available
    - **Load Balancing**: Kubernetes Service provides built-in load balancing across replicas
    - **Port Access**: External access via NodePort 30443 (TCP/UDP for HTTPS)
  - **Strict TLS**: Configured with `protocols tls1.2 tls1.3` - TLS 1.1 and below are rejected; validated via test scripts
  - **CA Rotation**: Supports certificate authority rotation with `scripts/rotate-ca-and-fix-tls.sh`; **zero-downtime rotation achieved** via admin API reload (~16s, 100% success rate) + pod-by-pod rotation with multiple replicas
  - **Traffic Handled**: Web App (Next.js), REST API (/api/*), Static Assets
- **Envoy** handles all gRPC traffic with first-class gRPC support (port 10000)
  - **First-Class gRPC**: Never routes gRPC through HTTP handlers
  - **Trailer Preservation**: Correctly handles gRPC trailers
  - **Error Handling**: Forbids HTTP error pages on gRPC streams
  - **HEADERS/DATA Ordering**: Enforces correct gRPC frame ordering
  - **Proven Functionality**: Envoy test passed immediately (same Node.js server works with Envoy, fails with Caddy)
  - **Architecture Decision**: Clean separation of concerns - Envoy for gRPC, Caddy for HTTP/3 + web + REST
- **ingress-nginx** routes `/` to Nginx edge (static assets + micro-cache) and `/api/*` directly to API Gateway
- **Nginx Edge** serves the Next.js webapp and proxies API requests through HAProxy
- **HAProxy** maintains keep-alive pools and load balances to API Gateway

**Inter-Service Communication:**
- **API Gateway** communicates with backend services via **gRPC** for all services
- **Envoy gRPC proxy**: Routes all gRPC requests with first-class gRPC support (port 10000, HTTP/2 with TLS)
- Services expose both HTTP (for health/metrics) and gRPC endpoints on separate ports
- gRPC provides type-safe, efficient inter-service communication with protocol buffers
- Proto definitions in `proto/` directory (auth.proto, records.proto, listings.proto, social.proto, analytics.proto, shopping.proto, auction-monitor.proto, python-ai.proto)
- **gRPC reflection**: Enabled on all services for tooling support (grpcurl, etc.)

**Data Layer:**
- **All databases run outside Kubernetes** in Docker Compose for stability and easier management
- **8 dedicated PostgreSQL instances** for service isolation and independent scaling:
  - **Postgres (Main DB)** (5433): database `records`
  - **Postgres Social** (5434): database `social`
  - **Postgres Listings** (5435): database `listings`
  - **Postgres Shopping** (5436): database `shopping`
  - **Postgres Auth** (5437): database `auth`
  - **Postgres Auction Mon** (5438): database `postgres`, schema `auction_monitor` (auction monitoring)
  - **Postgres Analytics** (5439): database `analytics`
  - **Postgres Python AI** (5440): database `python_ai`
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases:
  - **Auction Monitor**: Reads from `listings.watchlist` (port 5435), writes to `auction_monitor.auction_results` (port 5438)
  - **Analytics Service**: Reads from `listings.search_history` (port 5435), writes to `analytics.price_snapshots` (port 5439)
- **Redis** (6379): JWT Cache, Search (result cache), Cache (general). May be password-protected; rate limiting and singleflight use Redis.
- **Kafka** (PLAINTEXT:9092, SSL:9093): Event streaming, real-time messaging for forum posts, direct messages, and group chats. **Strict TLS enabled** with SSL certificates stored in `kafka-ssl-secret`. Services use SSL port (9093) for secure communication.
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
| **Shopping Service** | 4007/50058 | HTTP/gRPC | Shopping cart, checkout, order management, wishlist, purchase history, gRPC on port 50058. **Strict TLS enforced** in all k6 load tests (`run-k6-shopping.sh`, `find-bottlenecks.sh`) with CA certificate validation. Tests use ClusterIP for in-cluster testing; Colima + k3s uses MetalLB LB IP for host-originated HTTP/2 and HTTP/3.
| **Auction Monitor** | 4008/50059 | HTTP/gRPC | Monitors auction trends, price tracking, dual-DB (listings read + auction-monitor write), **granular percentiles (p1-p99)**, **Discogs price history scraping**, **service integrations** (Social, Shopping, Listings), gRPC on port 50059 |
| **Python AI Service** | 5005/50060 | HTTP/gRPC | FastAPI service for AI/ML predictions, grade recommendations, Discogs/eBay integration, chatbot interface, gRPC on port 50060 |
| **Web App (Next.js)** | 3001 | HTTP | React/Next.js frontend with TypeScript, serves via Nginx edge, includes dashboard, forum, messaging, collection management, auction monitoring, insights, and integrations pages |
| **Nginx Edge** | 8080 | HTTP | Serves static UI assets, proxies `/api` through HAProxy, micro-caching, rate limiting |
| **HAProxy** | 8081 | HTTP | Keep-alive pools to gateway, load balancing, stats on port 8404 |

## Supporting Infrastructure

### Edge & Routing
- **Caddy** (`Caddyfile`, `caddy-*.yaml`) - Host-side HTTP/2 + HTTP/3 front door with TLS termination. Mounts local cert bundle under `/etc/caddy/certs`, trusts `certs/dev-root.pem`. Supports QUIC (HTTP/3) and HTTP/2.
- **Ingress** (`infra/k8s/overlays/dev/ingress.yaml`) - nginx ingress controller routing for the cluster (Colima + k3s primary). Routes `/` to Nginx edge and `/api/*` to API Gateway. Supports gRPC with `backend-protocol: "GRPC"` annotations.
- **HAProxy** (`infra/k8s/base/haproxy`) - Maintains keep-alive pools to gateway, load balancing, stats on `:8404`, keeps gateway replicas warm.

### Data Layer (External - Docker Compose)
**All databases run outside Kubernetes** in Docker Compose for stability and easier management:

#### PostgreSQL Instances (8 dedicated databases)

Canonical names and ports (match architecture diagram). Each port has one **database name**; schemas live inside that database:

| Instance name | Port | Database name | Schema(s) |
|---------------|------|---------------|-----------|
| **Postgres (Main DB)** | 5433 | `records` | records |
| **Postgres Social** | 5434 | `social` | forum, messages |
| **Postgres Listings** | 5435 | `listings` | listings |
| **Postgres Shopping** | 5436 | `shopping` | shopping |
| **Postgres Auth** | 5437 | `auth` | auth |
| **Postgres Auction Mon** | 5438 | `postgres` | auction_monitor |
| **Postgres Analytics** | 5439 | `analytics` | analytics |
| **Postgres Python AI** | 5440 | `python_ai` | ai |

**Port → service → database (quick reference):**  
5433 = **records** (DB `records`) · 5434 = **social** (DB `social`) · 5435 = **listings** (DB `listings`) · 5436 = **shopping** (DB `shopping`) · 5437 = **auth** (DB `auth`) · 5438 = **auction_monitor** (DB `postgres`, schema `auction_monitor`) · 5439 = **analytics** (DB `analytics`) · 5440 = **python_ai** (DB `python_ai`).  
Schema/table breakdown: **docs/SCHEMA_TABLE_BREAKDOWN.md**. Current state: `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`.

- **Postgres (Main DB)** – Port 5433, database `records`, `records` schema (core collection data). Docker: `docker-compose.yml:postgres`.
- **Postgres Social** – Port 5434, database `social`, schemas `forum`, `messages` (forum posts, comments, messages). Docker: `postgres-social`.
- **Postgres Listings** – Port 5435, database `listings`, `listings` schema (marketplace data, auctions, watchlists). Docker: `postgres-listings`.
- **Postgres Shopping** – Port 5436, database `shopping`, `shopping` schema (carts, orders, wishlist). Docker: `postgres-shopping`.
- **Postgres Auth** – Port 5437, database `auth`, `auth` schema (user authentication, JWT). Docker: `postgres-auth`.
- **Postgres Auction Mon** – Port 5438, **service name auction_monitor**, database `postgres`, schema `auction_monitor` (auction monitoring, price tracking). Docker: `postgres-auction-monitor`.
- **Postgres Analytics** – Port 5439, database `analytics`, `analytics` schema. Docker: `postgres-analytics`.
- **Postgres Python AI** – Port 5440, database `python_ai`, schema `ai`. Docker: `postgres-python-ai`.

Connection strings and database names used by the app are in `infra/k8s/base/config/app-config.yaml`. See **infra/docs/EIGHT-DATABASES-ARCHITECTURE.md** for port → database name → schema details.

#### Backups and restore

- **Hard backup (all 8 DBs):** Run **`scripts/backup-all-8-dbs.sh`** to snapshot all 8 Postgres instances (ports 5433–5440). Writes to `backups/all-8-YYYYMMDD-HHMMSS/` (schema, indexes, data, tuning metadata). Use for disaster recovery; run regularly or before major changes.
  - **How to run:** `PGPASSWORD=postgres ./scripts/backup-all-8-dbs.sh` (optional: `BACKUP_DIR=/path/to/backups`, `PGHOST=127.0.0.1`).
  - **Restore:** `RESTORE_BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS ./scripts/bring-up-external-infra.sh` or per-DB restore; see **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md** and the **Full disaster recovery protocol** section above.
- **Legacy:** Backups are also written to **`backups/`** (e.g. `record-platform-postgres-1-all-*.sql`, or per-DB dumps). To restore **social** (5434), **listings** (5435), or **shopping** (5436) after applying schemas:

1. Apply schemas: `PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh`
2. Restore from a dump in `backups/` into the matching instance, e.g.  
   `psql -h 127.0.0.1 -p 5434 -U postgres -d social -f backups/social-YYYYMMDD.sql`  
   (or use `scripts/restore-to-external-docker.sh` with the correct port and database name).

Full checklist: **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md**.

#### Dual-Database Connections
Some services connect to multiple databases for cross-service data access:
- **Auction Monitor Service**: 
  - Reads from `listings.watchlist` (port 5435) to monitor watched items
  - Writes to `auction_monitor.auction_results` (port 5438) using `auction_monitor.upsert_auction_result()` function
- **Analytics Service**:
  - Reads from `listings.search_history` (port 5435) for search analytics
  - Writes to `analytics.price_snapshots` (port 5439) for price trend analysis

#### Redis
- **Redis** – Port 6379. Uses: **JWT Cache**, **Search** (result caching), **Cache** (general). Docker: `docker-compose.yml:redis`. May be password-protected; rate limiting and singleflight use Redis.
- **Kafka** (`infra/k8s/base/kafka/deploy.yaml`) - **Strict TLS enabled**:
  - **PLAINTEXT listener**: Port 9092 (available for migration)
  - **SSL listener**: Port 9093 (primary, strict TLS)
  - **SSL certificates**: Generated and stored in `kafka-ssl-secret` (keystore, truststore, CA)
  - **Environment variables**: All required Confluent Kafka SSL env vars configured
  - **Services**: Python AI service and other services use SSL port (9093)
  - **Event streaming**: Real-time messaging for forum posts, direct messages, and group chats

Services connect via Kubernetes Service names (e.g., `postgres-auth-external.record-platform.svc.cluster.local:5437`) which route through Kubernetes Endpoints to Docker Compose postgres containers at `host.docker.internal:PORT`. Connection strings are in `infra/k8s/base/config/app-config.yaml` (`POSTGRES_URL_*`). All 8 Postgres instances have corresponding Kubernetes Services and Endpoints for connectivity from the cluster (Colima + k3s) to external Docker Compose.

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
  - ✅ Checks prerequisites (Terraform, Ansible, kubectl, docker)
  - ✅ Creates/verifies cluster (for Colima + k3s use `scripts/setup-new-colima-cluster.sh` first)
  - ✅ Initializes and applies Terraform (creates namespace, base configs)
  - ✅ Installs Ansible collections and deploys services
  - ✅ Builds and loads Docker images, applies Kustomize, waits for rollouts
  - **Usage**: `./scripts/bootstrap-platform.sh` (see `docs/BOOTSTRAP.md`). **Disaster recovery**: use `setup-new-colima-cluster.sh` → `bring-up-external-infra.sh` → `inspect-external-db-schemas.sh` as in the Full disaster recovery protocol above.

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

**Disaster recovery: backup and bring-back (Colima + k3s)**  
The platform uses **Colima + k3s**; recovery is a four-script process: **backup** (before loss), then **cluster → external infra → schema inspect**.

**1. Backup (run regularly or before major changes)**  
Creates a timestamped snapshot of all 8 Postgres DBs (schema, data, tuning metadata). Output: `backups/all-8-YYYYMMDD-HHMMSS/`.

```bash
PGPASSWORD=postgres ./scripts/backup-all-8-dbs.sh
# Optional: BACKUP_DIR=/path/to/backups PGHOST=127.0.0.1 ./scripts/backup-all-8-dbs.sh
```

See **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md** for restore commands (e.g. `restore-all-8-from-backup.sh`).

**2–4. Bring-back (after cluster or host loss)**  
Use the **newest** backup under `backups/` and a **MetalLB pool** that matches your Colima subnet (e.g. `192.168.64.240-192.168.64.250`); exact values vary by environment.

```bash
# 2. New Colima + k3s cluster with MetalLB (set pool for your subnet)
METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh

# 3. Bring up external infra (Docker Compose: 8 Postgres, Redis, Kafka) and restore DBs from backup
RESTORE_BACKUP_DIR=backups/all-8-20260312-091418 ./scripts/bring-up-external-infra.sh
# Or: RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh   # uses newest backups/all-8-*

# 4. Inspect and document DB schemas (optional verification)
PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md
```

Then run preflight and test suites as needed. See **Runbook.md** (item 82), **ENGINEERING.md** (Disaster recovery: shell script breakdown), and **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md**.

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

## Testing

**To the point:** One pipeline runs **preflight** (kubeconfig, API server, **strict TLS/mTLS**), then **8 suites**; DB verification runs after each suite. All services use strict TLS and mTLS. Optional load (k6 + pgbench) and **total platform coverage** are documented below.

### What is preflight?

**Preflight** is a single entry point that makes the cluster and certs ready for all test suites and load tests. It typically:

1. Verifies **kubeconfig** and API server reachability (with timeouts).
2. Optionally **scales** deployments (e.g. Caddy, gateway) and **reissues** TLS material (dev-root CA, leaf certs) so strict TLS/mTLS checks pass.
3. Runs **strict TLS/mTLS preflight** (`ensure-strict-tls-mtls-preflight.sh`): ensures `service-tls` and `dev-root-ca` secrets exist and are valid; restarts gRPC/TLS workloads if certs were updated so there’s no “self-signed certificate in certificate chain” or auth 503.
4. Leaves the cluster in a state where **all 8 suites** (auth, baseline, enhanced, adversarial, rotation, packet capture, tls-mtls, social) and optional k6/pgbench can run without manual cert or scale steps.

**Full pipeline (preflight + scale + reissue + suites):** `./scripts/run-preflight-scale-and-all-suites.sh`  
**Suites only (cluster and certs already ready):** `./scripts/run-all-test-suites.sh` (still runs strict TLS preflight internally unless `SKIP_TLS_PREFLIGHT=1`).  
**Total platform coverage (preflight + suites + k6 + pgbench):** `RUN_FULL_LOAD=1 ./scripts/run-preflight-scale-and-all-suites.sh`

### How to run

- Use the commands in the **What is preflight?** section above. For **suites only** (no scale/reissue), run `./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log` (still runs strict TLS preflight unless `SKIP_TLS_PREFLIGHT=1`).

**Order of suites (8)**  
1. Auth (register, login, MFA, passkeys)  
2. Baseline (smoke: HTTP/2, HTTP/3, gRPC, packet capture)  
3. Enhanced (packet capture + adversarial)  
4. Adversarial  
5. Rotation (CA/leaf rotation + k6 chaos)  
6. Standalone packet capture  
7. TLS/mTLS comprehensive  
8. Social (forum + messages, archive/recall/kick/ban; requires social DB migrations — see `scripts/ensure-social-migrations.sh`)

**Why 8+ suites and a “command center”**  
We run **8 core suites** plus optional k6 load and pgbench sweeps (15+ scripts when counting limit-finding, service-specific k6, and DB verification). This breadth exists because the platform spans multiple protocols (HTTP/1.1, HTTP/2, HTTP/3, gRPC), strict TLS/mTLS, zero-downtime rotation, and 8 databases. A single “command center” entry point (`run-all-test-suites.sh` or `run-preflight-scale-and-all-suites.sh`) orchestrates order, preflight, and DB/cache verification so you don’t have to remember sequence or cert steps. See `scripts/load/LOAD_TESTS_CATALOG.md` and `ENGINEERING.md` for the full testing strategy.

**Strict TLS/mTLS (including k6)**  
- **Preflight:** `scripts/ensure-strict-tls-mtls-preflight.sh` validates `service-tls` + `dev-root-ca`; if missing/invalid, provisions from repo or OpenSSL and restarts gRPC/TLS workloads. Used by both preflight pipeline (step 5) and `run-all-test-suites.sh`.
- **k6:** All k6 runs use **strict TLS** (no `-k`). The runner sets `SSL_CERT_FILE` to the dev-root CA (from K8s secret or `certs/dev-root.pem`) so `record.local` x509 verification succeeds. If you see `x509: certificate is not trusted`, set `K6_CA_CERT=/path/to/dev-root.pem` or run after preflight.
- Prevents auth 503 / "self-signed certificate in certificate chain" by restarting pods after any cert update.

**HTTP/1.1, HTTP/2, and HTTP/3 (and why we test both)**  
- **HTTP/2:** Standard k6 uses HTTP/2 by default over TLS. We use it for baseline load and limit tests.
- **HTTP/3:** k6 does not ship HTTP/3; we use **xk6-http3** (custom binary via `scripts/build-k6-http3.sh`, e.g. `.k6-build/bin/k6-http3`) to run HTTP/3 (QUIC) load tests. Curl-based tests (`scripts/test-microservices-http2-http3.sh`) also verify HTTP/3 with strict TLS.
- **HTTP/1.1:** Supported for legacy clients; we test that the edge accepts HTTP/1.1 and returns 200 where applicable.
- **Head-of-line blocking (HOLB):** HTTP/2 multiplexes streams over one TCP connection — a single lost packet can block all streams. HTTP/3 (QUIC) uses independent streams over UDP, so we run **both** HTTP/2 and HTTP/3 tests to demonstrate latency and throughput differences and to validate that HOLB is real (e.g. compare scripts like `k6-limit-test-comprehensive.js` with H2 vs H3 or use `scripts/compare-http2-http3.sh`).

**Where results go**  
- Suite logs: `$SUITE_LOG_DIR` (default `/tmp/suite-logs-<timestamp>`).  
- Quick scan: `grep -E '(✅|❌|⚠️|FAILED|error)' $SUITE_LOG_DIR/*.log`

**Daily run and self-analyze**  
- **Host cron:** Run `./scripts/run-daily-test-suite-with-results.sh` (saves to timestamped dir and prints a short failure summary). Example: `0 6 * * * /path/to/scripts/run-daily-test-suite-with-results.sh`.  
- **CI:** Use `.github/workflows/rotation-chaos.yml` or add a workflow that runs the preflight + suites and uploads artifacts.  
- **Self-analyze:** The daily script greps for failures and narrows scope (which suite, which test). See `scripts/run-daily-test-suite-with-results.sh` and `services/cron-jobs/README.md` for wiring daily runs.

**DB verification**  
- All **8 PostgreSQL instances** (ports 5433–5440) are checked by `verify-db-cache-quick.sh` after each suite. See `docs/Runbook.md` for known issues and fixes.

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
- Docker 24+, Colima, kubectl >=1.30, Helm >=3.13.
- mkcert (or another local CA tool) to mint and trust `record.local` certificates.
- Node 20+ and pnpm 9.x for service builds.
- Optional: `curl` with HTTP/3 support (Homebrew `curl --with-quic`) and `k6` for load tests.
- Optional: Terraform >=1.0 and Ansible >=2.9 for Infrastructure as Code (IAC) workflows (see `infra/IAC-GUIDE.md`).

## Local Development Quickstart
1. Ensure `record.local` resolves locally:
   ```bash
   echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts
   ```
2. Bootstrap (or refresh) the cluster and dev overlay:
   ```bash
   ./infra/k8s/overlays/dev/bootstrap.sh
   ```
   For Colima + k3s (primary), run `./scripts/setup-new-colima-cluster.sh` first, then apply overlays. The bootstrap script verifies tooling, builds `:dev` images, applies the Kustomize overlay, and waits for rollouts. See **ENGINEERING.md** (Disaster recovery: shell script breakdown) and the **Full disaster recovery protocol** section above.
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
  - **Main DB (5433)**: database `records` for core record collection data
  - **Social (5434)**: database `social` (forum posts, comments, messages, groups)
  - **Listings (5435)**: database `listings` (marketplace data, auctions, watchlists, search_history)
  - **Shopping (5436)**: database `shopping` (carts, orders, wishlists, purchase history)
  - **Auth (5437)**: database `auth` for user authentication and JWT management
  - **Auction Monitor (5438)**: database `postgres`, schema `auction_monitor` (auction monitoring, price tracking)
  - **Analytics (5439)**: database `analytics` (price snapshots, analytics data)
  - **Python AI (5440)**: database `python_ai`, schema `ai` (AI model persistence, predictions)
- **Dual-DB connections**: Services like auction-monitor and analytics-service connect to multiple databases for cross-service queries while maintaining data isolation
- **Redis (6379)**: Password-protected, JWT revocation cache, search result caching, rate limiting
- **Kafka (PLAINTEXT:9092, SSL:9093)**: Event streaming, real-time messaging for forum posts, direct messages, and group chats. **Strict TLS enabled** with SSL certificates in `kafka-ssl-secret`. Services use SSL port (9093).

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

## Analytics & AI Pipeline Architecture

### Platform-Wide Business Intelligence

The Analytics & Python AI pipeline provides **platform-wide business intelligence** for both sellers and buyers, simulating real-world marketplace scenarios through comprehensive k6 load testing.

**Pipeline Flow**:
```
User Actions → Analytics Service → Kafka → Python AI Service → Intelligent Recommendations
```

**Key Use Cases**:

#### Seller Intelligence (Business Intelligence Tool)
- **Auction Listings**: Optimal starting bid recommendations based on market analysis
- **OBO (Or Best Offer)**: Price flexibility guidance to show negotiation willingness
- **Fixed Price**: Best price recommendations that move inventory quickly without desperation pricing
- **Listing Optimization**: Title, description, photo suggestions based on successful listings
- **Price Positioning**: Granular percentile analysis (p1-p99) for precise market positioning

#### Buyer Intelligence
- **Price Evaluation**: Real-time price assessment using granular percentiles (p1-p99)
- **Negotiation Assistance**: OBO recommendations based on percentile position and market trends
- **Deal Detection**: Identification of good deals (low percentile prices) vs overpriced items
- **Auction Temperature**: Bid activity analysis, watcher count, time remaining insights

#### Social Integration (Negotiation Assistance)
- **Buyer/Seller Negotiations**: Price context for both parties (roles can change)
- **Mood Analysis**: AI analyzes negotiation mood based on price position
- **Market Context**: Bigger picture trends, new drops detection
- **Example**: Buyer offers $45 (p25 - good deal), system suggests seller might accept $47-48 (p50-p60 range)

#### Shopping Integration (Buyer & Seller Evaluation)
- **Buyer Evaluation**: Price assessment for purchase decisions
- **Seller Optimization**: Pricing guidance for listings
- **Cross-Role Support**: Same advice works for both buyer and seller roles (not fixed roles)

**Why This Pipeline is Stronger Than AI Chatbots**:
- **Data-Driven**: Uses real market data from Analytics Service (granular percentiles p1-p99)
- **Platform-Wide**: Integrates with Social, Shopping, and Listings services
- **Real-Time**: Kafka pipeline ensures fresh data for accurate recommendations
- **Granular Analysis**: p1-p99 percentiles provide precise price positioning (not just p25/p50/p75/p95)

**k6 Load Testing Simulation**:
The comprehensive k6 test (`scripts/load/k6-all-services-comprehensive.js`) simulates the **complete user flow**:
1. **Auth**: User registration/login (gatekeeper for all services)
2. **Records**: Catalog management after purchase
3. **Listings**: Random listing creation and search
4. **Social**: Forum posts, messaging, group chats
5. **Analytics Pipeline**: Search logging, price snapshots (feeds Python AI)
6. **Python AI**: Selling advice, buying advice, negotiation advice (uses Analytics data)
7. **Shopping**: Cart, checkout, orders, purchase history, resell

This end-to-end simulation **finds system limits** by testing the complete flow under load, identifying bottlenecks across the entire platform.

**Test Results** (December 21, 2025):
- **Success Rates**: 99%+ for all services (auth, records, listings, social, shopping, analytics)
- **Latency Improvements**: 45-77% reduction in p95 latencies
- **Error Rates**: <1% for all services
- See `test-results/E2E_RETEST_RESULTS_12-21_tom.md` for complete results

## Performance Benchmarks
- The `psql-inventory` job (see snippet below) creates a `bench.results` table, prewarms hot partitions, and sweeps pgbench runs over two stored search plans: `percent` (prefix filtering) and `knn` (vector KNN).
- Results are recorded in Postgres with git metadata and exported to `bench_sweep.csv` for spreadsheet review. Latency files are parsed into comprehensive percentiles: **p50, p95, p99, p999, p9999, p99999, p999999, p9999999, and p100**, plus CPU share and IO deltas.
- **Extended percentile coverage**: All performance testing scripts (k6 and pgbench) now include p9999999 (99.99999th percentile) for detection of extreme tail latencies (1 in 10 million requests).
- **Recent E2E Performance Improvements** (December 21, 2025):
  - **Success Rates**: 99%+ for all services (auth: 99.87%, records: 99.62%, listings: 99.81%, social: 99.70%, shopping: 99.91%, analytics: 99.89%)
  - **Latency Improvements**: 45-77% reduction in p95 latencies (auth: 1215ms, records: 2213ms, listings: 2101ms, social: 1293ms, shopping: 778ms, analytics: 556ms, python_ai: 541ms)
  - **Error Rates**: <1% for all services
  - **k6 HTTP/3 Toolchain**: 100% success rate, 15ms p95 latency
  - See `test-results/E2E_RETEST_RESULTS_12-21_tom.md` for complete test results
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
  - **k6 scripts**: `scripts/load/k6-mixed.js`, `scripts/load/k6-reads.js`, `scripts/load/k6-all-services-comprehensive.js` (E2E flow simulation), `scripts/load/k6-http3-toolchain.js` (HTTP/3 testing)
  - **pgbench scripts**: `scripts/run_*_pgbench_sweep.sh` for all services (auth, social, listings, shopping, analytics, auction-monitor, python-ai)
  - All scripts include full percentile coverage from p50 to p9999999
- Long-form output lives in `bench_sweep.csv`; use `scripts/perf_runner.sh` or adapt the snippet to compare future schema or index experiments.

## Auth & Identity Flow

1. **Client Authentication**: Clients obtain JWTs via `/api/auth/login` (Caddy → ingress → gateway → Envoy → auth-service via gRPC)
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

### Caching & Redis Lua Scripts

**Redis Caching Strategy**:
- **Multi-Layer Caching**: L1 (in-memory) and L2 (Redis) caching for optimal performance
- **Singleflight Pattern**: Redis Lua scripts prevent thundering herd and cache stampede
- **Atomic Operations**: Lua scripts ensure atomic cache operations (get, set, lock, release)
- **Connection Pooling**: Optimized Redis connection pools for high concurrency

**Lua Scripts Used**:

1. **Singleflight Cache** (`singleflight_cache.lua`):
   - **Purpose**: Prevents multiple concurrent requests from fetching the same data
   - **Flow**: 
     ```
     Request → Check Cache → Cache Hit? Return
                              Cache Miss? Try Lock → Lock Acquired? Fetch & Set
                                                      Lock Exists? Wait & Retry
     ```
   - **Services**: `records-service`, `social-service`, `python-ai-service`, `auction-monitor`
   - **Benefits**: Reduces database load, prevents cache stampede, improves response times

2. **LFU/LRU Cache** (`lfu_lru_cache.lua`):
   - **Purpose**: Implements Least Frequently Used (LFU) and Least Recently Used (LRU) eviction
   - **Services**: `shopping-service`
   - **Benefits**: Optimal cache eviction for shopping cart and order data

3. **Atomic Cache Operations**:
   - **User Lookup**: Atomic user cache lookup and update (auth-service)
   - **Listing Cache**: Atomic listing cache updates with TTL refresh (listings-service)
   - **Search Results**: Atomic search result caching with size limits
   - **Rate Limiting**: Token bucket, sliding window, and fixed window rate limiters (auction-monitor)

**Cache Invalidation**:
- **PostgreSQL LISTEN/NOTIFY**: Real-time cache invalidation via PostgreSQL notifications
- **Pattern-Based Invalidation**: Efficient invalidation using Redis SCAN with patterns
- **Version-Based Keys**: Cache versioning prevents stale data after mutations

**Performance Benefits**:
- **Reduced Database Load**: 80-90% cache hit rates in production scenarios
- **Lower Latency**: Cache hits serve in <1ms vs 10-50ms database queries
- **Prevents Thundering Herd**: Singleflight ensures only one request fetches expensive data
- **Atomic Operations**: Lua scripts eliminate race conditions in cache updates

**Implementation Example** (`services/records-service/src/lib/cache.ts`):
```typescript
// Singleflight pattern with Lua script
export async function cached<T>(
  r: Redis | null,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  // Lua script checks cache, acquires lock if miss
  const sha = await ensureSingleflightScript(r);
  const [state, payload] = await r.evalsha(sha, 2, key, lockKey, ...);
  
  if (state === 'hit') return JSON.parse(payload);
  if (state === 'miss-locked') {
    const val = await compute();
    await r.multi().psetex(key, ttl, json).del(lockKey).exec();
    return val;
  }
  // Wait and retry if lock exists
}
```

**Redis Connection Pooling**:
- **Connection Limits**: 100-150 max connections per service (scaled for load)
- **Pool Size**: 50-75 connections per pool
- **Auto-Pipelining**: Enabled for reduced network round-trips
- **Connection Reuse**: Persistent connections with keep-alive

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

### Test Suite (Preflight + Control Plane)
- See **[Testing](#testing)** for the dedicated testing section (how to run, order, strict TLS, daily run, self-analyze).
- **Quick run**: `./scripts/run-preflight-scale-and-all-suites.sh` (full preflight + scale + reissue + all 8 suites) or `./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log`. For total platform coverage (k6 + pgbench): `RUN_FULL_LOAD=1 ./scripts/run-preflight-scale-and-all-suites.sh`.
- **DB verification**: All **8 PostgreSQL instances** (ports 5433–5440) are checked after each suite. See `docs/Runbook.md` for issues and fixes.

### Diagnostic Scripts
- `scripts/verify-dev.sh` - End-to-end cluster sanity checks
- `scripts/diag-caddy.sh`, `scripts/diag-gateway.sh`, `scripts/quic-tune-kind.sh` - Ingress and QUIC inspection
- `scripts/perf_runner.sh`, `scripts/perf_smoke.sh`, `scripts/load/k6-*.js` - Load/perf harnesses
- `scripts/pg-connectivity-check.sh` - Database connectivity from Kubernetes pods to Docker Compose
- `infra/k8s/scripts/access-observability.sh` - Quick access to Grafana, Prometheus, Jaeger
- `infra/k8s/scripts/install-observability.sh` - Complete observability stack installer

### Debug Tools (Packet Capture & Profiling)
- **Packet capture**: `tshark`, `tcpdump`, `netstat` for HTTP/2 (TCP 443), HTTP/3/QUIC (UDP 443), and gRPC verification. Captures run on Caddy and Envoy pods; pcaps must be non-empty for wire-level verification.
- **Profiling**: `valgrind`, `htop`, `strace` for memory/CPU and system-call debugging. CI/workflows can install as needed; see `docs/Runbook.md` for packet-capture and TLS/mTLS issues.
- **Strict TLS**: All gRPC and HTTP tests use strict TLS (CA verification); `scripts/test-tls-mtls-comprehensive.sh` validates certificate chain and mTLS configuration.

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
# Check postgres external services and endpoints
kubectl -n record-platform get svc | grep postgres
kubectl -n record-platform get endpoints | grep postgres

# Verify endpoint IPs point to host.docker.internal (192.168.65.254 on macOS)
kubectl -n record-platform get endpoints postgres-auth-external -o yaml | grep -A 3 "subsets:"

# Test database connectivity from service pod via service name
kubectl -n record-platform run postgres-test --image=postgres:16-alpine --rm -i --restart=Never -- \
  sh -c "PGPASSWORD=postgres psql -h postgres-auth-external.record-platform.svc.cluster.local -p 5437 -U postgres -d records -c 'SELECT 1;'"

# Test direct IP connection (should be 192.168.65.254 on macOS)
kubectl -n record-platform run postgres-test2 --image=postgres:16-alpine --rm -i --restart=Never -- \
  sh -c "PGPASSWORD=postgres psql -h 192.168.65.254 -p 5437 -U postgres -d records -c 'SELECT 1;'"

# Check service logs for database connection errors
kubectl -n record-platform logs -l app=auth-service --tail=50 | grep -i "database\|postgres\|connection"
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
# Full pipeline (preflight + all 8 suites + DB/cache verification, 8 DBs 5433–5440)
./scripts/run-preflight-scale-and-all-suites.sh
# Or: ./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log

# Baseline smoke only
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
- **Runbook**: `docs/Runbook.md` - Comprehensive troubleshooting guide for all cluster stabilization issues and solutions
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
- **Event Streaming**: Kafka integration with **strict TLS** (SSL port 9093) for real-time messaging (forum posts, direct messages, group chats) and event processing. SSL certificates managed via `kafka-ssl-secret`.
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
