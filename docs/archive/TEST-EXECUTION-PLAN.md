# Test Execution Plan

**Date:** 2026-01-22  
**Status:** Running tests in sequence

## Test Sequence

### 1. Baseline Smoke Test ✅ Running
- **Script**: `scripts/test-microservices-http2-http3.sh`
- **Status**: Running
- **Features**:
  - Strict TLS (no `-k` flags)
  - gRPC health checks (dual-path: Envoy + port-forward)
  - HTTP/3 health checks (all 9 services)
  - DB verification (post-test)

### 2. Enhanced Smoke Test (Next)
- **Script**: `scripts/test-microservices-http2-http3-enhanced.sh`
- **Features**:
  - Adversarial testing
  - Wire-level packet capture
  - Protocol verification
  - DB verification

### 3. Rotation Suite (After Enhanced)
- **Script**: `scripts/rotation-suite.sh`
- **Features**:
  - CA and leaf certificate rotation
  - Limit finding (increment by 10 each success)
  - k6 load testing (HTTP/2 and HTTP/3)
  - DB verification
  - Wire-level captures

## Infrastructure Status

- ✅ **9/9 services**: Running, 1 replica each (baseline)
- ✅ **2/2 Caddy pods**: Ready
- ✅ **1/1 Envoy pod**: Ready
- ✅ **Strict TLS**: Enabled (Kubernetes CA secret)

## Rotation Suite Configuration

- **H2_INCREMENT**: 10 req/s (was 15)
- **H3_INCREMENT**: 10 req/s (was 8)
- **Increment logic**: Increase by 10 each time test succeeds (no failures)

## DB Verification

All test suites include:
- Post-test data integrity checks
- User verification
- Record verification
- Forum post verification
- Message verification

**Status: Baseline test running, waiting for completion**
