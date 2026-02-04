# Test Failures Root Cause Analysis (RCA)

## Executive Summary

All test failures stem from **strict TLS and client certificate verification** requirements for production. The system was previously configured for development mode (no client cert verification), but production requires mutual TLS (mTLS).

## Failure Categories

### 1. HTTP/3 Certificate Verification Failure (curl error 77)
**Error**: `curl: (77) error setting certificate verify locations: CAfile: /tmp/http3-ca.pem CApath: /etc/ssl/certs`

**Root Cause**:
- HTTP/3 tests run in Docker containers via `http3.sh`
- CA certificate is mounted from host to container at `/tmp/http3-ca.pem`
- Mount may fail or file may not exist when curl runs
- Container's curl cannot find the CA cert file

**Impact**: All HTTP/3 tests fail

**Fix Required**:
- Ensure CA cert is extracted and mounted correctly
- Verify file exists before curl execution
- Add fallback to insecure mode for debugging (dev only)

---

### 2. Social Service "Upstream Error" (HTTP 502)
**Error**: `{"error":"social upstream error"}`

**Root Cause**:
- API gateway cannot reach social-service
- Previously caused by pod not Ready (gRPC health probe failing)
- Now resolved - pod is 1/1 Ready
- May still fail if gRPC health probe times out with client cert verification enabled

**Impact**: All social-service API calls fail

**Fix Required**:
- Verify API gateway can reach social-service
- Check if client cert verification is blocking connections
- Update health probes to work with mTLS

---

### 3. Social Service gRPC Connection Refused (HTTP 503)
**Error**: `Error: connect ECONNREFUSED 10.43.44.110:50056`

**Root Cause**:
- IP `10.43.44.110` doesn't match any service in cluster
- Social-service ClusterIP is `10.96.220.132`
- This is a stale DNS/service discovery reference
- Likely from old deployment or misconfigured gRPC client

**Impact**: Social-service gRPC calls fail

**Fix Required**:
- Find where `10.43.44.110` is configured
- Update to use correct service name or ClusterIP
- Verify gRPC client configuration

---

### 4. Envoy gRPC Routing Timeout
**Error**: `Failed to dial target host "127.0.0.1:30000": context deadline exceeded`

**Root Cause**:
- Envoy accepts connections on port 30000
- But gRPC routing test times out
- May be TLS handshake failure
- Or service discovery issue

**Impact**: gRPC routing through Envoy fails

**Fix Required**:
- Verify Envoy TLS configuration matches service certificates
- Check Envoy upstream cluster configuration
- Test gRPC routing with client certificates

---

### 5. gRPC Port-Forward Failures
**Error**: `ERROR: Port-forward failed to establish connection to 50147:50051`

**Root Cause**:
- Port-forward is failing for auth and records services
- May be related to service not being ready
- Or network connectivity issue
- Or TLS handshake failure with client certs

**Impact**: Direct gRPC testing via port-forward fails

**Fix Required**:
- Verify services are Ready before port-forward
- Check if client cert verification is blocking
- Update port-forward to include client certificates

---

### 6. Client Certificate Verification Not Enabled
**Current State**:
- All services have `GRPC_REQUIRE_CLIENT_CERT=false` in deployments
- gRPC servers check for CA cert and enable verification if `GRPC_REQUIRE_CLIENT_CERT=true`
- Health probes use client certs but server doesn't verify them

**Production Requirement**:
- **MUST** enable client certificate verification for all gRPC services
- This is a security requirement for production

**Impact**: System is not production-ready

**Fix Required**:
- Set `GRPC_REQUIRE_CLIENT_CERT=true` in all service deployments
- Update health probes to work with strict mTLS
- Test all gRPC connections with client cert verification enabled

---

## Fix Priority

1. **CRITICAL**: Enable client certificate verification (production requirement)
2. **HIGH**: Fix HTTP/3 certificate mounting
3. **HIGH**: Fix social-service gRPC connection (10.43.44.110)
4. **MEDIUM**: Fix Envoy gRPC routing
5. **MEDIUM**: Fix gRPC port-forward
6. **LOW**: Update documentation

---

## Implementation Plan

### Phase 1: Enable Strict TLS (Client Cert Verification)
1. Update all service deployments to set `GRPC_REQUIRE_CLIENT_CERT=true`
2. Update health probes to use correct client certificates
3. Test each service individually
4. Verify all gRPC connections work with mTLS

### Phase 2: Fix HTTP/3 Certificate Issues
1. Fix `http3.sh` to ensure CA cert is properly mounted
2. Add verification that file exists before curl
3. Test HTTP/3 health checks

### Phase 3: Fix Service-Specific Issues
1. Find and fix `10.43.44.110` reference in social-service
2. Fix Envoy gRPC routing configuration
3. Fix port-forward to work with client certs

### Phase 4: Testing and Documentation
1. Run all test suites
2. Verify all tests pass
3. Update Runbook.md with fixes and procedures

---

## Files to Modify

1. **Service Deployments** (`infra/k8s/base/*/deploy.yaml`):
   - Set `GRPC_REQUIRE_CLIENT_CERT=true`
   - Update health probe configurations

2. **HTTP/3 Helper** (`scripts/lib/http3.sh`):
   - Fix CA cert mounting
   - Add file existence checks

3. **gRPC Clients** (if any hardcoded IPs):
   - Find `10.43.44.110` reference
   - Update to use service names

4. **Envoy Config** (`infra/k8s/base/envoy-test/envoy.yaml`):
   - Verify TLS configuration
   - Check upstream cluster settings

5. **Test Scripts**:
   - Update to work with client cert verification
   - Fix port-forward commands

6. **Runbook.md**:
   - Document all fixes
   - Add troubleshooting procedures
