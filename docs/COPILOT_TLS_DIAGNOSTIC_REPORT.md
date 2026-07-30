# Copilot TLS Diagnostic Report — Evidence for Deterministic Debugging

Per Copilot's request, we ran the exact commands and captured output.

---

## 1. Envoy cluster stats

**Command run:**
```bash
kubectl -n envoy-test port-forward svc/envoy-test 15000:10000
curl localhost:15000/clusters | grep -A20 auth_service
```

**Result:** Empty output. No `auth_service` matches.

**Reason:** Envoy service port 10000 is the gRPC listener, not the admin interface. The ConfigMap shows only a single listener on 10000 with `http_connection_manager` (gRPC). There is no admin/stats listener in the Envoy config, so `/clusters` is not exposed. Port-forwarding 15000→10000 reaches the gRPC listener, not admin.

**Conclusion:** Envoy cluster stats (`cx_connect_fail`, `ssl.handshake`, `verify_error`, etc.) are not available with the current deployment.

---

## 2. Client cert Subject / Issuer / SAN

**Command run (adjusted for our setup):**
```bash
# Envoy uses envoy-client-tls secret (envoy.crt), not certs/client/tls.crt
kubectl -n envoy-test get secret envoy-client-tls -o jsonpath='{.data.envoy\.crt}' | base64 -d | openssl x509 -noout -subject -issuer -text
```

**Result:**
```
Subject: CN=envoy, O=record-platform
Issuer:  CN=dev-root-ca, O=record-platform

Subject Alternative Name:
    DNS:envoy
    DNS:envoy-test.envoy-test.svc.cluster.local
```

**Note:** `certs/client/tls.crt` does not exist on host. The client cert used by Envoy is `envoy-client-tls.envoy.crt` in the envoy-test namespace.

---

## 3. Interpretation for Copilot

| Item | Value |
|------|-------|
| **Subject** | `CN=envoy, O=record-platform` |
| **SAN** | `envoy`, `envoy-test.envoy-test.svc.cluster.local` |
| **Issuer** | `CN=dev-root-ca, O=record-platform` |
| **Conclusion** | Correct client identity cert: CN/SAN identify the Envoy client, not `record.local` or `auth-service`. |

---

## 4. Fix applied (to keep strict mTLS)

**Root cause:** Backend gRPC services were using `/etc/certs/ca.crt` (from service-tls) for client cert verification. That CA might differ from the one that signs Envoy’s client cert.

**Change:** Set `TLS_CA_PATH=/certs/dev-root.pem` on all gRPC services (auth, records, listings, analytics, social, shopping, auction-monitor, python-ai). They now use the same dev-root CA that signs Envoy’s client cert.

**To apply:**
```bash
kubectl apply -k infra/k8s/base/
kubectl -n record-platform rollout restart deployment/auth-service deployment/records-service deployment/listings-service deployment/analytics-service deployment/messaging-service deployment/shopping-service deployment/auction-monitor deployment/python-ai-service
```

---

## 5. Isolation test not completed

**openssl s_client test:** A temporary pod was created to run `openssl s_client` from within the cluster to auth-service:50051 with the Envoy client cert. The pod exited before we could capture the full output; we did not get a clear success or failure.

**GRPC_REQUIRE_CLIENT_CERT=false test:** This was run earlier; when client cert requirement was disabled, gRPC worked, confirming the issue is client cert verification.

---

## 6. Summary for Copilot

1. **Envoy cluster stats:** Not available; Envoy admin/stats interface is not exposed.
2. **Client cert:** `CN=envoy`, SAN `envoy`, `envoy-test.envoy-test.svc.cluster.local` — appropriate for Envoy.
3. **Fix:** All backends now use `TLS_CA_PATH=/certs/dev-root.pem` instead of `/etc/certs/ca.crt`.
4. **Next step:** Redeploy with the fix above and retest gRPC via Caddy → Envoy → auth-service.
