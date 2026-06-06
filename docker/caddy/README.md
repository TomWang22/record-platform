# Record Platform Caddy image (`rp-caddy:dev`)

Runtime and debug edge image with Caddy 2.8+ (xcaddy build), HTTP/3, and network operator tools.

## Build and load (Colima)

```bash
./scripts/build-rp-caddy.sh
docker save rp-caddy:dev | colima ssh -- docker load
```

## Tool smoke

```bash
./scripts/smoke-rp-caddy-tools.sh
```

## QUIC / HTTP/3 smoke

```bash
./scripts/smoke-rp-caddy-quic.sh
```

## Image contents

| Tool | Purpose |
|------|---------|
| caddy | Edge TLS, HTTP/2, HTTP/3 |
| xcaddy | Custom module builds |
| tcpdump / tshark | Packet capture (debug pods only) |
| strace / htop | Process inspection |
| curl / jq / openssl / dig | Edge smoke and cert checks |

## Kubernetes debug pod (not production)

Apply `infra/caddy/caddy-debug-pod.yaml` for an ephemeral toolcheck pod.

**Do not** add `NET_ADMIN` / `NET_RAW` to production `caddy-h3`. Use the debug pod for capture:

```yaml
securityContext:
  capabilities:
    add: ["NET_ADMIN", "NET_RAW"]
```

Capture example (debug pod on same node as edge):

```bash
kubectl -n ingress-nginx exec -it rp-caddy-toolcheck -- \
  tcpdump -i any -n udp port 443 -c 20
```

Prod edge may stay on `caddy-with-tcpdump:dev`; swap to `rp-caddy:dev` only in lab when investigating QUIC.
