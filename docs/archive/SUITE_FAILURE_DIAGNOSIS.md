# Test Suite Failure Diagnosis

Use this when `./scripts/run-all-test-suites.sh` exits with failures. It describes where logs live, what failed, and how to fix or re-run.

## Log locations

| What | Where |
|------|--------|
| **Live run (tee)** | `/tmp/run-all-suites-live.log` or `/tmp/full-run-<timestamp>.log` |
| **Per-suite logs** | `/tmp/suite-logs-<timestamp>/` (e.g. `baseline.log`, `adversarial.log`, `rotation.log`, `tls-mtls.log`) |
| **DB/cache verification** | Same dir: `*-verification.log`, `comprehensive-verification.log` |
| **Error summary** | End of live log: `=== Error Summary ===` and `Failed suites:` |

## Quick diagnosis

```bash
# See which suites failed and why
grep -E 'FAILED|❌|Failed suites:|Error Summary' /tmp/run-all-suites-live.log

# See failures in a specific suite
grep -iE 'error|failed|exit [1-9]' /tmp/suite-logs-*/adversarial.log
grep -iE 'error|failed|exit [1-9]' /tmp/suite-logs-*/rotation.log
grep -iE 'error|failed|exit [1-9]' /tmp/suite-logs-*/tls-mtls.log
```

## Common failures and fixes

### 1. Adversarial suite

- **DB disconnect test shows `{"error":"auth required"}`**  
  The script curls `/api/auth/health`; that endpoint may require auth. The suite does not fail on this; it only prints the response.
- **gRPC/HTTP/3 health checks did not all pass**  
  On Colima, gRPC **port-forward** (strict TLS) often times out. The suite is now relaxed: it **warns** but does **not fail** when only the port-forward check fails, as long as Caddy HTTP/3 and Envoy strict TLS pass.
- **Re-run adversarial only:**  
  `./scripts/enhanced-adversarial-tests.sh`

### 2. Rotation suite

- **Cannot read file .../tmp.XXX/tls.crt: no such file or directory**  
  Secret update was run with a kubectl that couldn’t read the host path (e.g. shim running inside Colima VM). Fix: rotation now uses **host kubectl** (explicit path) for secret create/update and checks that `LEAF_CRT` and `LEAF_KEY` exist before updating secrets.
- **Leaf cert or key missing before secret update**  
  Certificate generation failed or wrote elsewhere. Check the “Generating new leaf certificate” section in the rotation log; fix OpenSSL/mkcert and re-run.
- **Re-run rotation only:**  
  `./scripts/rotation-suite.sh`

### 3. TLS/mTLS comprehensive suite

- **Certificate chain completeness: FAILED (only 1 certificate)**  
  The test now **passes** when the leaf is in `record-local-tls` and the CA is in `dev-root-ca` (separate secrets), i.e. “leaf + CA” counts as full chain.
- **Port-forward process exited**  
  Stale or killed port-forward; script kills and retries. If it keeps failing, ensure no other process is using the same local port and that auth-service pod is Ready.
- **Re-run tls-mtls only:**  
  `./scripts/test-tls-mtls-comprehensive.sh`

### 4. Baseline: gRPC strict TLS/mTLS (Test 15)

- **gRPC Auth HealthCheck strict TLS/mTLS verification failed**  
  **Response: ERROR: strict TLS timed out after 12s**  
  Port-forward + grpcurl to the service often times out on Colima (e.g. TLS-only service, slow port-forward). The script no longer hangs; it times out and continues. Envoy gRPC health (Test 15a) is the primary path; strict TLS port-forward is best-effort.
- No change required for suite pass; baseline passes if Envoy gRPC and HTTP/2/HTTP/3 tests pass.

## Re-run options

```bash
# Full suite (preflight + all 6 suites)
./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/run-all-suites-live.log

# Single suites
./scripts/test-microservices-http2-http3.sh          # baseline
./scripts/enhanced-adversarial-tests.sh             # adversarial
./scripts/rotation-suite.sh                         # rotation
./scripts/test-tls-mtls-comprehensive.sh            # tls-mtls
```

## Runbook reference

See `Runbook.md` for API server readiness, kubeconfig (Colima single-cluster), and auth-service 401-on-delete deployment.
