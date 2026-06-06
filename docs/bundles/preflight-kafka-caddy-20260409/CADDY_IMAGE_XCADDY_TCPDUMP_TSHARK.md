# Caddy image: xcaddy, tcpdump, and tshark

The bundled **`docker/caddy-with-tcpdump/Dockerfile`** builds **Caddy** with **xcaddy** (Go builder stage) and ships a minimal **Alpine** runtime with:

| Component | Stage | Purpose |
|-----------|--------|--------|
| **xcaddy** | `golang:1.22-alpine` builder | Produces **`/usr/bin/caddy`** with the same module set as a standard Caddy 2 build (HTTP/3 / QUIC included). Add plugins with `xcaddy build … --with github.com/...` if needed. |
| **caddy** | copied from builder | Edge TLS termination, HTTP/1.1–3, gRPC routes per **`Caddyfile`** / ConfigMap. |
| **tcpdump** | Alpine runtime | Packet capture on pod interfaces (rotation suite, manual debug). |
| **tshark** | Alpine runtime | **Wireshark CLI** — decode QUIC/TLS pcaps, filter protocols, automate analysis in transport labs. |

## Build

From the **repository root** that contains **`docker/caddy-with-tcpdump/`**:

```bash
docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile .
```

**k3d** (example):

```bash
k3d image import caddy-with-tcpdump:dev -c <your-cluster-name>
```

**Colima / kind:** load the image into the cluster’s Docker/socket per your setup.

## Updating the Dockerfile yourself

**Builder (xcaddy)** — unchanged unless you bump **`CADDY_VERSION`** or add **`--with`** plugins:

```dockerfile
ENV CADDY_VERSION=v2.8.4
RUN xcaddy build "${CADDY_VERSION}" --output /usr/bin/caddy
```

**Runtime** — ensure both capture tools are installed (Alpine 3.19+):

```dockerfile
RUN apk add --no-cache ca-certificates tcpdump tshark libcap
```

- **`tcpdump`** — raw capture (`tcpdump -i eth0 -w /tmp/edge.pcap`).  
- **`tshark`** — analysis (`tshark -r /tmp/edge.pcap -Y quic -V`).  
- **`libcap`** + **`setcap`** on **`caddy`** — bind low ports if your base image supports it.

**Image size:** `tshark` pulls Wireshark dependencies; acceptable for a **debug/diagnostic** edge image. For production-only edges, split a **slim** image without `tshark` if you need a smaller footprint.

## Deploy on Kubernetes

OCH uses LoadBalancer-based Caddy (no hostPort) so two replicas can share a node. Example:

```bash
CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh
```

Manifests live under **`infra/k8s/caddy-h3-*.yaml`** (included). Ensure TLS Secrets exist in the expected namespace (this repo: typically **`record-local-tls`** + **`dev-root-ca`** in **`ingress-nginx`** / **`record-platform`**, not **`off-campus-housing-local-tls`**) per **`strict-tls-bootstrap.sh`** / **`setup-tls-and-edge.sh`** in **`scripts/`**.

## Verify tools in a running pod

```bash
kubectl exec -n <ns> deploy/caddy-h3 -c caddy -- caddy version
kubectl exec -n <ns> deploy/caddy-h3 -c caddy -- tcpdump --version
kubectl exec -n <ns> deploy/caddy-h3 -c caddy -- tshark --version
```

(Container name may differ — check **`infra/k8s/caddy-h3-deploy*.yaml`**.)
