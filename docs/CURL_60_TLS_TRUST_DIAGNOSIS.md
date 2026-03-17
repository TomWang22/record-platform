# Curl 60: TLS Trust Chain Diagnosis

When the enhanced smoke test fails with:

```text
curl: (60) SSL certificate problem: self signed certificate in certificate chain
```

and HTTP 000 / failed health checks, the root cause is a **trust chain mismatch**—not a transport or networking issue.

## Root Cause

Strict TLS is working. The failure proves that:

- curl is configured for strict verification (`--cacert` in use)
- TLS handshake starts but verification fails before HTTP
- The CA file passed to curl does **not** trust the certificate Caddy is serving

## Common Causes

1. **Caddy serving a different cert chain** than what `dev-root-ca` expects
2. **Stale `certs/dev-root.pem`**—CA was rotated (e.g. preflight step 3a) but local file wasn’t updated
3. **Wrong CA passed to curl**—path or env pointing to an outdated CA
4. **SAN mismatch**—cert doesn’t include `record.local`
5. **Mixed CA sources**—Caddy uses one CA (e.g. internal), curl trusts another

## Verify What Caddy Serves

```bash
openssl s_client -connect 192.168.64.240:443 -servername record.local -showcerts
```

Without `-CAfile`, s_client will always report "unable to verify the first certificate" — that is expected, because `dev-root-ca` is not in the system trust store. The output still shows issuer, subject, and SANs.

**To confirm the CA matches** (verify return code should be 0):

```bash
openssl s_client -connect 192.168.64.240:443 -servername record.local -CAfile certs/dev-root.pem
```

If you see `Verify return code: 0 (ok)`, the trust chain is correct and curl with `--cacert certs/dev-root.pem` should succeed.

Check from the first command:

- **Issuer** of the leaf cert (should be `CN=dev-root-ca, O=record-platform`)
- **Subject** and **SANs** (must include `DNS:record.local`)
- Whether the chain matches the `dev-root-ca` you expect

## Verify Your CA File

```bash
openssl x509 -in certs/dev-root.pem -noout -fingerprint -sha256
```

Compare this fingerprint with the issuer of the leaf cert from the `s_client` output.

## How the Enhanced and Baseline Suites Resolve CA

1. **Sync from cluster first** – `dev-root-ca` in `ingress-nginx` (or `record-platform`) is synced to `certs/dev-root.pem`. Host kubectl tried first, then `colima ssh kubectl` when Colima.
2. **CA path** – `CA_CERT` env or `certs/dev-root.pem` or `/tmp/grpc-certs/ca.crt`
3. **Exports** – when CA is set: `SSL_CERT_FILE` and `CURL_CA_BUNDLE` so tools pick it up even if `--cacert` is missing.
4. **HTTP/3** – when `TARGET_IP` (LB IP) is set, `HTTP3_USE_NATIVE_CURL=1` avoids Docker CA mount (curl 60).
5. **Debug** – set `CA_DEBUG=1` to log which CA is used

## If CA Still Mismatches

1. **Confirm Caddy TLS config** – Caddy must use the leaf signed by `dev-root-ca`:
   - `tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key`
   - No `tls internal` (that would use Caddy’s own CA)

2. **Confirm secret** – Caddy mounts `record-local-tls`; its `tls.crt` must be signed by the same CA as `dev-root-ca`.

3. **Re-run preflight** – `ensure-strict-tls-mtls-preflight.sh` syncs CA to `certs/dev-root.pem`; reissue (step 3a) rotates CA and leaf, then step 5 syncs the new CA.

## Packet Capture Interpretation

```text
TCP 443: 352
UDP 443: 12
```

Traffic reaches Caddy, but low UDP count means QUIC sessions don’t complete because TLS fails before handshake. This matches a trust issue rather than a transport problem.
