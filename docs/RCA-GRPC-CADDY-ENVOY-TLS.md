# Root Cause Analysis: gRPC via Caddy → Envoy (SSLV3_ALERT_HANDSHAKE_FAILURE)

**Purpose:** Explain why Test 4c and in-cluster gRPC fail with `TLS_error: SSLV3_ALERT_HANDSHAKE_FAILURE`, and how to fix mode alignment.

---

## Mode alignment (critical)

Both paths can fail with the same error:

1. **grpcurl → Caddy → Envoy** (host to LB :443)
2. **grpcurl (in-cluster) → Envoy** (pod to Envoy :10000)

If **in-cluster** fails with TLS_error, the issue is at the **Envoy listener**, not Caddy. Either:

- **Envoy listener is TLS** but the client is using **plaintext** → handshake failure, or  
- **Envoy listener is plaintext** but the client is using **TLS** → handshake failure.

You must align all three: **Envoy listener**, **in-cluster grpcurl**, and **Caddy upstream**.

---

## 20-second diagnostic (which mode does Envoy expect?)

```bash
kubectl -n envoy-test port-forward deploy/envoy-test 15000:10000 &
sleep 3
# Test 1: Plaintext — if this works, Envoy listener is plaintext (Model A).
grpcurl -plaintext localhost:15000 grpc.health.v1.Health/Check
# Test 2: TLS — if this works, Envoy listener is TLS (Model B).
grpcurl -cacert certs/dev-root.pem localhost:15000 grpc.health.v1.Health/Check
kill %1 2>/dev/null
```

- **Plaintext works, TLS fails** → Model A. Envoy is plaintext. Caddy must use `h2c://`; in-cluster grpcurl must use `-plaintext`.
- **TLS works, plaintext fails** → Model B. Envoy has DownstreamTlsContext. Caddy must use `https://` upstream; in-cluster grpcurl must use `-cacert`.

---

## Current repo state (Model A — Envoy plaintext)

**Envoy listener (snippet):** no `transport_socket` on listener :10000 → plaintext.

```yaml
# infra/k8s/base/envoy-test/deploy.yaml (listener only)
listeners:
  - name: listener_0
    address:
      socket_address: { address: 0.0.0.0, port_value: 10000 }
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config: { ... }
# NO transport_socket / DownstreamTlsContext
```

**Caddy gRPC block:**

```
# gRPC: route to Envoy via h2c only.
@grpc path_regexp \.
handle @grpc {
  reverse_proxy h2c://envoy-test.envoy-test.svc.cluster.local:10000 {
    header_up Host {http.request.host}
  }
}
```

**In-cluster test:** `grpcurl -plaintext ... envoy-test.envoy-test.svc.cluster.local:10000 grpc.health.v1.Health/Check`

If you still see TLS_error in-cluster, the **running** Envoy may have an old config with TLS. Re-apply and restart:

```bash
kubectl apply -k infra/k8s/base/envoy-test
kubectl -n envoy-test rollout restart deployment envoy-test
```

Then re-run the 20-second diagnostic; plaintext should succeed. Or run:

```bash
./scripts/diagnose-envoy-grpc-listener-mode.sh
```

It port-forwards Envoy :10000, tries plaintext then TLS, and reports which mode Envoy expects.

---

## Quick fix (TLS at Caddy only, Envoy plaintext h2c)

1. **Envoy listener 10000:** Must have **no** DownstreamTlsContext (plaintext). See `infra/k8s/base/envoy-test/deploy.yaml` — listener has no `transport_socket`.
2. **Caddy gRPC block:** Must use `reverse_proxy h2c://envoy-test.envoy-test.svc.cluster.local:10000` — **do not** use `https://` upstream for Envoy.
3. **Apply and restart:**  
   `./scripts/rollout-caddy.sh` (updates Caddy configmap from `Caddyfile` and restarts both caddy-h3 and envoy-test), or manually:
   - `kubectl -n ingress-nginx create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -`
   - `kubectl -n ingress-nginx rollout restart deployment caddy-h3`
   - `kubectl -n envoy-test rollout restart deployment envoy-test`

In-cluster grpcurl **must** use `-plaintext` (suite does this). If the running Envoy has TLS, re-apply the Envoy deploy so the listener is plaintext.

---

## 1. Data path

```
grpcurl (TLS, -authority record.local) → Caddy :443
  → Caddy terminates TLS
  → reverse_proxy h2c://envoy-test.envoy-test.svc.cluster.local:10000  (plain HTTP/2)
Envoy listener :10000 (plain, no TLS)
  → Envoy routes to cluster (e.g. auth_service)
  → Envoy connects to auth-service.record-platform.svc.cluster.local:50051 with TLS (UpstreamTlsContext)
auth-service gRPC server :50051 (TLS if /etc/certs/tls.crt exists)
  → presents cert; Envoy validates with dev-root.pem
```

The **TLS handshake failure** can be on the **Envoy → backend** leg (Envoy to auth-service, etc.). For **strict mTLS**, backends have `GRPC_REQUIRE_CLIENT_CERT=true` and Envoy **must** present a client certificate. Envoy is configured with `tls_certificates` in each cluster's UpstreamTlsContext (certificate from `record-local-tls` secret in envoy-test, mounted at `/etc/certs/client`). Ensure `./scripts/strict-tls-bootstrap.sh` has been run so that `record-local-tls` exists in the **envoy-test** namespace; then restart Envoy and all gRPC backends after any cert rotation. Caddy → Envoy remains plain h2c.

---

## 2. Root cause

Envoy's cluster config uses `sni: record.local` for all clusters. The gRPC backends present their cert (from service-tls). If the leaf cert was issued for **record.local** only, SNI `record.local` can work; if it was issued for the service DNS name (e.g. `auth-service.record-platform.svc.cluster.local`), then Envoy must use that as SNI or the handshake fails.

Typical causes:

1. **SNI / cert name mismatch** — Backend cert is for service DNS; Envoy sends `record.local`. **Fix:** Set SNI per cluster to the cluster's target hostname (see below).
2. **CA mismatch / CERTIFICATE_VERIFY_FAILED** — Envoy's `dev-root.pem` (from secret `dev-root-ca` in namespace **envoy-test**) is not the CA that signed the backend leaf. After reissue, record-platform and ingress-nginx get the new dev-root-ca, but **envoy-test** is only updated when `ensure-strict-tls-mtls-preflight.sh` runs (it now always syncs dev-root-ca to envoy-test and restarts Envoy). If you see `CERTIFICATE_VERIFY_FAILED` on the Envoy→backend leg, run: `./scripts/sync-envoy-tls-secrets.sh` then `kubectl -n envoy-test rollout restart deploy/envoy-test`.
3. **Backend not serving TLS** — Certs not mounted or server using createInsecure(). Ensure TLS paths are set and certs exist.

---

## 3. Fix: SNI and backend certs

**Per-service certs (current):** Envoy uses `sni: <service>.record-platform.svc.cluster.local` per cluster. The **service-tls** leaf cert must have SANs for all gRPC services (auth-service, records-service, messaging-service, etc.). `ensure-strict-tls-mtls-preflight.sh` provisions from mkcert with these SANs. `rotate-ca-and-fix-tls.sh` also updates service-tls with the rotated cert.

- Confirm Envoy SNI: `./scripts/diagnose-envoy-grpc.sh --save /tmp/diag` then grep `sni` in /tmp/diag/envoy-config-dump.json.
- Confirm backend cert SANs: from a pod that mounts service-tls, `openssl x509 -in /etc/certs/tls.crt -noout -text` and check Subject Alternative Name includes the service FQDN.

---

## 4. Verification

- **Envoy admin diagnostic (clusters, config_dump):**  
  `./scripts/diagnose-envoy-grpc.sh` — port-forwards Envoy admin 15000, fetches `/clusters` and `/config_dump`. Confirms `auth_service` cluster exists and TLS context (SNI, tls_certificates) is correct. Use `--save DIR` to write outputs.

- **In-cluster (plaintext to Envoy):**  
  `kubectl run grpc-incluster --rm -i -n record-platform --image=fullstorydev/grpcurl -- grpcurl -plaintext -max-time 10 envoy-test.envoy-test.svc.cluster.local:10000 grpc.health.v1.Health/Check`  
  If this works but grpcurl via Caddy fails, the failure is Envoy → backend TLS.

- **Via Caddy:**  
  `grpcurl -cacert certs/dev-root.pem -authority record.local <LB_IP>:443 grpc.health.v1.Health/Check`

---

## 5. References

- Caddyfile: `reverse_proxy h2c://envoy-test.envoy-test.svc.cluster.local:10000` for `@grpc`.
- Envoy: `infra/k8s/base/envoy-test/deploy.yaml`.
- Auth gRPC: `services/auth-service/src/grpc-server.ts` (TLS from `/etc/certs/` when present).
