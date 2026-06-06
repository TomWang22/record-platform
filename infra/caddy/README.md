# Record Platform Caddy debug edge image

Production edge runs `caddy-h3` in `ingress-nginx` with HTTP/3 (QUIC) on UDP/443.
This image adds operator tooling for transport RCA without changing Caddy behavior.

## Contents

| Tool | Package | Purpose |
|------|---------|---------|
| caddy | xcaddy build v2.8.4 | Edge proxy with h1/h2/h3 |
| xcaddy | go install | Rebuild Caddy with plugins |
| strace | apk strace | Syscall tracing |
| htop | apk htop | Process monitor |
| tcpdump | apk tcpdump | Packet capture (needs caps) |
| tshark | apk wireshark-tshark | QUIC/TLS decode (needs caps) |
| curl, jq | apk | HTTP probes |
| bind-tools | apk | dig/nslookup |
| openssl | apk | Cert inspection |

Image size note: `wireshark-tshark` adds ~40–60MB on Alpine 3.19; kept for QUIC decode per contract.

## Build and load (Colima)

```bash
./scripts/build-rp-caddy-debug.sh
# imports into active docker context (Colima when DOCKER_HOST points there)
```

## Smoke tools

```bash
./scripts/smoke-rp-caddy-debug-tools.sh
```

## Kubernetes: debug pod only

Do **not** add `NET_ADMIN` / `NET_RAW` to the production `caddy-h3` Deployment.

For packet capture, run an ephemeral debug pod:

```yaml
securityContext:
  capabilities:
    add: ["NET_ADMIN", "NET_RAW"]
```

Mount the same Caddyfile + TLS secrets as production. Use `kubectl debug` or a one-off Job.

## Rollout path

1. Build `rp-caddy-debug:dev` locally.
2. `colima ssh -- docker load` or `docker save | colima ssh -- docker load`.
3. Patch `caddy-h3` image in `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` (or overlay) for lab only.
4. Run `scripts/smoke-rp-edge-transport.sh` and `scripts/smoke-rp-mtls.sh`.
5. Production: keep slim `caddy-with-tcpdump` until debug image is reviewed; swap via `scripts/rollout-caddy.sh`.

## Related

- `Caddyfile` — edge routes including `/healthz` → api-gateway, `/mtls-healthz` client-auth probe
- `scripts/generate-rp-mtls-test-certs.sh` — dev client CA + leaf for mTLS smoke
- `docker/caddy-with-tcpdump/Dockerfile` — legacy minimal image (caddy + tcpdump only)
