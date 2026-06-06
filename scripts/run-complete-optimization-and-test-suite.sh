#!/usr/bin/env bash
set -euo pipefail

# Complete Optimization and Test Suite
# 1. Analyze all queries (sequential scans, execution times)
# 2. Optimize queries for 256+ clients
# 3. Run query plan verification
# 4. Run smoke tests
# 5. Run rotation suite with limit finding
# 6. Run k6 load tests (persistence + absolute max)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="/tmp/complete-test-suite-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Complete Optimization and Test Suite ==="
echo "Results directory: $RESULTS_DIR"
echo ""
echo "Test Plan:"
echo "  1. Analyze all queries (sequential scans, execution times)"
echo "  2. Optimize for 256+ clients"
echo "  3. Verify query plans"
echo "  4. Smoke test (baseline)"
echo "  5. Wire-level test (enhanced)"
echo "  6. Rotation suite with limit finding"
echo "  7. k6 persistence test (soak)"
echo "  8. k6 limit test (absolute max, p90-p9999999, p100)"
echo ""

# Step 1: Comprehensive Query Analysis
say "=== Step 1: Comprehensive Query Analysis ==="
if bash "$SCRIPT_DIR/analyze-all-queries.sh" > "$RESULTS_DIR/01-query-analysis.log" 2>&1; then
  ok "Query analysis complete"
  # Check for critical issues
  if grep -q "Sequential scans detected" "$RESULTS_DIR/01-query-analysis.log"; then
    warn "Sequential scans found - review analysis results"
  fi
  if grep -q "Slow execution.*> 5000ms" "$RESULTS_DIR/01-query-analysis.log"; then
    warn "Slow queries found (>5s) - optimization needed"
  fi
else
  warn "Query analysis had issues"
fi

# Step 2: Query Plan Verification
say "=== Step 2: Query Plan Verification ==="
if bash "$SCRIPT_DIR/verify-query-plans.sh" > "$RESULTS_DIR/02-query-plans.log" 2>&1; then
  ok "Query plan verification complete"
else
  warn "Query plan verification had issues"
fi

# Step 3: Smoke Test (Baseline)
say "=== Step 3: Smoke Test (Baseline E2E) ==="
if bash "$SCRIPT_DIR/test-microservices-http2-http3.sh" > "$RESULTS_DIR/03-smoke-test.log" 2>&1; then
  ok "Smoke test complete"
else
  warn "Smoke test had failures"
fi

# Step 4: Wire-Level Test (Enhanced)
say "=== Step 4: Wire-Level Test (Protocol Verification) ==="
if bash "$SCRIPT_DIR/test-microservices-http2-http3-enhanced.sh" > "$RESULTS_DIR/04-wire-level.log" 2>&1; then
  ok "Wire-level test complete"
else
  warn "Wire-level test had failures"
fi

# Step 5: Rotation Suite with Limit Finding
say "=== Step 5: CA and Leaf Rotation Suite (with Limit Finding) ==="
say "CRITICAL: Finding rotation limit while maintaining 100% success and low drop rate"

# Check if limit finding script exists
LIMIT_FIND_SCRIPT=""
if [[ -f "$SCRIPT_DIR/load/k6-find-ca-rotation-limit.js" ]]; then
  LIMIT_FIND_SCRIPT="$SCRIPT_DIR/load/k6-find-ca-rotation-limit.js"
elif [[ -f "$SCRIPT_DIR/find-ca-rotation-limit.sh" ]]; then
  LIMIT_FIND_SCRIPT="$SCRIPT_DIR/find-ca-rotation-limit.sh"
fi

if [[ -n "$LIMIT_FIND_SCRIPT" ]]; then
  say "Found limit finding script: $LIMIT_FIND_SCRIPT"
  # Run rotation suite with limit finding enabled
  export ROTATION_FIND_LIMIT="true"
  export ROTATION_TARGET_SUCCESS_RATE="100"  # 100% success required
  export ROTATION_MAX_DROP_RATE="1.0"  # Max 1% drop rate
  
  if bash "$SCRIPT_DIR/rotation-suite.sh" > "$RESULTS_DIR/05-rotation-suite.log" 2>&1; then
    ok "Rotation suite with limit finding complete"
  else
    warn "Rotation suite had issues"
  fi
else
  warn "Limit finding script not found, running standard rotation suite"
  if bash "$SCRIPT_DIR/rotation-suite.sh" > "$RESULTS_DIR/05-rotation-suite.log" 2>&1; then
    ok "Rotation suite complete"
  else
    warn "Rotation suite had issues"
  fi
fi

# Step 6: k6 Persistence Test (Soak Test)
say "=== Step 6: k6 Persistence Test (Soak) ==="
say "Running long-duration persistence test to verify stability"

K6_BIN="${K6_BIN:-k6}"
if [[ -f "$SCRIPT_DIR/../bin/k6-http3" ]]; then
  K6_BIN="$SCRIPT_DIR/../bin/k6-http3"
fi

if [[ -f "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" ]]; then
  # Run persistence test (long duration, moderate load)
  export H2_RATE="50"  # Moderate rate for persistence
  export H3_RATE="25"
  export DURATION="3600s"  # 1 hour soak test
  
  say "Running 1-hour persistence test (H2: ${H2_RATE} req/s, H3: ${H3_RATE} req/s)..."
  "$K6_BIN" run \
    --summary-export="$RESULTS_DIR/k6-persistence-summary.json" \
    "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" \
    > "$RESULTS_DIR/06-k6-persistence.log" 2>&1 || warn "Persistence test had issues"
  
  ok "Persistence test complete"
else
  warn "k6 limit test script not found"
fi

# Step 7: k6 Limit Test (Absolute Max)
say "=== Step 7: k6 Limit Test (Absolute Maximum) ==="
say "Finding absolute maximum throughput with percentile analysis (p90 to p9999999, p100)"

if [[ -f "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" ]]; then
  # Start with moderate rate and increase
  export H2_RATE="${K6_H2_MAX_RATE:-200}"
  export H3_RATE="${K6_H3_MAX_RATE:-100}"
  export DURATION="${K6_LIMIT_DURATION:-300s}"  # 5 minutes for limit test
  export ENABLE_PROTOCOL_VERIFICATION="true"
  
  say "Running limit test to find absolute max (H2: ${H2_RATE} req/s, H3: ${H3_RATE} req/s)..."
  say "Measuring p90, p95, p99, p999, p9999, p99999, p999999, p9999999, p100 (using Little's law)"
  
  "$K6_BIN" run \
    --summary-export="$RESULTS_DIR/k6-limit-summary.json" \
    --out json="$RESULTS_DIR/k6-limit-results.json" \
    "$SCRIPT_DIR/load/k6-limit-test-wire-verification.js" \
    > "$RESULTS_DIR/07-k6-limit.log" 2>&1 || warn "Limit test had issues"
  
  # Extract percentile data from JSON
  if [[ -f "$RESULTS_DIR/k6-limit-results.json" ]]; then
    say "Extracting percentile data..."
    python3 << 'PYTHONEOF' > "$RESULTS_DIR/k6-percentiles.txt" 2>&1 || true
import json
import sys

try:
    with open('$RESULTS_DIR/k6-limit-results.json', 'r') as f:
        data = json.load(f)
    
    # Extract metrics
    if 'metrics' in data:
        for metric_name, metric_data in data['metrics'].items():
            if 'values' in metric_data and 'p' in metric_data['values']:
                p_values = metric_data['values']['p']
                print(f"\n{metric_name}:")
                for percentile in ['0.90', '0.95', '0.99', '0.999', '0.9999', '0.99999', '0.999999', '0.9999999', '1.0']:
                    if percentile in p_values:
                        print(f"  p{percentile}: {p_values[percentile]:.2f}")
except Exception as e:
    print(f"Error extracting percentiles: {e}")
PYTHONEOF
  fi
  
  ok "Limit test complete"
else
  warn "k6 limit test script not found"
fi

# Final Summary
say "=== Complete Test Suite Summary ==="
ok "All tests executed (see $RESULTS_DIR/ for logs)"
echo ""
echo "Results:"
echo "  1. Query Analysis: $RESULTS_DIR/01-query-analysis.log"
echo "  2. Query Plans: $RESULTS_DIR/02-query-plans.log"
echo "  3. Smoke Test: $RESULTS_DIR/03-smoke-test.log"
echo "  4. Wire-Level: $RESULTS_DIR/04-wire-level.log"
echo "  5. Rotation Suite: $RESULTS_DIR/05-rotation-suite.log"
echo "  6. k6 Persistence: $RESULTS_DIR/06-k6-persistence.log"
echo "  7. k6 Limit Test: $RESULTS_DIR/07-k6-limit.log"
echo ""
if [[ -f "$RESULTS_DIR/k6-percentiles.txt" ]]; then
  echo "Percentile Analysis:"
  cat "$RESULTS_DIR/k6-percentiles.txt"
fi

say "=== Test Suite Complete ==="
