# Ports reference (non-DB) — substrate and avoiding conflict

This document lists **non-database** ports used by the substrate and application services so another project (e.g. **Off-Campus-Housing-Tracker**) can use the same stack **without conflicting** with an existing record-platform (RP) setup on the same host.

**Database ports** (5433–5440, etc.) are not listed here; configure those per project in `docker-compose` and app-config.

---

## 1. Substrate / record-platform default ports

Use these as the reference for “what RP uses.” If the other project runs on a **different host or different cluster**, you can reuse the same numbers. If both run on the **same host** (e.g. same Mac with two Colima clusters or RP + housing Docker Compose), use the alternate ports in §2.

### 1.1 Host-exposed (Docker Compose, NodePort, host access)

| Port | Component | Purpose |
|------|-----------|--------|
| **6379** | Redis | Single Redis for cache/session. Docker: `6379:6379`. |
| **29093** | Kafka | SSL listener for clients. Docker: `29093:9093`. Pods use in-cluster `kafka-external:9093`. |
| **30443** | Caddy | NodePort for HTTPS (TCP+UDP). Host uses `https://record.local:30443` or LB IP:443. |
| **5000** | k3d registry | Optional; k3d app image registry. Host: `127.0.0.1:5000`. |
| **6443** | Kubernetes API | Colima/k3s API. Host: `127.0.0.1:6443` (tunnel). |

### 1.2 In-cluster (services, Envoy, Caddy)

| Port | Component | Purpose |
|------|-----------|--------|
| **443** | Caddy | TLS termination (HTTPS + QUIC). Service `caddy-h3` in `ingress-nginx`. |
| **2019** | Caddy | Admin API (optional). |
| **5000** | Caddy | gRPC proxy to Envoy (h2c). |
| **10000** | Envoy | gRPC proxy to backends (TLS). Service in `envoy-test`. |
| **4000** | API Gateway | HTTP. |
| **4001** | Auth | HTTP. |
| **4002** | Records | HTTP (RP-only). |
| **4003** | Listings | HTTP. |
| **4004** | Analytics | HTTP. |
| **4006** | Social | HTTP (RP-only). |
| **4007** | Shopping | HTTP (RP-only). |
| **4008** | Auction monitor | HTTP (RP-only). |
| **50051** | Auth | gRPC. |
| **50054** | Analytics | gRPC. |
| **50056** | Social | gRPC (RP-only). |
| **50057** | Listings | gRPC. |
| **50058** | Shopping | gRPC (RP-only). |
| **50059** | Auction monitor | gRPC (RP-only). |
| **9093** | Kafka | SSL inside cluster (`kafka-external` or `kafka` service). |
| **9092** | Kafka | PLAINTEXT (inter-broker / optional). |
| **6379** | Redis | In-cluster if Redis runs in K8s; otherwise pods use `host.docker.internal:6379`. |

### 1.3 Observability / optional

| Port | Component | Purpose |
|------|-----------|--------|
| **8080** | Nginx edge | Optional static/micro-cache. |
| **8081** | HAProxy | Optional edge; health at `:8081/healthz`. |
| **8404** | HAProxy | Stats. |
| **9090** | Prometheus | Scrape. |
| **4317** / **4318** | Otel | gRPC/HTTP collector. |
| **16686** | Jaeger | UI. |

---

## 2. Recommended ports for a second project (same host)

If you run **Off-Campus-Housing-Tracker** (or another project) on the **same host** as record-platform, use **different host-exposed ports** so both can run side by side. In-cluster ports can stay the same if you use a **different cluster or namespace**; only host-bound ports need to change.

### 2.1 Host-exposed alternates (Docker / NodePort)

| Purpose | RP default | Recommended for housing (same host) |
|---------|------------|-------------------------------------|
| Redis | 6379 | **6380** (e.g. `6380:6379` in docker-compose) |
| Kafka SSL | 29093 | **29094** (e.g. `29094:9093`) |
| Caddy NodePort | 30443 | **30444** (set in `caddy-h3-service-nodeport.yaml`: `nodePort: 30444`) |
| k3d registry | 5000 | **5001** (if running a second k3d cluster with its own registry) |

Kubernetes API (6443): use a **second Colima profile** or a **different k3d cluster** so each has its own API; no port clash if only one cluster is active at a time, or use different tunnel ports per profile.

### 2.2 In-cluster (housing 7 services)

When the housing project uses its **own cluster or namespace**, you can keep the same in-cluster ports for consistency with the substrate. Suggested mapping for the 7 domain services:

| Service | HTTP port | gRPC port |
|---------|-----------|-----------|
| API Gateway | 4000 | — |
| Auth | 4001 | 50051 |
| Listings | 4003 | 50057 |
| Booking | **4005** | **50055** |
| Messaging | **4009** | **50060** |
| Notification | **4011** (optional health) | — |
| Trust | **4012** | **50061** |
| Analytics | 4004 | 50054 |

Caddy (443, 2019, 5000), Envoy (10000), Kafka (9093), and Redis (6379) stay the same inside the cluster. Update **app-config** (or equivalent) and each service’s `deploy.yaml` / `service.yaml` with the chosen HTTP and gRPC ports.

### 2.3 MetalLB pool (same host / same L2 segment)

Use a **different MetalLB pool** so the two projects don’t share the same LoadBalancer IPs, e.g.:

- RP: `192.168.64.240-192.168.64.250`
- Housing: `192.168.64.251-192.168.64.260`

Set when bringing up the cluster, e.g.:

```bash
METALLB_POOL=192.168.64.251-192.168.64.260 ./scripts/setup-new-colima-cluster.sh
```

---

## 3. Quick checklist (housing on same host as RP)

- [ ] Redis: host port **6380** (or another free port).
- [ ] Kafka SSL: host port **29094** (or another free port).
- [ ] Caddy NodePort: **30444** (if using NodePort; or use MetalLB with a different pool).
- [ ] MetalLB: **different IP pool** for housing.
- [ ] Cluster/namespace: **separate** cluster or namespace so in-cluster ports don’t collide.
- [ ] WEBAUTHN_ORIGIN / hostname: use **housing** hostname and port (e.g. `https://housing.local:8443` or `:30444`).
- [ ] DB ports: use a **different range** (e.g. 5441–5448) if running housing Postgres on the same host; not covered in this doc.
