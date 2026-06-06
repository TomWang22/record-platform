#!/usr/bin/env bash
set -euo pipefail

# Full Test Suite Runner
# Runs all tests in order: query plans, smoke, wire-level, k6, rotation suite

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="/tmp/test-suite-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Full Test Suite Runner ==="
echo "Results directory: $RESULTS_DIR"
echo ""
echo "Test Order:"
echo "  1. Query Plan Verification"
echo "  2. Smoke Test (test-microservices-http2-http3.sh)"
echo "  3. Wire-Level Test (test-microservices-http2-http3-enhanced.sh)"
echo "  4. k6 Limit Test"
echo "  5. Rotation Suite (rotation-suite.sh)"
echo ""

# Step 1: Query Plan Verification
say "=== Step 1: Query Plan Verification ==="
if bash "$SCRIPT_DIR/verify-query-plans.sh" > "$RESULTS_DIR/01-query-plans.log" 2>&1; then
  ok "Query plan verification complete (see $RESULTS_DIR/01-query-plans.log)"
else
  warn "Query plan verification had issues (see $RESULTS_DIR/01-query-plans.log)"
  warn "Continuing with tests - will optimize query plans after test suite"
fi

# Step 2: Smoke Test
say "=== Step 2: Smoke Test (Baseline E2E) ==="
if bash "$SCRIPT_DIR/test-microservices-http2-http3.sh" > "$RESULTS_DIR/02-smoke-test.log" 2>&1; then
  ok "Smoke test complete (see $RESULTS_DIR/02-smoke-test.log)"
else
  warn "Smoke test had failures (see $RESULTS_DIR/02-smoke-test.log)"
  warn "Review failures and continue with wire-level test"
fi

# Step 3: Wire-Level Test
say "=== Step 3: Wire-Level Test (Protocol Verification) ==="
if bash "$SCRIPT_DIR/test-microservices-http2-http3-enhanced.sh" > "$RESULTS_DIR/03-wire-level.log" 2>&1; then
  ok "Wire-level test complete (see $RESULTS_DIR/03-wire-level.log)"
else
  warn "Wire-level test had failures (see $RESULTS_DIR/03-wire-level.log)"
fi

# Step 4: k6 Limit Test
say "=== Step 4: k6 Limit Test ==="
say "Running k6 limit test with wire capture..."
if [[ -f "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" ]]; then
  # Start packet capture for k6
  if [[ -f "$SCRIPT_DIR/start-wire-capture-for-k6.sh" ]]; then
    bash "$SCRIPT_DIR/start-wire-capture-for-k6.sh" > "$RESULTS_DIR/k6-capture-start.log" 2>&1 || true
  fi
  
  # Run k6 limit test
  K6_BIN="${K6_BIN:-k6}"
  if [[ -f "$SCRIPT_DIR/../bin/k6-http3" ]]; then
    K6_BIN="$SCRIPT_DIR/../bin/k6-http3"
  fi
  
  export H2_RATE="${H2_RATE:-80}"
  export H3_RATE="${H3_RATE:-40}"
  export DURATION="${DURATION:-180s}"
  export ENABLE_PROTOCOL_VERIFICATION="true"
  
  if "$K6_BIN" run "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" > "$RESULTS_DIR/04-k6-limit.log" 2>&1; then
    ok "k6 limit test complete (see $RESULTS_DIR/04-k6-limit.log)"
  else
    warn "k6 limit test had failures (see $RESULTS_DIR/04-k6-limit.log)"
  fi
  
  # Stop packet capture
  if [[ -f "$SCRIPT_DIR/stop-wire-capture-for-k6.sh" ]]; then
    bash "$SCRIPT_DIR/stop-wire-capture-for-k6.sh" > "$RESULTS_DIR/k6-capture-stop.log" 2>&1 || true
  fi
else
  warn "k6 limit test script not found, skipping"
fi

# Step 5: Rotation Suite
say "=== Step 5: CA and Leaf Rotation Suite ==="
say "CRITICAL: This tests zero-downtime certificate rotation"
if bash "$SCRIPT_DIR/rotation-suite.sh" > "$RESULTS_DIR/05-rotation-suite.log" 2>&1; then
  ok "Rotation suite complete (see $RESULTS_DIR/05-rotation-suite.log)"
else
  warn "Rotation suite had failures (see $RESULTS_DIR/05-rotation-suite.log)"
fi

# Final Summary
say "=== Test Suite Complete ==="
ok "All tests executed (see $RESULTS_DIR/ for logs)"
echo ""
echo "Test Results Summary:"
echo "  1. Query Plans: $RESULTS_DIR/01-query-plans.log"
echo "  2. Smoke Test: $RESULTS_DIR/02-smoke-test.log"
echo "  3. Wire-Level: $RESULTS_DIR/03-wire-level.log"
echo "  4. k6 Limit: $RESULTS_DIR/04-k6-limit.log"
echo "  5. Rotation Suite: $RESULTS_DIR/05-rotation-suite.log"
echo ""
echo "Next Steps:"
echo "  - Review query plan results and optimize slow queries"
echo "  - Verify Analytics → Python AI pipeline is robust"
echo "  - Address any test failures before production deployment"
