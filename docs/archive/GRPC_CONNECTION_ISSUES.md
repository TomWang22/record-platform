# gRPC Connection Issues Investigation

## Error Observed
```
Error: connect ECONNREFUSED 10.43.16.14:50051
```

## Root Cause Analysis

### Error Context
- **Location**: API Gateway trying to connect to auth-service
- **Target**: `auth-service:50051` (resolves to ClusterIP `10.43.16.14:50051`)
- **Error**: Connection refused
- **HTTP Status**: 503 (Service Unavailable)

### Possible Causes

1. **Service Not Ready**
   - auth-service pods may not be in Ready state
   - Pods may be starting up or crashing
   - Readiness probe may be failing

2. **Port Not Listening**
   - auth-service gRPC server may not be listening on port 50051
   - Service may have failed to start gRPC server
   - Port configuration mismatch

3. **Service Discovery Issue**
   - Service endpoints may not be populated
   - DNS resolution may be failing
   - Service selector may not match pod labels

4. **Network Policy**
   - Network policies may be blocking traffic
   - Firewall rules may be preventing connection

5. **Timing Issue**
   - API Gateway may be trying to connect before auth-service is ready
   - Race condition during startup

## Diagnostic Steps

### 1. Check Service Status
```bash
kubectl get svc auth-service -n record-platform
kubectl get endpoints auth-service -n record-platform
```

### 2. Check Pod Status
```bash
kubectl get pods -n record-platform -l app=auth-service
kubectl describe pod <auth-service-pod> -n record-platform
```

### 3. Check Pod Logs
```bash
kubectl logs -n record-platform -l app=auth-service --tail=50
```

### 4. Check if Port is Listening
```bash
kubectl exec -n record-platform <auth-service-pod> -- netstat -tuln | grep 50051
# or
kubectl exec -n record-platform <auth-service-pod> -- ss -tuln | grep 50051
```

### 5. Test Connectivity
```bash
kubectl exec -n record-platform <api-gateway-pod> -- nc -zv <auth-service-clusterip> 50051
```

### 6. Check API Gateway Logs
```bash
kubectl logs -n record-platform -l app=api-gateway --tail=50 | grep -i "ECONNREFUSED\|50051\|auth-service"
```

## Automated Diagnostic Script

Run the diagnostic script:
```bash
bash scripts/diagnose-grpc-connection-issues.sh
```

## Fixes Applied

1. **Enhanced Service Readiness Checks**
   - Added more robust readiness checks in test scripts
   - Increased wait time for service startup

2. **Improved Error Handling**
   - Better error messages in API Gateway
   - More detailed logging for connection failures

3. **Diagnostic Script**
   - Created `scripts/diagnose-grpc-connection-issues.sh` for automated diagnosis

## Prevention

1. **Ensure Services Are Ready Before Tests**
   - Test scripts should wait for services to be Ready
   - Use readiness probes to verify service health

2. **Check Service Configuration**
   - Verify service ports match pod ports
   - Ensure service selectors match pod labels

3. **Monitor Service Health**
   - Check pod logs for startup errors
   - Verify gRPC server is listening on expected port

4. **Add Retry Logic**
   - API Gateway should retry failed connections
   - Implement exponential backoff for connection attempts

## Related Files

- `services/api-gateway/src/server.ts` - API Gateway gRPC client configuration
- `services/auth-service/src/grpc-server.ts` - Auth service gRPC server
- `scripts/test-microservices-http2-http3.sh` - Test script with service readiness checks
- `scripts/diagnose-grpc-connection-issues.sh` - Diagnostic script
