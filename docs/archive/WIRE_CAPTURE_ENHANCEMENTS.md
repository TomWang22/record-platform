# Wire-Level Packet Capture Enhancements

## Overview

Comprehensive wire-level packet capture integration for HTTP/3 (QUIC), HTTP/2, gRPC, and TLS 1.3 verification during load tests and certificate rotation.

## New Scripts

### 1. `scripts/start-wire-capture-for-k6.sh`
Starts packet capture on Caddy and Envoy pods before k6 tests.

**Features:**
- Captures HTTP/2 (TCP 443) and HTTP/3/QUIC (UDP 443) on Caddy pods
- Captures gRPC traffic (ports 10000, 30000-30001, 50051-50060) on Envoy pods
- Auto-stops after timeout (default 10 minutes)
- Saves captures to timestamped directory

**Usage:**
```bash
# Start capture (returns capture directory)
CAPTURE_DIR=$(./scripts/start-wire-capture-for-k6.sh)

# With custom timeout (in seconds)
CAPTURE_TIMEOUT=300 ./scripts/start-wire-capture-for-k6.sh
```

### 2. `scripts/stop-wire-capture-for-k6.sh`
Stops packet capture and collects captures from pods.

**Features:**
- Stops all capture processes
- Collects `.pcap` files from pods
- Verifies protocols in captures using tshark
- Reports QUIC, HTTP/2, TLS 1.3, and gRPC verification

**Usage:**
```bash
# Stop capture and collect
./scripts/stop-wire-capture-for-k6.sh [capture-dir]

# Auto-detect most recent capture
./scripts/stop-wire-capture-for-k6.sh
```

### 3. `scripts/run-k6-with-wire-capture.sh`
Orchestrates packet capture and k6 execution.

**Features:**
- Starts packet capture before k6 test
- Runs k6 test
- Stops capture after test completes
- Handles cleanup automatically

**Usage:**
```bash
# Run k6 with wire capture
./scripts/run-k6-with-wire-capture.sh scripts/load/k6-limit-test-wire-verification.js

# With k6 options
./scripts/run-k6-with-wire-capture.sh scripts/load/k6-http3-complete.js --duration 180s
```

### 4. `scripts/verify-wire-captures.sh`
Comprehensive protocol verification in packet captures.

**Features:**
- Verifies HTTP/2 (ALPN negotiation)
- Verifies HTTP/3/QUIC (handshake, version negotiation, UDP)
- Verifies TLS 1.3 (strict enforcement)
- Verifies gRPC (HTTP/2 framing, content-type)
- Reports detailed verification results

**Usage:**
```bash
# Verify captures
./scripts/verify-wire-captures.sh [capture-dir]

# Auto-detect most recent
./scripts/verify-wire-captures.sh
```

## Enhanced Rotation Suite

### Updated `scripts/rotation-suite.sh`

**Enhancements:**
- ✅ Captures UDP 443 for QUIC/HTTP/3 (was missing before)
- ✅ Enhanced capture filters for all gRPC ports (50051-50060)
- ✅ Comprehensive QUIC verification (handshake, version negotiation)
- ✅ gRPC verification (HTTP/2 framing check)
- ✅ Better error handling and protocol reporting

**Protocol Verification:**
- HTTP/2: ALPN negotiation and HTTP/2 frames
- HTTP/3: QUIC Initial packets, version negotiation, UDP transport
- TLS 1.3: Strict version enforcement (no TLS 1.2)
- gRPC: HTTP/2 framing with `application/grpc` content-type

## Protocol Verification Details

### HTTP/3 (QUIC) Verification

**Packet Filters:**
```bash
# Capture QUIC packets
tcpdump -i any -U -s 65535 -w capture.pcap 'udp port 443'

# Verify QUIC in captures
tshark -r capture.pcap -Y "quic"
tshark -r capture.pcap -Y "quic.long.packet_type == 1"  # Initial handshake
tshark -r capture.pcap -Y "quic.version"                 # Version negotiation
tshark -r capture.pcap -Y "udp && quic"                  # UDP transport
```

**What We Verify:**
- ✅ QUIC packets present (UDP 443)
- ✅ QUIC Initial handshake packets
- ✅ QUIC version negotiation
- ✅ QUIC over UDP (not TCP)

### HTTP/2 Verification

**Packet Filters:**
```bash
# Capture HTTP/2 packets
tcpdump -i any -U -s 65535 -w capture.pcap 'tcp port 443'

# Verify HTTP/2 in captures
tshark -r capture.pcap -Y "http2"
tshark -r capture.pcap -Y "tls.handshake.extensions_alpn_str contains \"h2\""  # ALPN
```

**What We Verify:**
- ✅ HTTP/2 frames present
- ✅ ALPN negotiation (h2)

### gRPC Verification

**Packet Filters:**
```bash
# Capture gRPC traffic
tcpdump -i any -U -s 65535 -w capture.pcap 'port 10000 or port 30000 or port 50051'

# Verify gRPC in captures
tshark -r capture.pcap -Y "http2.header.value contains \"application/grpc\""
tshark -r capture.pcap -Y "http2 && http2.header.value contains \"application/grpc\""  # HTTP/2 framing
```

**What We Verify:**
- ✅ gRPC content-type (`application/grpc`)
- ✅ gRPC over HTTP/2 (not HTTP/1.1 or HTTP/3)

### TLS 1.3 Verification

**Packet Filters:**
```bash
# Verify TLS 1.3
tshark -r capture.pcap -Y "tls.version == 0x0304"  # TLS 1.3
tshark -r capture.pcap -Y "tls.version == 0x0303"  # TLS 1.2 (should not exist)
```

**What We Verify:**
- ✅ TLS 1.3 only (no TLS 1.2 or older)

## Integration with k6 Tests

### For HTTP/3 Tests

```bash
# Run HTTP/3 test with wire capture
./scripts/run-k6-with-wire-capture.sh scripts/load/k6-http3-complete.js --duration 60s

# Verify captures after test
./scripts/verify-wire-captures.sh
```

### For Limit Tests

```bash
# Run limit test with wire capture
H2_RATE=100 H3_RATE=50 ./scripts/run-k6-with-wire-capture.sh \
  scripts/load/k6-limit-test-wire-verification.js --duration 180s

# Analyze captures
tshark -r /tmp/k6-wire-capture-*/caddy-*.pcap -Y "quic"
```

### For Rotation Suite

```bash
# Run rotation suite with wire verification (already integrated)
WIRE_VERIFY=true ./scripts/rotation-suite.sh

# Captures automatically saved and verified
# Location: /tmp/rotation-wire-*/
```

## Capture Locations

- **k6 Tests**: `/tmp/k6-wire-capture-<timestamp>/`
- **Rotation Suite**: `/tmp/rotation-wire-<timestamp>/`

## Analysis Commands

### Quick Protocol Check
```bash
# Check for QUIC
tshark -r capture.pcap -Y "quic" | wc -l

# Check for HTTP/2
tshark -r capture.pcap -Y "http2" | wc -l

# Check for TLS 1.3
tshark -r capture.pcap -Y "tls.version == 0x0304" | wc -l
```

### Detailed Analysis
```bash
# QUIC handshake details
tshark -r capture.pcap -Y "quic.long.packet_type == 1" -V

# HTTP/2 frame types
tshark -r capture.pcap -Y "http2" -T fields -e http2.type

# TLS version distribution
tshark -r capture.pcap -Y "tls.version" -T fields -e tls.version
```

## Troubleshooting

### No QUIC Packets Detected

**Possible Causes:**
1. k6 not using HTTP/3 (standard k6 doesn't support QUIC)
2. Caddy not configured for HTTP/3
3. UDP 443 not captured (check capture filter)

**Solution:**
```bash
# Use custom k6-http3 binary
K6_BIN=".k6-build/bin/k6-http3" ./scripts/run-k6-with-wire-capture.sh script.js

# Verify Caddy HTTP/3 config
kubectl -n ingress-nginx get configmap caddy-h3 -o yaml | grep -i quic
```

### Capture Timeout Too Short

**Solution:**
```bash
# Increase capture timeout
CAPTURE_TIMEOUT=600 ./scripts/start-wire-capture-for-k6.sh
```

### tshark Not Available

**Install:**
```bash
# macOS
brew install wireshark

# Linux
apt-get install tshark
```

## Success Criteria

### HTTP/3 (QUIC)
- ✅ QUIC packets detected in UDP 443 traffic
- ✅ QUIC Initial handshake packets present
- ✅ QUIC version negotiation successful
- ✅ QUIC over UDP (not TCP)

### HTTP/2
- ✅ HTTP/2 frames present in TCP 443 traffic
- ✅ ALPN negotiation shows "h2"
- ✅ No HTTP/1.1 fallback (unless intentional)

### gRPC
- ✅ `application/grpc` content-type in HTTP/2 headers
- ✅ gRPC over HTTP/2 (not HTTP/1.1 or HTTP/3)

### TLS 1.3
- ✅ TLS 1.3 only (no TLS 1.2 or older)
- ✅ Certificate chain validated
- ✅ Strict TLS enforced

## Next Steps

1. **Automate Protocol Verification**: Add to CI/CD pipeline
2. **Alert on Protocol Violations**: Detect downgrades automatically
3. **Performance Correlation**: Link protocol usage to latency metrics
4. **Comprehensive Reporting**: Generate protocol verification reports
