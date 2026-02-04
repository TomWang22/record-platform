# Envoy TLS + Test Suite Fixes (Restored)

## Envoy TLS on NodePort 30000

- **`infra/k8s/base/envoy-test/deploy.yaml`**: Listener uses **TLS downstream** (`DownstreamTlsContext` with `tls.crt` + `tls.key` from `envoy-service-tls`). Volume mount for `envoy-service-tls` at `/etc/certs/server`.
- **`scripts/sync-envoy-tls-secrets.sh`**: Copies `dev-root-ca` and `service-tls` from `record-platform` to `envoy-test` as `dev-root-ca` and `envoy-service-tls`.

## Scripts Restored / Updated

| Script | Purpose |
|--------|---------|
| `sync-envoy-tls-secrets.sh` | Sync CA + leaf secrets to envoy-test for Envoy TLS |
| `install-tooling-preflight.sh` | Verify tcpdump, tshark, netstat, htop, grpcurl (optional: strace, valgrind) |
| `preflight-fix-kubeconfig.sh` | Fix Kind/Colima kubeconfig, cluster reachability |
| `run-preflight-scale-and-all-suites.sh` | Preflight → scale → TLS check → tooling → run all suites |
| `run-all-test-suites.sh` | Run baseline, enhanced, adversarial, rotation, standalone |
| `enhanced-adversarial-tests.sh` | DB disconnect, cache, packet capture, protocol-under-load |
| `test-packet-capture-standalone.sh` | Generate H2/H3/gRPC traffic, capture on Caddy/Envoy |
| `ensure-all-services-tls.sh` | Check service TLS mounts + envoy-test dev-root-ca / envoy-service-tls |

## Rotation Suite

- After rotating CA/leaf, **`rotation-suite.sh`** calls `sync-envoy-tls-secrets.sh` so Envoy keeps using up-to-date certs.

## Preflight Pipeline

1. Preflight kubeconfig  
2. (Optional) Trim completed pods  
3. Ensure API server ready  
4. **Sync Envoy TLS secrets** (step 2b)  
5. Scale services, Envoy, Caddy  
6. Strict TLS check (`ensure-all-services-tls`)  
7. Pod health, DB, Redis check  
8. Tooling preflight  
9. Run all test suites  

## Quick Start

```bash
# 1. Apply infra, sync secrets, restart Envoy
kubectl apply -k infra/k8s/overlays/dev
./scripts/sync-envoy-tls-secrets.sh
kubectl -n envoy-test rollout restart deploy/envoy-test

# 2. Run full pipeline
STRICT=1 ./scripts/run-preflight-scale-and-all-suites.sh
```
