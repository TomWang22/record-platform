# Platform layout (Colima + external deps)

Canonical ordering: **external** (Docker) first, then **k8s** (by namespace). On Colima with MetalLB we use **MetalLB LB IP only** (no NodePort, no socat); QUIC/HTTP/3 over that path is the steady setup.

## Namespaces (canonical)

| Namespace         | Contents |
|-------------------|----------|
| **record-platform** | All app services (api-gateway, auth, records, listings, analytics, python-ai, social, shopping, auction-monitor), haproxy, nginx, exporters, kafka-external. |
| **ingress-nginx**   | 2 Caddy H3 pods, **LoadBalancer** (MetalLB). No NodePort. |
| **envoy-test**      | 1 Envoy pod (gRPC proxy). |
| **metallb-system**  | MetalLB controller + speaker (L2). |
| **observability**   | Grafana, etc. |

## External (Docker — not in k8s)

Run via **`./scripts/ensure-dependencies-ready.sh`** (starts Zookeeper, Kafka, Redis, 8 Postgres; waits for health; creates DBs) or `./scripts/bring-up-external-infra.sh` then `./scripts/ensure-external-databases-created.sh`. Or manually: `docker compose up -d` for the same services.

| Component        | Port(s)   | Purpose                          |
|-----------------|-----------|----------------------------------|
| **Redis**       | 6379      | Session/cache                    |
| **Kafka**       | 29093     | Strict TLS (SSL)                 |
| **Zookeeper**   | 2181      | Kafka coordination               |
| **Postgres** x8 | 5433–5440 | records, social, listings, shopping, auth, auction-monitor, analytics, python-ai |

Pods in k8s connect to these via `host.docker.internal` (Postgres, Redis) and the **kafka-external** Service (Kafka). Run `./scripts/patch-kafka-external-host.sh` after bring-up so kafka-external Endpoints point at the host.

---

## In-cluster (k8s)

### ingress-nginx

- **2 × Caddy H3** — HTTP/2 + HTTP/3 (QUIC), TLS, **LoadBalancer** (MetalLB). No NodePort or hostPort. Traffic to Caddy is via MetalLB-assigned IP only; this keeps QUIC steadier (no socat/alias reply-path issues). Deploy with `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh` (uses `caddy-h3-deploy-loadbalancer.yaml` + `caddy-h3-service-loadbalancer.yaml`), or apply `infra/k8s/loadbalancer.yaml` after MetalLB is up.

### envoy-test

- **1 × Envoy** — gRPC proxy (port 10000). Deployed with base kustomize.

### record-platform

- **Services:** api-gateway, auth-service, records-service, listings-service, analytics-service, python-ai-service, social-service, shopping-service, auction-monitor.
- **Edge / LB:** haproxy, nginx.
- **Exporters:** nginx-exporter, haproxy-exporter.
- **External refs:** kafka-external (Service + Endpoints → host Kafka), redis-external (Service + Endpoints; app-config also uses REDIS_URL=host.docker.internal).

Other namespaces (observability, metallb-system, kube-system) are unchanged.

---

## Setup all things (full order)

1. **External stack** — `./scripts/ensure-dependencies-ready.sh` (or `./scripts/bring-up-external-infra.sh` then `./scripts/ensure-external-databases-created.sh`). This starts **Redis (6379), Zookeeper (2181), Kafka (29093), and 8 Postgres (5433–5440)** with the correct Docker volumes (`pgdata`, `pgdata-social`, `pgdata-listings`, `pgdata-shopping`, `pgdata-auth`, `pgdata-auction-monitor`, `pgdata-analytics`, `pgdata-python-ai`), waits for health, and creates the databases. Kafka requires `certs/kafka-ssl/` (see Runbook).
2. **Colima + k8s** — Follow the Colima bring-up order below (namespaces, MetalLB, Caddy LoadBalancer, Envoy, record-platform). After k8s apply, run `./scripts/patch-kafka-external-host.sh` so `kafka-external` Endpoints point at the host.

---

## Colima bring-up order (MetalLB IP only, no NodePort)

After Colima is up (ideally with `--network-address` so the host can reach the LB IP directly — see **docs/COLIMA_NETWORK_ADDRESS_AND_LB_IP.md**):

1. **Namespaces** — Ensure `record-platform`, `ingress-nginx`, `envoy-test` exist (base kustomize or bring-up).
2. **MetalLB** — Install MetalLB, set IP pool (e.g. 192.168.5.240–192.168.5.250 in the VM subnet).
3. **Caddy** — Deploy 2 Caddy pods + **LoadBalancer** service in `ingress-nginx` (`CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh`). Caddy gets an EXTERNAL-IP from MetalLB.
4. **Envoy** — Deploy Envoy in `envoy-test` (base kustomize).
5. **record-platform** — Deploy all services, haproxy, nginx, exporters (base kustomize / bring-up).

Do **not** use NodePort or `setup-lb-ip-host-access.sh` (socat/alias) for Colima when the host can reach the MetalLB IP directly; use the LB IP and QUIC over it.

---

## Verify

```bash
# k8s: Caddy (2), Envoy (1), record-platform services + exporters
kubectl get pods -n ingress-nginx -l app=caddy-h3
kubectl get pods -n envoy-test
kubectl get pods -n record-platform

# Caddy LoadBalancer: EXTERNAL-IP should be set (MetalLB); use this IP for host curl (no NodePort)
kubectl -n ingress-nginx get svc caddy-h3

# External (Docker)
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'redis|kafka|zookeeper|postgres'
```

Pods live in named namespaces, not `default`. Use `-n <namespace>` or the script above. When using MetalLB, traffic goes to the LB IP (EXTERNAL-IP); do not rely on NodePort for the steady path.

---

## Security: strict TLS, mTLS, Kafka SSL

All of the following should be in place so pods start and traffic is secured.

| What | Where | How |
|------|--------|-----|
| **dev-root-ca** | ingress-nginx, record-platform, **envoy-test** | `./scripts/strict-tls-bootstrap.sh` (creates in all three namespaces) |
| **record-local-tls** | ingress-nginx, record-platform | Same script (server cert + key for record.local) |
| **kafka-ssl-secret** | record-platform | Bring-up step 5b, or create `certs/kafka-ssl/` (keystore/truststore) then `./scripts/ensure-dependencies-ready.sh`; or `pnpm run kafka-ssl`. Must include ca-cert.pem; for broker/client TLS also keystore/truststore + password files. |
| **Caddy** | ingress-nginx | Uses record-local-tls + dev-root-ca. LoadBalancer deploy has no hostPort. |
| **Service pods** | record-platform | api-gateway, auth-service, records-service, listings-service, analytics-service, python-ai-service, social-service, shopping-service, auction-monitor: all mount **dev-root-ca** and **kafka-ssl-certs** (from kafka-ssl-secret) for TLS and Kafka SSL. |
| **Envoy** | envoy-test | Mounts **dev-root-ca** (must exist in envoy-test namespace). |
| **Kafka (external)** | Docker | Strict TLS on 9093; certs from `certs/kafka-ssl` (keystore/truststore). k8s clients use kafka-external Service → host:29093. |

**Why pods stay 0/1 or ContainerCreating**

- **envoy-test** stuck **ContainerCreating**: secret **dev-root-ca** missing in namespace envoy-test → run `./scripts/strict-tls-bootstrap.sh`.
- **record-platform** pods **0/1 Ready**, restarts: often **database missing** (e.g. auth) or DB not reachable → run **`./scripts/ensure-dependencies-ready.sh`** (or `./scripts/bring-up-external-infra.sh` then `./scripts/ensure-external-databases-created.sh`) so Redis, Kafka, and 8 Postgres are up and DBs exist; ensure `kubectl get endpoints kafka-external -n record-platform` points at host (run `./scripts/patch-kafka-external-host.sh` if needed).
- **MountVolume.SetUp failed for volume "kafka-ssl-certs"**: secret **kafka-ssl-secret** missing in record-platform → run bring-up (step 5b) or `./scripts/ensure-dependencies-ready.sh` (with Kafka SSL).
