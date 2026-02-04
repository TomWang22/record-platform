# Issues Found During Test Execution

## 1. gRPC Health Check Issues ❌

### Problem:
- All gRPC health checks failing in smoke tests
- Error: `proto: message field "grpc.health.v1.HealthCheckResponse.details" is an invalid map`
- Envoy pod exists but grpcurl can't route correctly

### Root Causes:
1. **Proto file issue**: The health.proto might have version mismatch or incorrect definition
2. **Envoy routing**: Service selector matches (`app=envoy-test`) but routing config may be wrong
3. **grpcurl flags**: May need proper TLS/certificate flags for Envoy

### Fixes Needed:
- [ ] Verify health.proto file is correct and matches grpc/health/v1 spec
- [ ] Test grpcurl with proper service discovery (may need Host header)
- [ ] Check Envoy configmap for correct gRPC routing rules
- [ ] Verify Envoy is listening on correct ports (10000 for service, 30000 for NodePort)

## 2. HTTP 503 on Listings Service ❌

### Problem:
- Test 12b: Create Listing via HTTP/3 returns HTTP 503
- Service is running (1/1 Ready) but requests fail

### Root Causes:
1. **Redis auth errors**: Service trying to authenticate but Redis has no password
   - Error: `ERR AUTH <password> called without any password configured`
   - Redis URL: `redis://host.docker.internal:6379/0`
   - No Redis service in K8s (using external Docker)

### Fixes Needed:
- [ ] Update listings-service Redis client to not send AUTH when no password is configured
- [ ] Or configure Redis with password to match service expectations
- [ ] Check if this causes service degradation (503 errors)

## 3. Packet Capture Issues ❌

### Problem:
- All `.pcap` files are 0 bytes
- tcpdump installed in pods but captures aren't working

### Root Causes:
1. **Process management**: tcpdump PID not being tracked correctly
2. **File timing**: Captures stopped before requests complete
3. **File location**: Files may be in /tmp in pod but not copied out properly

### Fixes Needed:
- [ ] Fix tcpdump process management in `start_test_capture` and `stop_test_capture`
- [ ] Ensure capture runs long enough to capture traffic
- [ ] Verify file copying from pod to host works correctly
- [ ] Add delay after stopping tcpdump before copying files

## 4. Adversarial Test Issues ⚠️

### Problems:
1. **Connection Flood**: 0/20 successful requests
   - May be rate limiting or connection pooling issues
2. **Service Recovery**: Test failing after error condition
   - May indicate service doesn't recover gracefully

### Fixes Needed:
- [ ] Investigate why connection flood fails (may be intentional rate limiting)
- [ ] Check service recovery logic after errors
- [ ] Verify service health after error scenarios

## 5. Rotation Suite Bug ❌

### Problem:
- Script failing with: `ENVOY_POD: unbound variable`
- Fixed in rotation-suite.sh line ~300

### Status:
- ✅ **FIXED** - Variable initialization added before use

## 6. Envoy Pod Label Mismatch ✅

### Problem:
- Script was looking for `app=envoy` but pod has `app=envoy-test`
- Service selector correctly uses `app=envoy-test`

### Status:
- ✅ **FIXED** - rotation-suite.sh updated to use `app=envoy-test`

## Next Steps:

1. **Fix rotation suite ENVOY_POD variable** ✅ DONE
2. **Investigate gRPC health check proto issue** - Test direct service health check
3. **Fix listings-service Redis auth** - Remove AUTH call or configure Redis password
4. **Fix packet capture** - Improve tcpdump process management
5. **Re-run tests** after fixes
