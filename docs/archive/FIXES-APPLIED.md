# Fixes Applied - Step by Step

## 1. ✅ Fixed: Listings Service Redis AUTH Issue

### Problem:
- Redis client was trying to authenticate even when no password was configured
- Error: `ERR AUTH <password> called without any password configured`
- This was causing service degradation and potential 503 errors

### Fix Applied:
**File**: `services/listings-service/src/lib/redis-cache.ts`

Changed Redis client configuration to explicitly set `password: undefined` when no password is provided. This prevents the redis client library from automatically sending AUTH commands.

```typescript
// Before:
redisClient = createClient({ url: REDIS_URL }) as RedisClientType;

// After:
const clientConfig: any = { url: REDIS_URL };
if (!REDIS_PASSWORD) {
  clientConfig.password = undefined;
}
redisClient = createClient(clientConfig) as RedisClientType;
```

### Next Step:
- [ ] Rebuild listings-service Docker image
- [ ] Restart listings-service pod
- [ ] Verify Redis errors are gone from logs

---

## 2. 🔍 Investigating: gRPC Health Check Issues

### Problem:
- All gRPC health checks failing through Envoy
- Error: `proto: message field "grpc.health.v1.HealthCheckResponse.details" is an invalid map`
- Alternative error: `could not parse given files: proto/auth.proto:5:8: open health.proto: no such file or directory`

### Root Causes Identified:

1. **Proto Import Path Issue**:
   - `auth.proto` imports `health.proto` (line 5: `import "health.proto";`)
   - grpcurl needs correct import path to find health.proto
   - The `grpc_test` function already sets `PROTO_DIR` but may need absolute path

2. **Envoy TLS Configuration**:
   - Envoy config shows TLS enabled for upstream services
   - Services may not have TLS enabled for gRPC
   - Error: `upstream connect error or disconnect/reset before headers`

### Investigation Needed:
- [ ] Verify services are listening on gRPC ports (50051-50060)
- [ ] Check if services have TLS enabled for gRPC
- [ ] Test direct service access (bypassing Envoy)
- [ ] Verify Envoy can connect to services without TLS
- [ ] Check if Envoy TLS config should be disabled or services should enable TLS

### Potential Fixes:
1. **Option A**: Disable TLS in Envoy upstream config (if services don't use TLS)
2. **Option B**: Enable TLS in all services (more secure, more work)
3. **Option C**: Use plaintext gRPC for internal communication (simpler)

---

## 3. 🔍 Investigating: Packet Capture Issues

### Problem:
- All `.pcap` files are 0 bytes
- tcpdump installed in pods but captures aren't working

### Root Causes:
1. **Process Management**: tcpdump PID not tracked correctly
2. **File Timing**: Captures stopped before requests complete
3. **File Location**: Files in `/tmp` in pod, may not copy out properly

### Investigation Needed:
- [ ] Check if tcpdump is actually running when requests are made
- [ ] Verify tcpdump process persists long enough
- [ ] Test file copying from pod to host
- [ ] Check if capture filters are correct (port 443, UDP 443 for QUIC)

### Potential Fix:
- Improve PID tracking in `start_test_capture` and `stop_test_capture`
- Add delay after stopping tcpdump before copying files
- Verify nohup is working correctly for background tcpdump

---

## 4. ✅ Fixed: Rotation Suite ENVOY_POD Variable

### Problem:
- Script failing with: `ENVOY_POD: unbound variable`

### Fix Applied:
**File**: `scripts/rotation-suite.sh`

Added proper initialization of `ENVOY_POD` and `ENVOY_NS` variables before use.

---

## Next Steps:

1. **Rebuild listings-service** with Redis fix
2. **Investigate gRPC TLS mismatch** between Envoy and services
3. **Fix packet capture** process management
4. **Re-run tests** after fixes
5. **Fix adversarial test issues** (connection flood, service recovery)
