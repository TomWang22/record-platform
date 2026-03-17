# Envoy → auth-service TLS Diagnostic Report

## Summary

**Error:** `upstream connect error or disconnect/reset before headers. reset reason: remote connection failure`

**Root cause:** Backend gRPC services were using `/etc/certs/ca.crt` (service-tls) for client cert verification. Envoy's client cert is signed by **dev-root-ca**. If service-tls.ca.crt differs from dev-root, verification fails.

**Fix applied:** Set `TLS_CA_PATH=/certs/dev-root.pem` on all gRPC services (auth, records, listings, analytics, social, shopping, auction-monitor, python-ai). All backends now use the same CA that signs Envoy's client cert.

---

## 1. Envoy Cluster Stats

The `/clusters` admin endpoint did not return parseable cluster stats in the format expected. The Envoy pod listens on 10000 for gRPC (not admin). Admin may be on a different port or disabled.

---

## 2. Client Cert Identity (envoy-client-tls)

**Secret:** `envoy-client-tls` (envoy-test namespace)  
**Files:** `envoy.crt`, `envoy.key`  
**Mounted in Envoy:** `/etc/certs/client/envoy.crt`

```
Subject: CN=envoy, O=record-platform
Issuer:  CN=dev-root-ca, O=record-platform
SAN:     DNS:envoy, DNS:envoy-test.envoy-test.svc.cluster.local
```

**This is a proper client identity cert** — CN and SAN identify the Envoy client, not the server.

---

## 3. service-tls (shared cert) — Different from Envoy

Used by api-gateway and other services (not Envoy for upstream):

```
Subject: CN=record.local, O=record-platform
SAN:     record.local, *.record.local, auth-service.record-platform.svc.cluster.local, api-gateway..., etc.
```

Envoy uses **envoy-client-tls** (envoy.crt), not service-tls, for upstream mTLS.

---

## 4. Envoy Config (Running)

- **SNI:** `auth-service.record-platform.svc.cluster.local` ✓
- **Client cert:** `/etc/certs/client/envoy.crt` ✓
- **CA:** `/etc/certs/ca/dev-root.pem` ✓

---

## 5. auth-service

- `GRPC_REQUIRE_CLIENT_CERT=true` when set → requires and verifies client cert
- Uses `grpc.ServerCredentials.createSsl(rootCerts, [serverCert], requireClientCert)`
- Default Go TLS verification: client cert must be signed by `rootCerts` (dev-root-ca)

---

## 6. Most Likely Causes

1. **Client cert SAN/CN rejection** — If auth-service has custom `VerifyPeerCertificate` or expects client identity to match a specific pattern (e.g. `api-gateway`, `envoy-test`), the current cert with CN=envoy / SAN=envoy-test.envoy-test.svc.cluster.local might be rejected.

2. **CA mismatch** — auth-service might load a different CA than dev-root (e.g. from a different secret or path).

3. **Cipher/ALPN** — No shared cipher or h2 ALPN issue (would need openssl s_client to confirm).

---

## 7. Isolation Tests to Run

### Test A: Disable client cert requirement

```bash
# Patch auth-service to disable client cert requirement
kubectl -n record-platform set env deploy/auth-service GRPC_REQUIRE_CLIENT_CERT=false
kubectl -n record-platform rollout status deploy/auth-service
# Then retry gRPC via Caddy → Envoy → auth-service
```

If it works → client cert identity is being rejected.

### Test B: openssl s_client from temp pod

```bash
kubectl -n envoy-test run tmp --rm -it --image=alpine -- sh
# In pod:
apk add openssl
openssl s_client -connect auth-service.record-platform.svc.cluster.local:50051 \
  -cert /etc/certs/client/envoy.crt \
  -key /etc/certs/client/envoy.key \
  -CAfile /etc/certs/ca/dev-root.pem \
  -servername auth-service.record-platform.svc.cluster.local
```

Note: Envoy pod uses `client-tls` volume at `/etc/certs/client/`. Run the temp pod in same namespace and copy certs, or use a pod that mounts envoy-client-tls.

---

## 8. Next Steps

1. Run **Test A** — if gRPC works with `GRPC_REQUIRE_CLIENT_CERT=false`, the fix is either:
   - Ensure auth-service accepts CN=envoy / SAN=envoy-test.envoy-test.svc.cluster.local
   - Or add custom `VerifyPeerCertificate` that allows these identities

2. If auth-service uses standard Go TLS with no custom verification, the failure may be cipher/ALPN or CA loading — inspect auth-service logs for TLS errors.
