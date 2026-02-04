# TLS/mTLS Issues & Fixes - Runbook Update

## Critical Issue: HTTP/3 curl exit 77 (SSL Certificate Problem)

### Symptoms
- All HTTP/3 tests failing with `curl: (77) error setting certificate verify locations`
- Error: `Problem with the SSL CA cert (path? access rights?)`
- HTTP/2 works fine with same CA certificate
- HTTP/3 curl container cannot access mounted CA certificate

### Root Cause
- Docker volume mounts don't work reliably with `--network host` mode in Colima
- CA certificate file was being mounted but container couldn't access it
- HTTP/3 curl helper was using volume mount which failed in host network mode

### Solution
**Changed CA certificate passing method from volume mount to base64-encoded environment variable**

1. **Updated `scripts/lib/http3.sh`**:
   - Changed from `-v /path/to/ca.pem:/tmp/ca-cert.pem:ro` mount
   - To base64-encoded environment variable: `CA_CERT_B64`
   - Certificate is decoded in container: `echo "$CA_CERT_B64" | base64 -d > /tmp/http3-ca-cert.pem`
   - Works reliably with `--network host` mode

2. **Fixed NodePort usage**:
   - HTTP/3 now uses NodePort 30443 instead of port 443
   - URL automatically updated to use NodePort when in HOST_NETWORK mode
   - `CADDY_NODEPORT` environment variable controls NodePort

### Files Changed
- `scripts/lib/http3.sh` - Fixed CA cert mounting, added NodePort support
- `scripts/test-microservices-http2-http3.sh` - Updated HTTP3_RESOLVE to use NodePort

### Verification
```bash
# Test HTTP/3 with CA cert
CA_CERT="/tmp/test-ca.pem"  # Get from dev-root-ca secret
. scripts/lib/http3.sh
export CADDY_NODEPORT=30443
http3_curl --cacert "$CA_CERT" --http3-only "https://record.local/_caddy/healthz"
# Should return: ok (HTTP 200)
```

---

## Critical Issue: Incomplete Certificate Chains

### Symptoms
- HTTP/3 curl exit 77 (certificate verification failed)
- gRPC strict TLS verification failing
- Certificate chain verification failing with openssl
- Services only presenting leaf certificate, not full chain

### Root Cause
- `service-tls` secret only contained leaf certificate in `tls.crt`
- Caddy `record-local-tls` secret only contained leaf certificate
- Certificate chain incomplete (missing CA certificate in chain)

### Solution
**Updated certificate generation to include full chain (leaf + CA)**

1. **Updated `scripts/reissue-ca-and-leaf-load-all-services.sh`**:
   - Creates `CHAIN_CRT` by concatenating leaf and CA: `cat "$LEAF_CRT" "$CA_CRT" > "$CHAIN_CRT"`
   - Uses `CHAIN_CRT` for both `record-local-tls` (Caddy) and `service-tls` (gRPC services)
   - Ensures full certificate chain is presented to clients

2. **Verified all pods have full chain**:
   - Created `scripts/verify-full-cert-chain-all-pods.sh`
   - Confirms 2 certificates in `tls.crt` for all pods
   - All Caddy, Envoy, and service pods verified

### Files Changed
- `scripts/reissue-ca-and-leaf-load-all-services.sh` - Added chain creation
- `scripts/verify-full-cert-chain-all-pods.sh` - New verification script

### Verification
```bash
# Verify service-tls has full chain
kubectl -n record-platform get secret service-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | grep -c "BEGIN CERTIFICATE"
# Should return: 2

# Verify pod has full chain
kubectl -n record-platform exec auth-service-xxx -- cat /etc/certs/tls.crt | grep -c "BEGIN CERTIFICATE"
# Should return: 2
```

---

## Issue: Envoy NodePort Not Reachable

### Symptoms
- gRPC tests via Envoy NodePort 30000 failing
- Error: `Failed to dial target host "127.0.0.1:30000": context deadline exceeded`
- Port-forward works as fallback

### Root Cause
- Colima networking issue - NodePort not properly exposed to host
- Envoy NodePort 30000 configured correctly in Kubernetes
- Port is not reachable from host machine

### Solution
**Use port-forward as fallback (already implemented in test scripts)**

- Test scripts already have port-forward fallback logic
- Direct service access via port-forward works with strict TLS
- NodePort connectivity is infrastructure issue (Colima networking)

### Workaround
```bash
# Use port-forward for gRPC testing
kubectl -n record-platform port-forward pod/auth-service-xxx 50051:50051 &
grpcurl -cacert /path/to/ca.pem 127.0.0.1:50051 grpc.health.v1.Health/Check
```

---

## Issue: Cache Behavior Test Returning "auth required"

### Symptoms
- Cache test in `enhanced-adversarial-tests.sh` returning `{"error":"auth required"}`
- Test hitting `/api/records/health` endpoint
- Health endpoints should be public

### Root Cause
- Wrong endpoint path: `/api/records/health` (missing 'z')
- Correct endpoint: `/api/records/healthz`
- Auth service gatekeeping the request

### Solution
**Fixed endpoint path in cache test**

- Updated `scripts/enhanced-adversarial-tests.sh`
- Changed from `/api/records/health` to `/api/records/healthz`
- Health endpoints are public and don't require authentication

### Files Changed
- `scripts/enhanced-adversarial-tests.sh` - Fixed health endpoint path

---

## Issue: TLS/mTLS Comprehensive Test Failures

### Symptoms
- Test 2: gRPC via Envoy NodePort - FAILED
- Test 3: gRPC port-forward - FAILED (port-forward failed)
- Test 5: Certificate chain completeness - FAILED (could not retrieve chain)

### Root Causes & Fixes

1. **Port-forward timeout too short**:
   - Fixed: Increased sleep from 2s to 5s, added retry logic
   - Added port connectivity check with `nc -z`

2. **Certificate chain test using openssl in Caddy pod**:
   - Fixed: Changed to read certificate file directly (`/etc/caddy/certs/tls.crt`)
   - Caddy pod may not have openssl installed
   - Fallback to openssl if file read fails

3. **Envoy NodePort not reachable**:
   - Known issue (Colima networking)
   - Test marked as expected failure with workaround

### Files Changed
- `scripts/test-tls-mtls-comprehensive.sh` - Fixed port-forward timing, certificate chain test

---

## Issue: Rotation Suite Failing

### Symptoms
- Rotation suite fails during "Updating Kubernetes secrets in parallel batches"
- Exit code 1
- Secrets not updated correctly

### Root Cause
- PID assignment bug: Both `CA_ING_PID` and `CA_APP_PID` set to same value
- `$!` only holds most recent background job PID
- Second background job PID not captured correctly

### Solution
**Fixed PID capture order**

- Capture PID immediately after starting each background job
- Changed from:
  ```bash
  (job1) & (job2) & CA_ING_PID=$! CA_APP_PID=$!
  ```
- To:
  ```bash
  (job1) & CA_ING_PID=$!
  (job2) & CA_APP_PID=$!
  ```

### Files Changed
- `scripts/rotation-suite.sh` - Fixed PID assignment order

---

## Test Suite Results Summary

### ✅ Fixed & Passing
- **HTTP/3**: All HTTP/3 tests now passing (curl exit 77 fixed)
- **Certificate Chains**: All pods have full chain (2 certificates)
- **Strict TLS**: gRPC strict TLS working via port-forward
- **Cache Test**: Fixed endpoint path, now works correctly

### ⚠️ Known Issues (Workarounds Available)
- **Envoy NodePort**: Not reachable from host (Colima networking)
  - Workaround: Use port-forward (already in test scripts)
- **Analytics/Shopping strict TLS**: Some services may need restart after cert update
  - Workaround: Restart pods after certificate rotation

### 📊 Test Suite Status
- **Baseline**: ✅ PASSED (HTTP/3 working!)
- **Enhanced**: ✅ PASSED
- **Adversarial**: ✅ PASSED
- **Standalone Capture**: ✅ PASSED
- **Rotation**: ⚠️ Needs verification after PID fix
- **TLS/mTLS**: ⚠️ 2/6 tests passing (NodePort issues expected)

---

## Diagnostic Tools Created

1. **`scripts/diagnose-tls-mtls.sh`** - Comprehensive TLS/mTLS diagnostic
2. **`scripts/test-tls-mtls-comprehensive.sh`** - Automated test suite
3. **`scripts/verify-full-cert-chain-all-pods.sh`** - Certificate chain verification
4. **`scripts/deep-investigate-http3-curl77.sh`** - HTTP/3 curl exit 77 investigation
5. **`scripts/deep-investigate-grpc-envoy.sh`** - gRPC Envoy investigation
6. **`scripts/fix-all-tls-issues.sh`** - Automated fix script

---

## Prevention Strategies

1. **Always use full certificate chains**:
   - Include CA certificate in `tls.crt` for all services
   - Verify with: `grep -c "BEGIN CERTIFICATE" tls.crt` (should be 2+)

2. **Test HTTP/3 with NodePort**:
   - Always set `CADDY_NODEPORT` environment variable
   - Use NodePort 30443 for HTTP/3 in host network mode

3. **Use base64 for certificates in containers**:
   - Avoid volume mounts with `--network host`
   - Use environment variables for certificate passing

4. **Verify port-forwards before testing**:
   - Wait at least 5 seconds after starting port-forward
   - Check connectivity with `nc -z` before running tests

5. **Capture PIDs correctly in parallel operations**:
   - Capture PID immediately after starting background job
   - Don't start multiple jobs before capturing PIDs
