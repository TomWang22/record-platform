# Record Platform network contract (hard invariant)

All human, browser, curl, k6, and Playwright traffic enters through **MetalLB + TLS SNI** — never through localhost, NodePort, or `*.local` hostnames.

## Canonical edge

| Setting | Value |
|---------|--------|
| Host / SNI | `record-platform.test` |
| Origin | `https://record-platform.test` |
| Ingress | Caddy `caddy-h3` LoadBalancer (TCP **443** + UDP **443**) |
| Internal services | `http://<service>.record-platform.svc.cluster.local:<port>` |

## Required env (ConfigMap `rp-network-contract`)

```
RP_PUBLIC_HOST=record-platform.test
RP_PUBLIC_ORIGIN=https://record-platform.test
RP_INGRESS_HOST=record-platform.test
RP_TLS_SNI=record-platform.test
RP_REQUIRE_METALLB=1
RP_FORBID_NODEPORT=1
RP_FORBID_LOCALHOST_ENTRYPOINT=1
```

Legacy `OCH_*` names may remain only as documented fallbacks; new scripts read `RP_*` first.

## Forbidden for app / bootstrap / tests

- `localhost`, `127.0.0.1`, `0.0.0.0` as **client** URLs
- `host.docker.internal` for application HTTP (DB restore compose only — `DB_RESTORE_ONLY`)
- `type: NodePort` for edge ingress
- `*.local` hostnames (`record.local`, mDNS)
- `off-campus-housing.test` in RP tree
- Direct pod IP or ClusterIP from the **host**

## Allowed exceptions

- In-pod gRPC health probes (`-addr=localhost:<port>` in Deployment manifests)
- Prometheus self-scrape `localhost:9090` inside the pod
- `docs/legacy/**` and lines marked `LEGACY_EXAMPLE_DO_NOT_USE`
- Hybrid backup / `docker-compose.yml` host ports 5433–5443, 6379, 9000/9001 only (`DB_RESTORE_ONLY`)
- `docker-compose.yml` **in-container** healthchecks (`127.0.0.1:<port>` inside the same container) — not host edge URLs

## Docker Compose contract

Compose is external infra only. Forbidden in active `docker-compose.yml`:

- Confluent `kafka` / `zookeeper`, compose app services, HAProxy/Nginx, host Kafka ports 9092/29093/2181
- OCH runtime DB ports 5444–5448, Redis 6380

```bash
make rp-verify-compose-contract
```

## Colima / kubeconfig

- API server URL = Colima **bridge IP** + live k3s port (from VM `k3s.yaml`)
- **Not** `127.0.0.1:6443` or `localhost` for bootstrap-scoped kubectl

## Diagnostic edge images (C.images)

Cold-bootstrap and `make bootstrap` expect these tags in **Colima VM Docker** (k3s pulls from the VM runtime, not host-only images):

- `caddy-with-tcpdump:dev` — built from `docker/caddy-with-debug-tools.Dockerfile` (Caddy/xcaddy + tcpdump, tshark, strace, htop)
- `envoy-with-tcpdump:dev` — built from `docker/envoy-with-debug-tools.Dockerfile` (Envoy + same tool set)

**Operators should not** pre-build these manually. Use:

```bash
make rp-build-required-images    # host Docker
make rp-verify-required-images   # host + Colima
```

`scripts/cold-bootstrap.sh` phase **C.images** runs build → load → verify automatically. Build logs: `bench_logs/command-logs/C.images/`.

## Caddy / gateway

- Site block: `https://record-platform.test`
- `header_up X-RP-Edge-Proto {http.request.proto}` (and `X-OCH-Edge-Proto` for compatibility)
- `Alt-Svc: h3=":443"`
- Upstreams: Kubernetes DNS service names only

## Audits & smoke

```bash
make rp-verify-compose-contract   # docker-compose.yml external infra only
make rp-audit-network-contract    # compose contract + static grep audit
make rp-smoke-ingress-sni         # live MetalLB + curl h1/h2/h3
make rp-preflight-network-contract  # all of the above (static + live edge)
```

App tests that hit the edge:

```bash
METALLB_IP=$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl --cacert certs/dev-root.pem \
  --resolve record-platform.test:443:${METALLB_IP} \
  https://record-platform.test/api/healthz
```

## Bootstrap gate order

1. `bash backups/hybrid-rp-och/validate-hybrid-backup.sh`
2. `make rp-preflight-network-contract`
3. Then k8s memory / service merge (B, D, …)

Do **not** cold-bootstrap until both hybrid backup validation and network contract preflight pass.
