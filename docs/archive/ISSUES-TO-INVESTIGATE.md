# Issues to Investigate

## 1. Rotation Suite: Caddy Deployment Timeout ⚠️
**Problem**: Rotation suite timed out waiting for Caddy deployment rollout
**Error**: `error: timed out waiting for the condition`
**Status**: Caddy pods may be stuck during rolling update

**Investigation Needed**:
- Check why Caddy pods are not becoming ready during rollout
- Check if ConfigMap/Secret issues blocking pod startup
- Verify Caddy health probes are working
- Check pod events for errors

## 2. Packet Capture: Empty Files ⚠️
**Problem**: Enhanced test shows empty packet capture files
**Error**: `⚠️ Caddy capture file is empty or missing`
**Status**: Despite fixes, packet capture still not working

**Investigation Needed**:
- Verify tcpdump is actually running in pods
- Check if tcpdump has proper permissions
- Verify PID tracking is working correctly
- Check if files are being copied om pods
- Test tcpdump manually in a pod

## 3. gRPC Routing via Envoy ⚠️
**Problem**: Most gRPC calls failing via Envoy NodePort
**Error**: `gRPC routing issue - Envoy NodePort gRPC routing needs investigation`
**Status**: Only auth service HealthCheck works, others fail

**Investigation Needed**:
- Verify Envoy routing configuration for all services
- Check if services are properly registered in Envoy
- Test direct service access vs via Envoy
- Verify gRPC service names match Envoy routes
- Check Envoy logs for routing errors

## 4. Database Foreign Key Issues ⚠️
**Problem**: Users not found in records database (port 5433)
**Error**: `User 1 NOT found in auth.users (port 5433) - may cause foreign key issues`
**Status**: Users exist in auth DB (port 5437) but not in records DB

**Investigation Needed**:
- Verify if users should exist in both databases
- Check records-service user creation logic
- Verify foreign key relationships
- Check if this is expected behavior

## Priority Order
1. **Packet Ca- Critical for protocol verification
2. **gRPC Routing** - Affects service communication
3. **Rotation Suite Timeout** - Blocks certificate rotation testing
4. **Database Foreign Keys** - May cause data integrity issues
