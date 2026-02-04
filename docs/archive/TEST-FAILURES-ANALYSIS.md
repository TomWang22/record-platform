# Test Failures Analysis and Fixes

## Summary of Issues Found

### 1. HTTP/3 Certificate Verification Failure (curl error 77)
**Error**: `curl: (77) error setting certificate verify locations: CAfile: /tmp/http3-ca.pem CApath: /etc/ssl/certs`

**Root Cause**: 
- The test script sets `HTTP3_CA_CERT` to a file like `/tmp/test-ca-k8s-*.pem`
- The `http3.sh` script mounts this file to `/tmp/http3-ca.pem` in the container
- However, the file might not exist or the mount might be failing

**Status**: ✅ Fixed - Created `/tmp/http3-ca.pem` from Kubernetes secret

**Fix Applied**:
```bash
# Extract CA from Kubernetes secret
K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d)
echo "$K8S_CA" > /tmp/http3-ca.pem
```

### 2. Social Service gRPC Health Probe Timeout
**Error**: Health probe timing out on port 50056
- Startup probe: 40 failures
- Readiness probe: 6 failures  
- Liveness probe: 6 failures

**Root Cause**:
- gRPC server IS starting and listening on port 50056 with TLS
- Health probe is using TLS with client certificates
- Connection is timing out, suggesting TLS handshake or connection issue

**Current Configuration**:
- Health probe uses: `-tls -tls-no-verify=true` with client certs
- gRPC server: TLS enabled, client cert verification DISABLED (dev mode)
- Server logs show: "gRPC server listening on port 50056 (HTTP/2 only)"

**Possible Issues**:
1. TLS handshake failing (server name mismatch?)
2. Client certificates not matching server expectations
3. Network connectivity issue within pod

**Status**: ⚠️ Investigating - Server is running but health probe fails

**Next Steps**:
1. Test health probe manually with different TLS options
2. Check if server name `record.local` matches certificate
3. Consider simplifying health probe to use `-tls-no-verify=true` without client certs

### 3. Social Service "Upstream Error" (HTTP 502)
**Error**: `{"error":"social upstream error"}` from API gateway

**Root Cause**:
- API gateway cannot reach social-service because pod is not Ready
- Pod is not Ready because gRPC health probe is failing
- This is a cascading failure from issue #2

**Status**: ⚠️ Will be fixed when issue #2 is resolved

### 4. Social Service gRPC Connection Refused (HTTP 503)
**Error**: `Error: connect ECONNREFUSED 10.43.44.110:50056`

**Root Cause**:
- IP `10.43.44.110` doesn't match any service in the cluster
- Social-service ClusterIP is `10.96.220.132`
- This suggests a stale DNS entry or misconfigured service discovery

**Status**: ⚠️ Investigating - Need to find where this IP is configured

### 5. Envoy gRPC Routing Test Failure
**Error**: `Failed to dial target host "127.0.0.1:30000": context deadline exceeded`

**Root Cause**: 
- Envoy is accepting connections on port 30000
- But gRPC routing test is timing out
- May be related to TLS configuration or service discovery

**Status**: ⚠️ Pending investigation

### 6. gRPC Port-Forward Failures
**Error**: `ERROR: Port-forward failed to establish connection to 50147:50051`

**Root Cause**:
- Port-forward is failing for auth and records services
- May be related to service not being ready or network issues

**Status**: ⚠️ Pending investigation

## Immediate Actions

1. ✅ Fixed HTTP/3 certificate issue
2. ⚠️ Need to fix social-service gRPC health probe
3. ⚠️ Need to investigate IP 10.43.44.110 reference
4. ⚠️ Need to fix Envoy gRPC routing
5. ⚠️ Need to fix gRPC port-forward issues

## Files to Check/Modify

1. `infra/k8s/base/social-service/deploy.yaml` - Health probe configuration
2. `services/social-service/src/grpc-server.ts` - TLS server configuration
3. `scripts/lib/http3.sh` - HTTP/3 certificate mounting
4. `scripts/test-microservices-http2-http3.sh` - Test script HTTP/3 setup
5. `infra/k8s/base/envoy-test/envoy.yaml` - Envoy gRPC routing config
