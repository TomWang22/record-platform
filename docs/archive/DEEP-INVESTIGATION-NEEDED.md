# Deep Investigation Needed

## Critical Issues Found

### 1. Packet Capture Not Working 🔴
**Status**: All .pcap files are 0 bytes
**Root Cause**: tcpdump is likely not capturing packets properly

**Possible Causes**:
- tcpdump needs root privileges (may not work in non-root containers)
- Network interface permissions issue
- tcpdump process starting but immediately dying
- File permissions preventing write
- Background process not persisting

**Investigation Steps**:
1. Test tcpdump manually in pod with root privileges
2. Check if Caddy pods run as root or non-root user
3. Verify network interface permissions
4. Check tcpdump logs for errors
5. Try alternative capture method (tshark, or host-level capture)

### 2. gRPC Routing Issues ⚠️
**Status**: Envoy accessible, but most gRPC calls fail
**Working**: auth.AuthService HealthCheck
**Failing**: All other services' gRPC calls

**Possible Causes**:
- Envoy route configuration incomplete
- Service name mismatches in routes
- TLS/upstream connection issues
- Proto path issues (already fixed, but may need verification)

**Investigation Steps**:
1. Check Envoy ConfigMap/configuration
2. Verify all service routes are defined
3. Test direct service access vs via Envoy
4. Check Envoy logs for routing errors
5. Verify service names match proto package names

### 3. Rotation Suite Timeout ⚠️
**Status**: Timed out, but pods eventually became ready
**Cause**: Likely slow pod startup or health probe delays

**Investigation Steps**:
1. Increase timeout in rotation suite script
2. Check Caddy health probe timing
3. Verify readiness probe configuration
4. Consider using `kubectl wait` with longer timeout

### 4. Database Foreign Keys ⚠️
**Status**: Users in auth DB but not in records DB
**Question**: Is this expected behavior?

**Investigation Steps**:
1. Check records-service code for user creation logic
2. Verify if users should be replicated to records DB
3. Check foreign key constraint definitions
4. Review database schema design

## Priority Actions

1. **Fix packet capture** (Critical for protocol verification)
   - Test tcpdump with proper privileges
   - Consider alternative capture methods
   - Fix root cause of empty files

2. **Fix gRPC routing** (High priority)
   - Complete Envoy route configuration
   - Verify all services are registered
   - Test and fix routing issues

3. **Improve rotation suite** (Medium priority)
   - Add better timeout handling
   - Improve health check waiting

4. **Clarify database design** (Low priority)
   - Document expected behavior
   - Fix if this is a bug
