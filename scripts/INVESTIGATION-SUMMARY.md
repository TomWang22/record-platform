# Investigation Summary: gRPC NodePort and Messaging Service Issues

## Issues Found

### 1. gRPC NodePort Configuration
- **NodePort 30000**: ✅ Configured (maps to service port 10000)
- **NodePort 30001**: ⚠️ Not configured (only 30000 available)
- **Issue**: Tests try both ports, but only 30000 is available
- **Envoy TLS**: Envoy uses strict TLS to backends, so plaintext grpcurl will fail
- **Solution**: Use TLS with CA certificate for gRPC calls via NodePort

### 2. Messaging Service Issues

#### Target Port Mismatch
- **Current**: `targetPort: http` (named port)
- **Expected**: `targetPort: 4006` (numeric port)
- **Impact**: Service may not route correctly
- **Fix**: Run `./scripts/fix-messaging-service-targetport.sh`

#### Port Not Listening
- **Issue**: Port 4006 not listening in pod
- **Possible Causes**:
  - Service not started properly
  - Port binding issue
  - Container health check failing

#### Database Connection Failed
- **Issue**: messaging-plane cannot connect to database
- **Possible Causes**:
  - `POSTGRES_URL_SOCIAL` environment variable not set
  - Database not accessible from pod
  - Network policy blocking traffic

#### Kafka Certificate Issue
- **Error**: `Hostname/IP does not match certificate's altnames: IP: 192.168.5.1 is not in the cert's list: 127.0.0.1`
- **Impact**: Kafka publish fails (non-fatal, but indicates certificate mismatch)
- **Solution**: Update Kafka certificate SANs to include pod IP ranges

### 3. API Gateway to Messaging Service Connectivity
- **Issue**: API Gateway cannot reach messaging-service:4006
- **Possible Causes**:
  - Service selector mismatch
  - Target port issue (http vs 4006)
  - Network policy blocking

## Recommended Fixes

### Immediate Fixes

1. **Fix Messaging Service targetPort**:
   ```bash
   ./scripts/fix-messaging-service-targetport.sh
   ```

2. **Verify Messaging Service is listening**:
   ```bash
   kubectl exec -n record-platform <social-pod> -- netstat -ln | grep 4006
   ```

3. **Check Messaging Service environment**:
   ```bash
   kubectl exec -n record-platform <social-pod> -- env | grep POSTGRES_URL_SOCIAL
   ```

4. **Fix gRPC NodePort tests**:
   - Use port 30000 only (not 30001)
   - Use TLS with CA certificate for grpcurl calls

### Long-term Fixes

1. **Add NodePort 30001** to Envoy service (if needed)
2. **Fix Kafka certificate SANs** to include pod IP ranges
3. **Verify database connectivity** from messaging-service pod
4. **Update service definitions** to use numeric ports instead of named ports

## Test Results Location

All investigation results are saved to:
- `/tmp/grpc-social-investigation-<timestamp>.log`
- `test-results/<timestamp>-preflight-and-tests/investigation.log`
