# Envoy → Backend: Real mTLS (Option B)

**Architecture (deterministic):**

```
Client / test suite (grpcurl, k6, etc.)
  ↓ TLS to Caddy (MetalLB LB IP :443)   ← run-preflight-scale-and-all-suites.sh uses this
Caddy
  ↓ h2c (plaintext)
Envoy
  ↓ mTLS
auth-service (gRPC TLS, require client cert)
```

- **Suite path:** MetalLB assigns an LB IP to Caddy; all tests (HTTP/2, HTTP/3, gRPC) target that IP:443. gRPC goes client → Caddy:LB_IP:443 → Envoy → auth-service. The "remote connection failure" is **Envoy → auth-service**, not client → Caddy. Fixing mTLS on the Envoy → backend leg fixes the suite.
- **Edge TLS:** Caddy only (at LB).
- **Internal mTLS:** Envoy ↔ services.
- **Services** must run TLS and must validate client cert. If any one of those is missing → `remote connection failure`.

We use **Option B — full mTLS service-to-service**:

- **Caddy** terminates TLS at the edge (client → Caddy).
- **Envoy** receives h2c from Caddy; Envoy connects to backends with **TLS + client cert** (mTLS).
- **Backends** (auth-service, records-service, etc.) run **TLS** and **require client cert** (`GRPC_REQUIRE_CLIENT_CERT=true`), validate with `dev-root-ca` / `ca.crt`.

So the failure is **not** “Envoy talks TLS to plaintext server”. Backends are TLS with client cert verification. The break is either: Envoy not presenting the client cert, backend missing `service-tls`/CA, or CA/cert mismatch after rotation.

---

## One thing to answer first: Is the service plaintext or TLS?

**From inside the cluster**, run:

```bash
grpcurl -plaintext auth-service.record-platform.svc.cluster.local:50051 grpc.health.v1.Health/Check
```

- **If this succeeds** → service is **plaintext**. Then Envoy’s TLS upstream config will always fail (reset before headers / remote connection failure). Fix: either remove `transport_socket` from Envoy clusters, or make the service actually start with TLS (mount `service-tls`, ensure certs exist).
- **If this fails** → service is **TLS**. Next step is cert/SAN/CA alignment (Envoy client cert, same CA, SAN match).

**Easiest:** run the diagnostic script (uses in-cluster grpcurl):

```bash
./scripts/diagnose-envoy-mtls.sh
```

It runs plaintext then TLS (-insecure) from inside the cluster and prints whether the service is plaintext or TLS.

**Alternative (from host with port-forward):**

```bash
kubectl -n record-platform port-forward svc/auth-service 50051:50051
# In another terminal:
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check   # if OK → service plaintext
grpcurl -insecure localhost:50051 grpc.health.v1.Health/Check   # if OK → service TLS
```

---

## Envoy cluster config (auth_service)

From `infra/k8s/base/envoy-test/deploy.yaml` — **clusters** section for `auth_service` (UpstreamTlsContext block):

```yaml
      - name: auth_service
        connect_timeout: 5s
        type: LOGICAL_DNS
        lb_policy: ROUND_ROBIN
        http2_protocol_options: {}
        load_assignment:
          cluster_name: auth_service
          endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: auth-service.record-platform.svc.cluster.local
                    port_value: 50051
        transport_socket:
          name: envoy.transport_sockets.tls
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
            sni: auth-service.record-platform.svc.cluster.local
            common_tls_context:
              tls_certificates:
              - certificate_chain:
                  filename: /etc/certs/client/tls.crt
                private_key:
                  filename: /etc/certs/client/tls.key
              validation_context:
                trusted_ca:
                  filename: /etc/certs/ca/dev-root.pem
```

**Paths:** Envoy mounts secret **envoy-client-tls** at `/etc/certs/client` (envoy.crt, envoy.key) — a **dedicated client cert** with CN=envoy, SAN=envoy, envoy-test.envoy-test.svc.cluster.local, signed by dev-root. It is **not** the edge leaf (record.local). Backends that require client cert then see a proper service identity. CA is `dev-root-ca` at `/etc/certs/ca` (dev-root.pem). `sni` is set per cluster to the backend service FQDN.

So:

- Envoy uses **TLS** to the upstream (`transport_socket`).
- Envoy **presents a dedicated client cert** (`tls_certificates` → `/etc/certs/client/envoy.crt` and `envoy.key` from secret **envoy-client-tls**). CN=envoy; not the edge leaf (record.local). Backends that validate client identity accept this.
- Envoy **validates the backend server** with `validation_context.trusted_ca` → `/etc/certs/ca/dev-root.pem`.
- **SNI** is set per cluster to the backend FQDN (e.g. `auth-service.record-platform.svc.cluster.local`).

---

## Backend (auth-service) TLS + client cert

- **Server TLS**: auth-service uses `service-tls` mounted at `/etc/certs` (tls.crt, tls.key, **ca.crt**). Code uses `TLS_CERT_PATH`, `TLS_KEY_PATH`, and `TLS_CA_PATH`/`GRPC_CA_CERT` (default `/etc/certs/ca.crt`) and only starts TLS when certs exist.
- **Client cert verification**: When `GRPC_REQUIRE_CLIENT_CERT=true` and CA exists, it uses `createSsl(..., requireClientCert: true)` so it **requires** a client cert signed by that CA.
- So auth-service is **TLS server + client cert required** (real mTLS). Same pattern for the other gRPC backends.

---

## What must be true for real mTLS to work

1. **record-platform** has secret **service-tls** with `tls.crt`, `tls.key`, `ca.crt` (leaf + CA). Backends need this to serve TLS and verify Envoy’s client cert.  
   - `./scripts/strict-tls-bootstrap.sh` creates **service-tls** (and record-local-tls, dev-root-ca) from `certs/`.
2. **envoy-test** has secret **envoy-client-tls** (Envoy’s **dedicated** client cert: CN=envoy, SAN=envoy, envoy-test.envoy-test.svc.cluster.local). Generate with `./scripts/generate-envoy-client-cert.sh` (requires `certs/dev-root.key`; run reissue with `KAFKA_SSL=1` once to persist it). Envoy deploy mounts it at `/etc/certs/client` (envoy.crt, envoy.key).
3. **Same CA**: Envoy’s `validation_context` and backend’s `ca.crt` must be the same CA (dev-root.pem). Envoy client cert and backend server cert(s) are all signed by that CA.
4. After changing secrets or Envoy config: restart Envoy and the gRPC backends so they pick up new certs/volumes.

**PKI layout (dev-friendly strict mTLS):** One CA (dev-root). Edge leaf (record.local) for Caddy only. One Envoy client cert (CN=envoy) for Envoy→backend mTLS. Service server certs can be the shared leaf or per-service; all signed by dev-root.

---

## 30-second check (confirm backend is TLS, not plaintext)

```bash
# 1) Port-forward auth-service
kubectl -n record-platform port-forward svc/auth-service 50051:50051

# 2) Plaintext → should FAIL (backend is TLS)
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
# Expected: connection error or refusal.

# 3) TLS with CA (no client cert) → may fail if backend requires client cert (mTLS)
grpcurl -cacert certs/dev-root.pem -authority record.local localhost:50051 grpc.health.v1.Health/Check
# If backend requires client cert: handshake failure.
# With client cert (Envoy’s identity):
# With client cert (Envoy’s identity — use dedicated Envoy cert for mTLS):
grpcurl -cacert certs/dev-root.pem -cert certs/envoy-client.crt -key certs/envoy-client.key -authority record.local localhost:50051 grpc.health.v1.Health/Check
# Expected: OK when certs match backend’s CA and SAN.
```

If (2) **succeeds**, the backend is still plaintext → then Envoy’s `transport_socket` would cause “remote connection failure”. If (2) **fails** and (3) with client cert **succeeds**, backend is TLS + mTLS and Envoy must present the same client cert (and have the secret mounted and restarted).

---

## Bootstrap and restarts

From repo root (with `certs/record.local.crt`, `certs/record.local.key`, `certs/dev-root.pem` in place):

```bash
./scripts/strict-tls-bootstrap.sh
```

This script:

- Creates **record-local-tls** (and **dev-root-ca**) in ingress-nginx and record-platform.
- Creates **service-tls** in record-platform (tls.crt, tls.key, ca.crt) so backends have TLS + CA for client verification.
- Creates **envoy-client-tls** in envoy-test from `certs/envoy-client.crt` and `certs/envoy-client.key` (generate with `./scripts/generate-envoy-client-cert.sh`; requires `certs/dev-root.key` — run reissue with `KAFKA_SSL=1` once to persist it).
- Restarts Envoy so it mounts **envoy-client-tls** and uses the Envoy client cert (CN=envoy) for upstreams.

Then ensure base is applied and backends restarted if you changed their secrets:

```bash
kubectl apply -k infra/k8s/base
kubectl -n record-platform rollout restart deployment/auth-service deployment/records-service deployment/social-service deployment/listings-service deployment/analytics-service deployment/shopping-service deployment/auction-monitor deployment/python-ai-service
```

---

## Clean implementation plan (phased — do not enable everything at once)

Do this in strict order so each step is verifiable.

### Phase 1 — Enable TLS on service only (no client cert required)

- Service runs TLS (presents cert).
- Service does **not** require client cert (`GRPC_REQUIRE_CLIENT_CERT=false`).
- **Test:** `grpcurl -insecure localhost:50051 grpc.health.v1.Health/Check` (with port-forward) or in-cluster grpcurl with `-insecure`. Must succeed.

### Phase 2 — Envoy TLS upstream (no client cert yet)

- Envoy cluster has `transport_socket` with `validation_context` (trusted_ca) only — **no** `tls_certificates` (Envoy does not send client cert).
- Backend still has `GRPC_REQUIRE_CLIENT_CERT=false`.
- **Test:** grpcurl via Caddy → Envoy → auth-service. Must succeed. Confirms Envoy trusts service cert and SNI/paths are correct.

### Phase 3 — Full mTLS

- Backend: `GRPC_REQUIRE_CLIENT_CERT=true`, same CA in `service-tls` (ca.crt).
- Envoy: add `tls_certificates` (client.crt / client.key) to cluster; same CA in `validation_context`.
- **Test:** again via Caddy → Envoy → auth-service. Must succeed.

If you enable Phase 3 while the service is still plaintext (Phase 0), you get the exact error you see. So always confirm Phase 1 first (service is TLS) with the plaintext check above.

---

## SAN and Envoy paths

- **SAN:** If the service cert has SANs like `auth-service.record-platform.svc.cluster.local` but Envoy connects with SNI `record.local`, validation can fail. Our config uses `sni: record.local`; the leaf cert is for `record.local`. If your leaf has different SANs, set `sni` in `UpstreamTlsContext` to match.
- **Envoy paths:** Client cert and CA in Envoy must be correct:
  - Client: `/etc/certs/client/envoy.crt`, `/etc/certs/client/envoy.key` (from secret **envoy-client-tls**; dedicated Envoy cert, CN=envoy).
  - CA: `/etc/certs/ca/dev-root.pem` (from secret **dev-root-ca**). After CA rotation, Envoy must mount the updated secret and restart.

---

## Inspect live Envoy config

```bash
kubectl -n envoy-test get configmap envoy-config -o yaml
```

Look at `data.envoy.yaml` → `static_resources.clusters` for `auth_service` (and others). You should see `transport_socket` with `tls_certificates` and `validation_context` as in the snippet above.
