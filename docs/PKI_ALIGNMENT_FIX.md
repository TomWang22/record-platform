# PKI Alignment Fix (CA Drift Resolution)

**Date:** 2026-02-28

## Root Cause

CA drift: Envoy's client cert was signed by one CA (`CN=dev-root-ca, O=record-platform`) while the cluster's `dev-root-ca` secret contained a different CA (either mkcert `dev-root-ca-1772265925` or local mkcert `tom@...`). Backends verified Envoy's client cert against the wrong CA → TLS handshake failed.

## Verification That Confirmed Drift

```bash
# Envoy client cert issuer
openssl x509 -in certs/envoy-client.crt -noout -issuer
# issuer=CN=dev-root-ca, O=record-platform

# Cluster dev-root-ca subject (different!)
kubectl -n record-platform get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d | openssl x509 -noout -subject
# subject=CN=dev-root-ca-1772265925, O=mkcert development CA

# Verification failed
openssl verify -CAfile /tmp/cluster-ca.pem certs/envoy-client.crt
# error 20: unable to get local issuer certificate
```

## Fix Applied (Nuclear Clean Reset)

1. **Provisioned from current mkcert** (single source of truth):
   - `service-tls`: Leaf cert for record.local + all service FQDNs, signed by mkcert
   - `dev-root-ca`: mkcert rootCA.pem in record-platform, ingress-nginx, envoy-test

2. **Regenerated Envoy client cert** with mkcert CA:
   ```bash
   CAROOT=$(mkcert -CAROOT)
   CA_CRT="$CAROOT/rootCA.pem" CA_KEY="$CAROOT/rootCA-key.pem" ./scripts/generate-envoy-client-cert.sh
   ```

3. **Updated envoy-client-tls** in envoy-test with the new cert

4. **Restarted** Envoy and all gRPC service deployments

## Verification

**Step 4 (absolute truth test)** — direct grpcurl to auth-service, bypassing Envoy:

```bash
kubectl -n record-platform port-forward svc/auth-service 50051:50051 &
grpcurl -cacert certs/dev-root.pem -cert certs/envoy-client.crt -key certs/envoy-client.key \
  -authority auth-service.record-platform.svc.cluster.local \
  127.0.0.1:50051 grpc.health.v1.Health/Check
# {"status": "SERVING"}
```

✅ **Passed** — backend trusts the Envoy client cert. mTLS is aligned.

## Re-run After Future Drift

If you see `upstream connect error or disconnect/reset before headers` again, **Envoy client cert must be signed by whichever CA is in `dev-root-ca`**.

### When cluster uses record-platform CA (from `certs/`)

```bash
# 1. Verify cluster CA
kubectl -n record-platform get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d | openssl x509 -noout -subject
# Should match certs/dev-root.pem

# 2. Regenerate Envoy client cert with that CA
CA_CRT=certs/dev-root.pem CA_KEY=certs/dev-root.key ./scripts/generate-envoy-client-cert.sh

# 3. Update secret and restart
kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found
kubectl -n envoy-test create secret generic envoy-client-tls \
  --from-file=envoy.crt=certs/envoy-client.crt --from-file=envoy.key=certs/envoy-client.key
kubectl -n envoy-test rollout restart deploy/envoy-test
```

### When cluster uses mkcert CA

```bash
CAROOT=$(mkcert -CAROOT)
CA_CRT="$CAROOT/rootCA.pem" CA_KEY="$CAROOT/rootCA-key.pem" ./scripts/generate-envoy-client-cert.sh
./scripts/strict-tls-bootstrap.sh  # updates envoy-client-tls and restarts Envoy
```

**Rule:** Run `openssl verify -CAfile <cluster-dev-root.pem> certs/envoy-client.crt` — must succeed before deploying.

## Preflight integration

`ensure-strict-tls-mtls-preflight.sh` (preflight step 5) now **automatically aligns** envoy-client-tls with dev-root-ca:

- If the current envoy-client-tls cert does not verify against the cluster CA → regenerate with `certs/dev-root.pem` + `certs/dev-root.key` (from reissue) or mkcert
- Update the secret and restart Envoy

So after step 3a (reissue) changes the CA, step 5 will regenerate the Envoy client cert and Test 4c should pass without manual intervention.
