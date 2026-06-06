#!/usr/bin/env bash
# Complete Wire-Level Verification Suite
# Runs baseline E2E, wire-level verification, builds custom k6, runs limit tests, and rotation suite
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Configuration
export KUBECONFIG="${KUBECONFIG:-/tmp/kind-h3-fixed.yaml}"
SKIP_BASELINE="${SKIP_BASELINE:-false}"
SKIP_WIRE="${SKIP_WIRE:-false}"
SKIP_K6_BUILD="${SKIP_K6_BUILD:-false}"
SKIP_LIMIT="${SKIP_LIMIT:-false}"
SKIP_ROTATION="${SKIP_ROTATION:-false}"

# Results directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="/tmp/wire-verification-suite-${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

say "=== Complete Wire-Level Verification Suite ==="
ok "Results directory: $RESULTS_DIR"
ok "KUBECONFIG: $KUBECONFIG"

# Step 1: Baseline E2E Test
if [[ "$SKIP_BASELINE" != "true" ]]; then
  say "=== Step 1: Baseline E2E Test ==="
  if [[ -f "$SCRIPT_DIR/test-microservices-http2-http3.sh" ]]; then
    ok "Running baseline E2E test..."
    bash "$SCRIPT_DIR/test-microservices-http2-http3.sh" 2>&1 | tee "$RESULTS_DIR/baseline-e2e.log"
    BASELINE_EXIT=$?
    if [[ $BASELINE_EXIT -eq 0 ]]; then
      ok "Baseline E2E test completed successfully"
    else
      warn "Baseline E2E test had errors (exit code: $BASELINE_EXIT)"
    fi
    
    # Copy packet captures from baseline test if available
    if [[ -d "/tmp/tls-captures-"* ]]; then
      LATEST_CAPTURE=$(ls -td /tmp/tls-captures-* 2>/dev/null | head -1 || echo "")
      if [[ -n "$LATEST_CAPTURE" ]]; then
        cp -r "$LATEST_CAPTURE" "$RESULTS_DIR/baseline-captures" 2>/dev/null || true
        ok "Baseline captures copied to: $RESULTS_DIR/baseline-captures"
      fi
    fi
  else
    fail "Baseline E2E test script not found: $SCRIPT_DIR/test-microservices-http2-http3.sh"
  fi
else
  warn "Skipping baseline E2E test (SKIP_BASELINE=true)"
fi

# Step 2: Wire-Level Verification E2E Test
if [[ "$SKIP_WIRE" != "true" ]]; then
  say "=== Step 2: Wire-Level Verification E2E Test ==="
  if [[ -f "$SCRIPT_DIR/test-e2e-wire-verification.sh" ]]; then
    ok "Running wire-level verification E2E test..."
    chmod +x "$SCRIPT_DIR/test-e2e-wire-verification.sh"
    bash "$SCRIPT_DIR/test-e2e-wire-verification.sh" 2>&1 | tee "$RESULTS_DIR/wire-verification.log"
    WIRE_EXIT=$?
    if [[ $WIRE_EXIT -eq 0 ]]; then
      ok "Wire-level verification E2E test completed successfully"
    else
      warn "Wire-level verification E2E test had errors (exit code: $WIRE_EXIT)"
    fi
    
    # Copy wire verification captures
    if [[ -d "/tmp/wire-verification-"* ]]; then
      LATEST_WIRE=$(ls -td /tmp/wire-verification-* 2>/dev/null | head -1 || echo "")
      if [[ -n "$LATEST_WIRE" ]]; then
        cp -r "$LATEST_WIRE" "$RESULTS_DIR/wire-verification-captures" 2>/dev/null || true
        ok "Wire verification captures copied to: $RESULTS_DIR/wire-verification-captures"
      fi
    fi
  else
    warn "Wire-level verification E2E test script not found, skipping..."
  fi
else
  warn "Skipping wire-level verification E2E test (SKIP_WIRE=true)"
fi

# Step 3: Build Custom k6 with xk6 HTTP/3 Extension
if [[ "$SKIP_K6_BUILD" != "true" ]]; then
  say "=== Step 3: Build Custom k6 with xk6 HTTP/3 Extension ==="
  if [[ -f "$SCRIPT_DIR/build-k6-http3.sh" ]]; then
    ok "Building custom k6 with HTTP/3 support..."
    chmod +x "$SCRIPT_DIR/build-k6-http3.sh"
    bash "$SCRIPT_DIR/build-k6-http3.sh" 2>&1 | tee "$RESULTS_DIR/k6-build.log"
    K6_BUILD_EXIT=$?
    if [[ $K6_BUILD_EXIT -eq 0 ]]; then
      ok "Custom k6 built successfully"
      
      # Verify binary exists
      if [[ -f "$(pwd)/.k6-build/bin/k6-http3" ]]; then
        ok "k6-http3 binary location: $(pwd)/.k6-build/bin/k6-http3"
        "$(pwd)/.k6-build/bin/k6-http3" version 2>&1 | tee "$RESULTS_DIR/k6-version.log"
      else
        warn "k6-http3 binary not found at expected location"
      fi
    else
      warn "Custom k6 build had errors (exit code: $K6_BUILD_EXIT)"
      warn "  Continuing anyway - limit tests will use standard k6 (may not have HTTP/3)"
    fi
  else
    warn "k6 build script not found: $SCRIPT_DIR/build-k6-http3.sh"
    warn "  Skipping custom k6 build - limit tests will use standard k6"
  fi
else
  warn "Skipping custom k6 build (SKIP_K6_BUILD=true)"
fi

# Step 4: Limit Test with Wire Verification
if [[ "$SKIP_LIMIT" != "true" ]]; then
  say "=== Step 4: Limit Test with Wire Verification ==="
  if [[ -f "$SCRIPT_DIR/../scripts/load/k6-limit-test-wire-verification.js" ]]; then
    ok "Running limit test with wire verification..."
    
    # Check if custom k6 is available
    K6_BIN="k6"
    if [[ -f "$(pwd)/.k6-build/bin/k6-http3" ]]; then
      K6_BIN="$(pwd)/.k6-build/bin/k6-http3"
      ok "Using custom k6-http3 binary"
    else
      warn "Using standard k6 (HTTP/3 may not work)"
    fi
    
    # Start packet capture for limit test
    CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$CADDY_POD" ]]; then
      say "Starting packet capture for limit test..."
      kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c \
        "apk add --no-cache tcpdump 2>/dev/null || apt-get update -qq && apt-get install -y -qq tcpdump 2>/dev/null || true" >/dev/null 2>&1 || true
      
      if kubectl -n ingress-nginx exec "$CADDY_POD" -- which tcpdump >/dev/null 2>&1; then
        kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c \
          "tcpdump -i any -U -s 0 -w /tmp/limit-test.pcap 'port 443 or port 30443' 2>&1" \
          > "$RESULTS_DIR/limit-test-capture.log" 2>&1 &
        LIMIT_CAPTURE_PID=$!
        ok "Packet capture started (PID: $LIMIT_CAPTURE_PID)"
        sleep 2
      fi
    fi
    
    # Run limit test
    export H2_RATE="${H2_RATE:-80}"
    export H3_RATE="${H3_RATE:-40}"
    export DURATION="${DURATION:-180s}"
    export ENABLE_PROTOCOL_VERIFICATION="true"
    
    "$K6_BIN" run "$SCRIPT_DIR/../scripts/load/k6-limit-test-wire-verification.js" \
      2>&1 | tee "$RESULTS_DIR/limit-test.log"
    LIMIT_EXIT=$?
    
    # Stop packet capture
    if [[ -n "${LIMIT_CAPTURE_PID:-}" ]]; then
      kill -TERM "$LIMIT_CAPTURE_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$LIMIT_CAPTURE_PID" 2>/dev/null || true
      
      # Copy capture
      if [[ -n "$CADDY_POD" ]]; then
        kubectl -n ingress-nginx exec "$CADDY_POD" -- sh -c "cat /tmp/limit-test.pcap" > \
          "$RESULTS_DIR/limit-test.pcap" 2>/dev/null || true
        ok "Limit test capture saved to: $RESULTS_DIR/limit-test.pcap"
      fi
    fi
    
    if [[ $LIMIT_EXIT -eq 0 ]]; then
      ok "Limit test completed successfully"
    else
      warn "Limit test had errors (exit code: $LIMIT_EXIT)"
    fi
  else
    warn "Limit test script not found, skipping..."
  fi
else
  warn "Skipping limit test (SKIP_LIMIT=true)"
fi

# Step 5: Rotation Suite with Wire-Level Verification
if [[ "$SKIP_ROTATION" != "true" ]]; then
  say "=== Step 5: Rotation Suite with Wire-Level Verification ==="
  if [[ -f "$SCRIPT_DIR/rotation-suite.sh" ]]; then
    ok "Running rotation suite with wire-level verification..."
    
    # Enable wire verification in rotation suite
    export WIRE_VERIFY="true"
    export ROTATE_CA="${ROTATE_CA:-true}"
    export ROTATE_LEAF="${ROTATE_LEAF:-true}"
    
    chmod +x "$SCRIPT_DIR/rotation-suite.sh"
    bash "$SCRIPT_DIR/rotation-suite.sh" 2>&1 | tee "$RESULTS_DIR/rotation-suite.log"
    ROTATION_EXIT=$?
    
    if [[ $ROTATION_EXIT -eq 0 ]]; then
      ok "Rotation suite completed successfully"
    else
      warn "Rotation suite had errors (exit code: $ROTATION_EXIT)"
    fi
    
    # Copy rotation captures
    if [[ -d "/tmp/rotation-wire-"* ]]; then
      LATEST_ROTATION=$(ls -td /tmp/rotation-wire-* 2>/dev/null | head -1 || echo "")
      if [[ -n "$LATEST_ROTATION" ]]; then
        cp -r "$LATEST_ROTATION" "$RESULTS_DIR/rotation-captures" 2>/dev/null || true
        ok "Rotation captures copied to: $RESULTS_DIR/rotation-captures"
      fi
    fi
  else
    warn "Rotation suite script not found, skipping..."
  fi
else
  warn "Skipping rotation suite (SKIP_ROTATION=true)"
fi

# Final Summary
say "=== Complete Wire-Level Verification Suite Summary ==="
ok "Results directory: $RESULTS_DIR"
ok "All test results and captures saved to: $RESULTS_DIR/"

# Create summary report
cat > "$RESULTS_DIR/suite-summary.md" <<EOF
# Complete Wire-Level Verification Suite Results

**Timestamp**: $(date -Iseconds)
**KUBECONFIG**: $KUBECONFIG

## Test Execution Summary

| Test | Status | Exit Code | Log File |
|------|--------|-----------|----------|
| Baseline E2E | ${BASELINE_EXIT:-N/A} | ${BASELINE_EXIT:-N/A} | baseline-e2e.log |
| Wire Verification | ${WIRE_EXIT:-N/A} | ${WIRE_EXIT:-N/A} | wire-verification.log |
| k6 Build | ${K6_BUILD_EXIT:-N/A} | ${K6_BUILD_EXIT:-N/A} | k6-build.log |
| Limit Test | ${LIMIT_EXIT:-N/A} | ${LIMIT_EXIT:-N/A} | limit-test.log |
| Rotation Suite | ${ROTATION_EXIT:-N/A} | ${ROTATION_EXIT:-N/A} | rotation-suite.log |

## Captures

- Baseline: $RESULTS_DIR/baseline-captures/
- Wire Verification: $RESULTS_DIR/wire-verification-captures/
- Limit Test: $RESULTS_DIR/limit-test.pcap
- Rotation: $RESULTS_DIR/rotation-captures/

## Protocol Verification

All captures can be analyzed with:
\`\`\`bash
# HTTP/2 verification
tshark -r $RESULTS_DIR/limit-test.pcap -Y "http2"

# HTTP/3 (QUIC) verification
tshark -r $RESULTS_DIR/limit-test.pcap -Y "quic"

# TLS 1.3 verification
tshark -r $RESULTS_DIR/limit-test.pcap -Y "tls.version == 0x0304"

# gRPC verification
tshark -r $RESULTS_DIR/wire-verification-captures/envoy-wire.pcap -Y "grpc"
\`\`\`

## Next Steps

1. Analyze packet captures for protocol verification
2. Review test logs for any errors or warnings
3. Update COMMIT_MESSAGE.txt with findings
EOF

ok "Summary report: $RESULTS_DIR/suite-summary.md"

say "=== Complete Wire-Level Verification Suite Finished ==="
