# Wire-Level Protocol Verification Suite

Complete end-to-end verification of protocols (HTTP/2, HTTP/3, gRPC, TLS 1.3) at wire level using packet capture and protocol analysis.

## Overview

This suite provides comprehensive wire-level verification of all protocols used in the record-platform:
- **HTTP/2**: Verifies ALPN negotiation and HTTP/2 frames
- **HTTP/3**: Verifies QUIC handshake and HTTP/3 frames
- **gRPC**: Verifies HTTP/2 framing and protobuf encoding
- **TLS 1.3**: Verifies TLS version and certificate chain validation

## Components

### 1. Orchestration Script
**File**: `scripts/run-complete-wire-verification-suite.sh`

Runs the complete verification workflow:
1. Baseline E2E test
2. Wire-level verification E2E test
3. Build custom k6 with xk6 HTTP/3 extension
4. Limit test with wire verification
5. Rotation suite with wire-level verification

**Usage**:
```bash
# Run complete suite
./scripts/run-complete-wire-verification-suite.sh

# Skip specific steps
SKIP_BASELINE=true SKIP_WIRE=true ./scripts/run-complete-wire-verification-suite.sh
```

### 2. Baseline E2E Test
**File**: `scripts/test-microservices-http2-http3.sh`

Comprehensive E2E test with packet capture:
- Tests all microservices via HTTP/2 and HTTP/3
- Captures packets on Caddy and Envoy pods
- Verifies gRPC routing (fixed Envoy ports 30000/30001)
- Includes adversarial tests (protocol downgrade, invalid certs)

**Usage**:
```bash
./scripts/test-microservices-http2-http3.sh
```

### 3. Wire-Level Verification E2E Test
**File**: `scripts/test-e2e-wire-verification.sh`

Deep wire-level protocol verification:
- Packet capture on all ingress and service pods (tcpdump)
- Protocol analysis using tshark (HTTP/2, HTTP/3, gRPC, TLS 1.3)
- Adversarial testing (protocol downgrade, malformed gRPC)
- Automatic protocol verification reports

**Usage**:
```bash
./scripts/test-e2e-wire-verification.sh
```

**Features**:
- Verifies HTTP/2 ALPN negotiation
- Verifies HTTP/3 (QUIC) handshake
- Verifies gRPC HTTP/2 framing
- Verifies TLS 1.3 usage
- Tests protocol downgrade prevention
- Tests malformed request handling

### 4. Custom k6 Build
**File**: `scripts/build-k6-http3.sh`

Builds custom k6 binary with xk6 HTTP/3 extension:
- Uses xk6 with quic-go library
- Builds binary at `.k6-build/bin/k6-http3`
- Supports native HTTP/3 (QUIC) testing

**Usage**:
```bash
./scripts/build-k6-http3.sh
```

**Output**:
- Binary: `.k6-build/bin/k6-http3`
- Build log: `.k6-build/build.log`

### 5. Limit Test with Wire Verification
**File**: `scripts/load/k6-limit-test-wire-verification.js`

k6 limit testing with protocol verification:
- HTTP/2 and HTTP/3 testing with explicit protocol requirements
- Strict TLS 1.3 enforcement
- Protocol verification metrics
- Packet capture integration

**Usage**:
```bash
# With standard k6 (may not have HTTP/3)
k6 run scripts/load/k6-limit-test-wire-verification.js

# With custom k6-http3
.k6-build/bin/k6-http3 run scripts/load/k6-limit-test-wire-verification.js

# With packet capture
ENABLE_PACKET_CAPTURE=true k6 run scripts/load/k6-limit-test-wire-verification.js
```

**Configuration**:
- `H2_RATE`: HTTP/2 request rate (default: 80 req/s)
- `H3_RATE`: HTTP/3 request rate (default: 40 req/s)
- `DURATION`: Test duration (default: 180s)
- `ENABLE_PROTOCOL_VERIFICATION`: Enable protocol checks (default: true)
- `ENABLE_PACKET_CAPTURE`: Enable packet capture (default: false)

### 6. Complete k6 HTTP/3 Toolchain
**File**: `scripts/load/k6-http3-complete.js`

Full k6 HTTP/3 implementation with xk6 extension:
- Native HTTP/3 support via xk6 extension
- Automatic extension loading and fallback
- Packet capture integration
- Protocol verification and reporting

**Usage**:
```bash
# Requires custom k6-http3 binary
.k6-build/bin/k6-http3 run scripts/load/k6-http3-complete.js
```

### 7. Rotation Suite with Wire Verification
**File**: `scripts/rotation-suite.sh`

Certificate rotation with wire-level verification:
- Captures packets during CA/leaf rotation
- Verifies protocols remain correct during rotation
- Confirms TLS 1.3 usage throughout rotation
- Analyzes captures automatically if tshark available

**Usage**:
```bash
# Enable wire verification
WIRE_VERIFY=true ./scripts/rotation-suite.sh

# With CA and leaf rotation
ROTATE_CA=true ROTATE_LEAF=true WIRE_VERIFY=true ./scripts/rotation-suite.sh
```

## Workflow

### Complete Verification Workflow

1. **Baseline E2E Test**
   - Tests all services via HTTP/2 and HTTP/3
   - Captures packets on Caddy and Envoy
   - Verifies gRPC routing

2. **Wire-Level Verification E2E Test**
   - Deep protocol analysis using tcpdump/tshark
   - Verifies protocols at wire level
   - Adversarial testing

3. **Build Custom k6**
   - Builds k6 with xk6 HTTP/3 extension
   - Verifies binary works correctly

4. **Limit Test with Wire Verification**
   - Runs limit tests with protocol verification
   - Captures packets during tests
   - Verifies protocols are used correctly

5. **Rotation Suite with Wire Verification**
   - Rotates certificates with wire-level capture
   - Verifies zero-downtime rotation at wire level
   - Confirms protocols remain correct during rotation

## Protocol Verification

### HTTP/2 Verification
```bash
# Verify ALPN negotiation
tshark -r capture.pcap -Y "tls.handshake.extensions_alpn_str contains h2"

# Verify HTTP/2 frames
tshark -r capture.pcap -Y "http2"
```

### HTTP/3 (QUIC) Verification
```bash
# Verify QUIC handshake
tshark -r capture.pcap -Y "quic"

# Verify QUIC frames
tshark -r capture.pcap -Y "quic.handshake"
```

### gRPC Verification
```bash
# Verify gRPC over HTTP/2
tshark -r capture.pcap -Y "grpc"

# Verify protobuf encoding
tshark -r capture.pcap -Y "http2.data.data contains grpc"
```

### TLS 1.3 Verification
```bash
# Verify TLS 1.3 usage
tshark -r capture.pcap -Y "tls.version == 0x0304"

# Verify certificate chain
tshark -r capture.pcap -Y "tls.handshake.type == 11"
```

## Results

All test results and captures are saved to:
```
/tmp/wire-verification-suite-YYYYMMDD-HHMMSS/
├── baseline-e2e.log
├── baseline-captures/
├── wire-verification.log
├── wire-verification-captures/
├── k6-build.log
├── limit-test.log
├── limit-test.pcap
├── rotation-suite.log
├── rotation-captures/
└── suite-summary.md
```

## Requirements

### Tools
- **tcpdump**: Packet capture (auto-installed in pods)
- **tshark**: Protocol analysis (optional, for detailed analysis)
- **kubectl**: Kubernetes access
- **k6**: Load testing (or custom k6-http3)
- **xk6**: k6 extension builder (for custom k6)

### Prerequisites
- Kubernetes cluster running (Kind)
- All services deployed
- Caddy and Envoy running in `ingress-nginx` namespace

## Adversarial Testing

The suite includes adversarial tests to verify security:
- **Protocol Downgrade**: Attempts to downgrade HTTP/2/3 to HTTP/1.1
- **TLS Downgrade**: Attempts to downgrade TLS 1.3 to TLS 1.2
- **Invalid Certificates**: Tests certificate validation
- **Malformed gRPC**: Tests gRPC error handling

## Success Criteria

✅ **HTTP/2**: ALPN negotiation confirmed, HTTP/2 frames verified  
✅ **HTTP/3**: QUIC handshake confirmed, HTTP/3 frames verified  
✅ **gRPC**: HTTP/2 framing verified, protobuf encoding correct  
✅ **TLS 1.3**: TLS version 1.3 enforced, certificate chain validated  
✅ **Strict TLS**: Certificate validation enforced, downgrade prevented  
✅ **Zero-Downtime**: Protocols remain correct during rotation  

## Next Steps

1. Run complete suite: `./scripts/run-complete-wire-verification-suite.sh`
2. Analyze captures: Use tshark/Wireshark to verify protocols
3. Review logs: Check for any protocol mismatches or errors
4. Update documentation: Document findings in test results

## Documentation

- **COMMIT_MESSAGE.txt**: Complete change log with wire-level verification
- **This file**: Complete suite documentation
- **Test results**: Saved to `/tmp/wire-verification-suite-*/`

## Related Files

- `scripts/test-microservices-http2-http3.sh` - Baseline E2E test
- `scripts/test-e2e-wire-verification.sh` - Wire-level verification
- `scripts/build-k6-http3.sh` - Custom k6 build
- `scripts/load/k6-limit-test-wire-verification.js` - Limit test
- `scripts/load/k6-http3-complete.js` - Complete HTTP/3 toolchain
- `scripts/rotation-suite.sh` - Rotation suite
- `scripts/run-complete-wire-verification-suite.sh` - Orchestration
