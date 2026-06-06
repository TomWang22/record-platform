#!/usr/bin/env bash
# Enhanced test runner with comprehensive packet capture and verification
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# GUARANTEED FIX: kubectl shim
if [[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]]; then
  source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh"
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check if enhanced HTTP/3 image exists; build via script if missing
check_http3_image() {
  if docker images http3-curl-enhanced:latest --format "{{.Repository}}" 2>/dev/null | grep -q "http3-curl-enhanced"; then
    ok "Enhanced HTTP/3 image available"
    return 0
  fi
  warn "Enhanced HTTP/3 image not found - building..."
  if [[ -x "$SCRIPT_DIR/build-http3-image.sh" ]]; then
    "$SCRIPT_DIR/build-http3-image.sh" || { warn "Build failed - using alpine/curl-http3"; return 1; }
  elif [[ -f "$SCRIPT_DIR/../docker/http3-curl-enhanced/Dockerfile" ]]; then
    docker build -t http3-curl-enhanced:latest \
      -f "$SCRIPT_DIR/../docker/http3-curl-enhanced/Dockerfile" \
      "$SCRIPT_DIR/../docker/http3-curl-enhanced/" || { warn "Build failed - using alpine/curl-http3"; return 1; }
  else
    warn "Dockerfile not found - using alpine/curl-http3"
    return 1
  fi
  ok "Enhanced HTTP/3 image ready"
  return 0
}

# Comprehensive packet capture setup (uses shared lib)
setup_packet_capture() {
  # shellcheck source=scripts/lib/packet-capture.sh
  [[ -f "$SCRIPT_DIR/lib/packet-capture.sh" ]] && . "$SCRIPT_DIR/lib/packet-capture.sh"
  init_capture_session
  
  say "Setting up comprehensive packet capture"
  
  local caddy_pods
  caddy_pods=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
  for pod in $caddy_pods; do
    ok "Starting capture on Caddy pod: $pod"
    start_capture "ingress-nginx" "$pod" "port 443 or port 30443 or udp port 443 or port 8080"
  done
  
  local envoy_pod
  envoy_pod=$(kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$envoy_pod" ]]; then
    ok "Starting capture on Envoy pod: $envoy_pod"
    start_capture "envoy-test" "$envoy_pod" "port 50051 or port 50052 or port 50053"
  fi
  
  packet_capture_dir
}

# Stop and analyze packet captures (uses shared lib)
analyze_packet_capture() {
  # shellcheck source=scripts/lib/packet-capture.sh
  [[ -f "$SCRIPT_DIR/lib/packet-capture.sh" ]] && . "$SCRIPT_DIR/lib/packet-capture.sh"
  local capture_dir="${1:-$(packet_capture_dir 2>/dev/null)}"
  say "Analyzing packet captures"
  stop_and_analyze_captures 1
  [[ -n "$capture_dir" ]] && [[ -d "$capture_dir" ]] && rm -rf "$capture_dir"
  ok "Packet capture analysis complete"
}

# Run comprehensive test with packet capture
run_comprehensive_test() {
  say "=== COMPREHENSIVE TEST WITH PACKET CAPTURE ==="
  
  check_http3_image || warn "Using fallback HTTP/3 testing (alpine/curl-http3)"
  
  # Source http3 lib for HTTP/3 traffic (uses enhanced image when available)
  [[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && . "$SCRIPT_DIR/lib/http3.sh"
  
  local capture_dir
  capture_dir=$(setup_packet_capture)
  
  sleep 3
  
  ok "Running baseline smoke test with packet capture..."
  if ./scripts/test-microservices-http2-http3.sh >/tmp/baseline-test.log 2>&1; then
    ok "✅ Baseline test: PASSED"
  else
    warn "⚠️  Baseline test: FAILED - check /tmp/baseline-test.log"
  fi
  
  ok "Generating additional test traffic for protocol verification..."
  
  local port="${PORT:-30443}"
  for i in {1..5}; do
    curl -s -k --http2-prior-knowledge --max-time 10 "https://127.0.0.1:${port}/api/records/health" >/dev/null 2>&1 || true
    curl -s -k --http2-prior-knowledge --max-time 10 "https://127.0.0.1:${port}/api/auth/health" >/dev/null 2>&1 || true
  done
  
  for i in {1..3}; do
    http3_curl -k -s --connect-timeout 5 "https://127.0.0.1:${port}/api/records/health" >/dev/null 2>&1 || true
    http3_curl -k -s --connect-timeout 5 "https://127.0.0.1:${port}/api/auth/health" >/dev/null 2>&1 || true
  done 2>/dev/null || warn "HTTP/3 traffic generation had errors"
  
  sleep 5
  
  analyze_packet_capture "$capture_dir"
  
  ok "Running enhanced adversarial tests..."
  if ./scripts/enhanced-adversarial-tests.sh >/tmp/adversarial-test.log 2>&1; then
    ok "✅ Enhanced adversarial tests: PASSED"
  else
    warn "⚠️  Enhanced adversarial tests: FAILED - check /tmp/adversarial-test.log"
  fi
  
  if [[ "${RUN_VALGRIND:-0}" == "1" ]]; then
    ok "Running valgrind memory-leak check..."
    ./scripts/valgrind-memory-leak-test.sh >/tmp/valgrind-test.log 2>&1 || warn "Valgrind check had issues - see /tmp/valgrind-test.log"
  fi
  
  say "=== COMPREHENSIVE TEST COMPLETE ==="
  ok "All tests completed with packet capture verification"
  ok "Logs: /tmp/baseline-test.log, /tmp/adversarial-test.log"
}

main() {
  run_comprehensive_test
}

main "$@"