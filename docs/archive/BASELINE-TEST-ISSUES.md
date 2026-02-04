# Baseline Test Issues - Analysis

**Date:** 2026-01-22  
**Status:** Test ran but several issues identified

## Issues Found

### 1. HTTP/3 Tests Failing (curl exit 1) ❌
- **All HTTP/3 tests failing** with `curl exit 1`
- **Root cause**: `http3_curl` function (from `scripts/lib/http3.sh`) is failing
- **Possible causes**:
  - Docker not running or not accessible
  - HTTP/3 image (`alpine/curl-http3:latest`) not available
  - Kind node detection failing
  - Network namespace access issues

### 2. CA Certificate Not Found ⚠️
- **Strict TLS not working** - using insecure `-k` flag
- **Root cause**: Kubernetes secrets `dev-root-ca` not found in either namespace
- **Impact**: Tests running with insecure TLS (dev only)

### 3. API Server Not Ready ⚠️
- **API server check failed** after 30 attempts
- **Impact**: Some kubectl commands may fail, but test continued

### 4. Services Not Deployed ⚠️
- **social-service**: Not deployed (tests skipped)
- **listings-service**: Not deployed (tests skipped)
- **Impact**: Many tests skipped, but core tests (auth, records, shopping) ran

### 5. gRPC Tests Skipped ⚠️
- **grpcurl not installed** - gRPC tests skipped
- **Impact**: No gRPC verification, but not critical for baseline

## Tests That Passed ✅

- ✅ Auth registration (HTTP/2)
- ✅ Auth login (HTTP/3) - but HTTP/3 curl failing
- ✅ Records create (HTTP/2)
- ✅ Shopping cart operations (HTTP/2)
- ✅ Auth logout (HTTP/2)
- ✅ Auth delete account (HTTP/2)

## Next Steps

1. **Fix HTTP/3 curl**: Check Docker, pull HTTP/3 image, verify node detection
2. **Fix CA certificate**: Create or locate dev-root-ca secret
3. **Deploy missing services**: social-service, listings-service
4. **Re-run baseline test** once fixes applied

**Status: Test completed but with issues - need to fix HTTP/3 and CA cert**
