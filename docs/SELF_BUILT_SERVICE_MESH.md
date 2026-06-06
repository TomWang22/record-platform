# Self-built L7 + TLS mesh (no Istio / Linkerd)

Record Platform does **not** ship a commercial service mesh. Traffic and trust are composed from **explicit** components you operate and validate (especially **`scripts/run-preflight-scale-and-all-suites.sh`** and TLS/Kafka scripts).

## Layer 0 — Names and trust

- **Cluster DNS:** `*.svc.cluster.local` for in-cluster gRPC/HTTP. Default app namespace: **`record-platform`** (`HOUSING_NS`).  
- **Public DNS / edge hostname:** **`record.test`** → MetalLB / Node IP (**`scripts/lib/edge-test-url.sh`**, **`ensure-edge-hosts.sh`**, preflight **`OCH_EDGE_IP`** / **`OCH_AUTO_EDGE_HOSTS`**). Legacy OCH used **`off-campus-housing.test`**; do not use **`off-campus-housing-tracker`** as the Kubernetes namespace (use **`record-platform`**).  
- **Dev CA:** **`certs/dev-root.pem`** at repo root; synced to **`dev-root-ca`** / TLS Secrets for Caddy and ingress. Never commit private keys.

## Layer 1 — Edge (north-south)

- **Caddy** terminates **TLS** for browsers and k6 (HTTP/1.1–3 / QUIC). Image: **`docker/caddy-with-tcpdump/`** (**xcaddy** build, **tcpdump** + **tshark** at runtime).  
- Manifests: **`infra/k8s/caddy-h3-*.yaml`**, **`loadbalancer.yaml`**.  
- **`Caddyfile`** in repo root is a reference; cluster often uses **ConfigMaps**.  
- Scripts: **`scripts/rollout-caddy.sh`**, **`scripts/verify-caddy-strict-tls.sh`**, **`verify-caddy-strict-tls-in-cluster.sh`**, **`setup-tls-and-edge.sh`**.

## Layer 2 — Ingress controller

- **ingress-nginx** terminates or passes traffic per your annotations; coordinates with **TLS Secrets** in **`ingress-nginx`**.  
- Preflight checks **routing order** (**`/api`**, **`/auth`** → **api-gateway:4000**) — see **`scripts/verify-preflight-edge-routing.sh`**.

## Layer 3 — Envoy for gRPC (optional but first-class)

- **`infra/k8s/ingress-nginx-envoy.yaml`** — **ConfigMap** **`envoy.yaml`**: listeners, **HTTP/2** clusters, **upstream TLS** to services on gRPC ports (**50051** …).  
- **`docker/envoy-with-tcpdump/`** — Envoy + **tcpdump** for captures (rotation suite, protocol validation).  
- Deploy/test flows: **`scripts/setup-tls-and-edge.sh`**, **`scripts/verify-caddy-grpc-routing.sh`**, transport CI scripts under **`scripts/ci/`** and **`scripts/protocol/`**.

**Mesh-like behavior here:** centralized **L7 routing** and **TLS to backends**, implemented as **data-plane config you own**, not sidecar injection.

## Layer 4 — In-cluster mTLS (east-west) for apps

Each workload that speaks **gRPC** to another uses **client certificates** signed by the same **service CA** as the server:

- Kubernetes **Secret** **`service-tls`** (or alias **`och-service-tls`**) mounted as **`/etc/certs`** with **`ca.crt`**, **`tls.crt`**, **`tls.key`**.  
- **api-gateway** example: **`GRPC_CA_CERT`**, **`GRPC_CLIENT_CERT`**, **`GRPC_CLIENT_KEY`** in **`infra/k8s/base/api-gateway/deploy.yaml`**.  
- Upstream services present server certs; gateway verifies with **CA**; gateway presents **client** cert if upstream requires mTLS.

Scripts for this layer include **`scripts/ensure-strict-tls-mtls-preflight.sh`**, **`scripts/strict-tls-bootstrap.sh`**, **`scripts/reissue-ca-and-leaf-load-all-services.sh`**, **`scripts/generate-canonical-dev-tls.sh`**, **`Makefile`** target **`tls-first-time`**, and **`test-microservices-http2-http3-housing.sh`** helpers.

**EKU note:** Service **leaf** certs and **Kafka broker** certs differ. Kafka brokers need **serverAuth + clientAuth** on the **same** broker leaf (preflight **6a2c1**: **`scripts/verify-kafka-broker-keystore-jks.sh`**, **`scripts/verify-kafka-broker-tls-eku.sh`**).

## Layer 5 — Data plane extras (Redis, watchdog)

- **Redis:** sessions, rate limits, cluster-weight scripts, **transport-watchdog** throttle key.  
- **transport-watchdog:** optional sidecar on **api-gateway** (see reference bundle **`TRANSPORT_WATCHDOG_API_GATEWAY.md`** when vendored under **`docs/bundles/`**).

## Greenfield outline

1. Install **MetalLB** (or LB equivalent) — **`infra/k8s/metallb/`**.  
2. Generate or sync **dev CA** + edge certs; apply **TLS Secrets** for Caddy/ingress (**`setup-tls-and-edge.sh`** / **`strict-tls-bootstrap.sh`**).  
3. Apply **base** + **Kafka KRaft+MetalLB** — **`infra/k8s/kafka-kraft-metallb/`**; run **`create-kafka-event-topics-k8s.sh`**.  
4. Run **Kafka gates**: **`verify-kafka-cluster.sh`**, **`validate-kafka-dns.sh`** (see **`docs/runbooks/kafka-kraft-stale-dns-rca.md`**), alignment suite **`scripts/tests/kafka-alignment-suite.sh`**.  
5. Build/import **images**: **caddy-with-tcpdump**, **envoy-with-tcpdump**, **api-gateway**, **transport-watchdog**, app services.  
6. Apply **ingress-nginx-envoy** ConfigMap when you need gRPC ingress + captures.  
7. Apply **api-gateway** Deployment and ensure **Redis** URL in **app-config** matches namespace DNS.  
8. Run **`scripts/run-preflight-scale-and-all-suites.sh`** (or subsets) to validate TLS, Kafka, edge routing, and optional Playwright.

## When to adopt a real mesh

Consider **Istio/Linkerd** if you need **uniform** mTLS, **L7 policy**, and **per-pod** identity without maintaining Envoy YAML and per-service env vars by hand. This stack trades **operational simplicity** and **scriptable contracts** for **explicit** configuration.
