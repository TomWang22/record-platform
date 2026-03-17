# Platform dependencies (runtime and build)

**Purpose:** One place to see what depends on what so we can bring things up in order and debug failures.

---

## 1. Runtime dependencies (what must be up first)

### 1.1 External (outside cluster)

| Dependency | Used by | How |
|------------|--------|-----|
| **Redis** | All services (cache, rate limit, session) | `REDIS_URL` → `host.docker.internal:6379` (Docker Compose) |
| **Postgres (multiple DBs)** | auth, records, social, listings, shopping, auction-monitor, analytics, python-ai | Per-service URLs; see app-config (ports 5433–5440) |
| **Kafka** | auction-monitor, analytics, others | `KAFKA_BROKER` → kafka-external service (or Docker :29093) |

From **`infra/k8s/base/config/app-config.yaml`**:

- **Redis:** `redis://host.docker.internal:6379/0`
- **Postgres:** host.docker.internal, ports 5433 (records), 5434 (social), 5435 (listings), 5436 (shopping), 5437 (auth), 5438 (auction-monitor), 5439 (analytics), 5440 (python_ai)
- **Kafka:** `kafka-external.record-platform.svc.cluster.local:9093` (in-cluster service pointing at external Kafka)

**For k3d:** Pods need to reach host. Preflight (when context is k3d) patches app deployments with a hostAlias so `host.docker.internal` resolves in pods (on **macOS**, Docker Desktop’s host gateway is `192.168.65.2`). If Postgres/Redis/Kafka run on the host or in Docker on the host, ensure those ports are exposed; then preflight keeps Redis/DB reachable and 9/9 services ready.

### 1.2 In-cluster order (no hard ordering; all use same config)

- **kafka-external** — Endpoints + Service so pods can resolve Kafka.
- **redis-external** — Same idea if Redis is external.
- **app-config, app-secrets, proto-files** — Required by all app deployments.
- **api-gateway** — Entry; calls auth-service, listings-service, records-service, etc. via gRPC.
- **auth-service** — POSTGRES_URL_AUTH, Redis.
- **records-service** — POSTGRES_URL_RECORDS, Redis.
- **listings-service** — POSTGRES_URL_LISTINGS, Redis.
- **shopping-service** — POSTGRES_URL_SHOPPING, Redis.
- **social-service** — POSTGRES_URL_SOCIAL, Redis.
- **analytics-service** — POSTGRES_URL_ANALYTICS, Kafka, Redis.
- **auction-monitor** — POSTGRES_URL_AUCTION_MONITOR, Kafka.
- **python-ai-service** — POSTGRES_URL_PYTHON_AI.

So: **Redis + Postgres (all DBs) + Kafka** must be reachable first; then all app services can start (no strict in-cluster order).

---

## 2. Build dependencies (for :dev images)

- **No build-time dependency between services:** Each service Dockerfile copies from repo root (`COPY services/<name>`, `COPY package.json`, etc.). Build order is arbitrary; script order is api-gateway → auth → records → listings → analytics → python-ai → social → shopping → auction-monitor.
- **pnpm workspace:** Node services share root `package.json`, `pnpm-workspace.yaml`, and `services/common`. Dockerfiles install via pnpm; they need network access to registry.npmjs.org (and optionally registry.yarnpkg.com) during build.

---

## 3. Observability

- **Prometheus, Grafana, Jaeger, Otel Collector** — No dependency on app services; can start first. They scrape/ingest from apps once apps expose metrics/traces.
- **ServiceMonitor / PodMonitor** — Require Prometheus Operator CRDs; optional (manual scrape config works without them).

---

## 4. Quick reference

| I want to… | Do this |
|------------|--------|
| See Postgres/Redis/Kafka per service | `infra/k8s/base/config/app-config.yaml` |
| See build order | `scripts/build-and-load-k3d.sh` (SERVICES array) |
| Run external deps (host) | Docker Compose: Postgres (5433–5440), Redis 6379, Kafka 29093 |
| Bring up cluster + apps | 2-node k3d → apply base → build-and-load-k3d → rollout restart |
