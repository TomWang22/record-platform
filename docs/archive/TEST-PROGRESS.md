# Test Progress

## ✅ Completed

### Baseline Smoke Test
**Status**: ✅ Completed
**Results**:
- HTTP/2 and HTTP/3 tests executed
- Some gRPC routing issues noted (expected - routing through Envoy)
- Database verification completed
- Packet captures saved to `/tmp/tls-captures-20260121-175640`

**Findings**:
- Some gRPC health checks failed via Envoy NodePort (direct port-forward may work)
- Database verification shows users in auth DB (port 5437)
- Foreign key relationships need attention (users not in records DB port 5433)

## 🔄 In Progress

### Enhanced Smoke Test
**Status**: 🔄 Running
**Script**: `scripts/test-microservices-http2-http3-enhanced.sh`
**Includes**:
- Wire-level packet capture (tcpdump)
- Protocol verification (tshark analysis)
- **8 Adversarial Tests**:
  1. Invalid certificate handling
  2. Protocol downgrade prevention
  3. Certificate rotation recovery
  4. Connection flood protection
  5. Malformed request handling
  6. Service recovery after error
  7. TLS version downgrade prevention
  8. HTTP/3 to HTTP/2 fallback
- Database verification checks
- Comprehensive protocol analysis

**Log**: `/tmp/enhanced-smoke-test-*.log`

## ⏳ Pending

### Rotation Suite
**Status**: ⏳ Pending
**Script**: `scripts/rotation-suite.sh`
**Will include**:
- CA certificate rotation
- Leaf certificate rotation
- Wire-level packet capture during rotation
- Protocol verification during rotation
- Adaptive limit finding (H2=130, H3=65 start, 30 iterations)
- Zero-downtime verification

## Fixes Being Verified

1. ✅ **Redis AUTH fix** - listings-service should not have HTTP 503 errors
2. ✅ **Proto path resolution** - gRPC tests should work better
3. 🔄 **Packet capture** - Should produce non-empty .pcap files (being tested now)
4. ⏳ **Rotation suite bug** - Should run without ENVOY_POD errors (will test)
