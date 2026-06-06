#!/usr/bin/env bash
set -euo pipefail

# Final Complete Test Suite
# 1. Analyze queries (find/fix sequential scans, slow queries)
# 2. Optimize for 256+ clients
# 3. Verify query plans
# 4. Run smoke tests
# 5. Run rotation suite with limit finding
# 6. Run k6 comprehensive tests (persistence + limit with percentiles)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="/tmp/final-test-suite-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Final Complete Test Suite ==="
echo "Results: $RESULTS_DIR"
echo ""

# Step 1: Analyze and Optimize Queries
say "=== Step 1: Query Analysis and Optimization ==="
bash "$SCRIPT_DIR/analyze-all-queries.sh" > "$RESULTS_DIR/01-analysis.log" 2>&1
bash "$SCRIPT_DIR/optimize-queries-for-scale.sh" > "$RESULTS_DIR/02-optimization.log" 2>&1
ok "Queries analyzed and optimized"

# Step 2: Verify Query Plans
say "=== Step 2: Query Plan Verification ==="
bash "$SCRIPT_DIR/verify-query-plans.sh" > "$RESULTS_DIR/03-query-plans.log" 2>&1
ok "Query plans verified"

# Step 3: Smoke Tests
say "=== Step 3: Smoke Tests ==="
say "3a: Baseline E2E Test"
bash "$SCRIPT_DIR/test-microservices-http2-http3.sh" > "$RESULTS_DIR/04-smoke-baseline.log" 2>&1 || warn "Baseline smoke test had issues"

say "3b: Wire-Level Enhanced Test"
bash "$SCRIPT_DIR/test-microservices-http2-http3-enhanced.sh" > "$RESULTS_DIR/05-smoke-wire.log" 2>&1 || warn "Wire-level test had issues"

# Step 4: Rotation Suite with Limit Finding
say "=== Step 4: CA/Leaf Rotation with Limit Finding ==="
export ROTATION_FIND_LIMIT="true"
export ROTATION_TARGET_SUCCESS_RATE="100"
export ROTATION_MAX_DROP_RATE="1.0"
bash "$SCRIPT_DIR/rotation-suite.sh" > "$RESULTS_DIR/06-rotation-limit.log" 2>&1 || warn "Rotation suite had issues"

# Step 5: k6 Comprehensive Tests
say "=== Step 5: k6 Comprehensive Testing ==="

K6_BIN="${K6_BIN:-k6}"
if [[ -f "$SCRIPT_DIR/../bin/k6-http3" ]]; then
  K6_BIN="$SCRIPT_DIR/../bin/k6-http3"
fi

say "5a: Persistence Test (1-hour soak)"
export MODE="persistence"
export PERSISTENCE_H2_RATE="50"
export PERSISTENCE_H3_RATE="25"
export PERSISTENCE_DURATION="3600s"
"$K6_BIN" run \
  --summary-export="$RESULTS_DIR/k6-persistence-summary.json" \
  "$SCRIPT_DIR/load/k6-limit-test-comprehensive.js" \
  > "$RESULTS_DIR/07-k6-persistence.log" 2>&1 || warn "Persistence test had issues"

say "5b: Limit Test (Absolute Max with Percentiles)"
export MODE="limit"
export H2_RATE="${K6_H2_MAX_RATE:-250}"
export H3_RATE="${K6_H3_MAX_RATE:-150}"
export DURATION="300s"
"$K6_BIN" run \
  --summary-export="$RESULTS_DIR/k6-limit-summary.json" \
  --out json="$RESULTS_DIR/k6-limit-results.json" \
  "$SCRIPT_DIR/load/k6-limit-test-comprehensive.js" \
  > "$RESULTS_DIR/08-k6-limit.log" 2>&1 || warn "Limit test had issues"

# Extract percentiles
if [[ -f "$RESULTS_DIR/k6-limit-results.json" ]]; then
  say "5c: Extracting Percentile Analysis"
  python3 << 'PYEOF' > "$RESULTS_DIR/09-percentiles.txt" 2>&1 || true
import json
import sys

try:
    with open('$RESULTS_DIR/k6-limit-results.json', 'r') as f:
        data = json.load(f)
    
    print("=== Comprehensive Percentile Analysis ===")
    print("")
    
    if 'metrics' in data:
        for metric_name in ['h2_latency_ms', 'h3_latency_ms']:
            if metric_name in data['metrics']:
                metric = data['metrics'][metric_name]
                if 'values' in metric and 'p' in metric['values']:
                    p_values = metric['values']['p']
                    print(f"{metric_name}:")
                    percentiles = {
                        '0.90': 'p90', '0.95': 'p95', '0.99': 'p99',
                        '0.999': 'p999', '0.9999': 'p9999', '0.99999': 'p99999',
                        '0.999999': 'p999999', '0.9999999': 'p9999999', '1.0': 'p100'
                    }
                    for key, label in percentiles.items():
                        if key in p_values:
                            print(f"  {label}: {p_values[key]:.2f}ms")
                    print("")
except Exception as e:
    print(f"Error: {e}")
PYEOF
fi

say "=== Final Test Suite Complete ==="
ok "All tests executed - see $RESULTS_DIR/ for results"
echo ""
echo "Key Results:"
echo "  - Query Analysis: $RESULTS_DIR/01-analysis.log"
echo "  - Query Optimization: $RESULTS_DIR/02-optimization.log"
echo "  - Query Plans: $RESULTS_DIR/03-query-plans.log"
echo "  - Smoke Tests: $RESULTS_DIR/04-smoke-baseline.log, $RESULTS_DIR/05-smoke-wire.log"
echo "  - Rotation Limit: $RESULTS_DIR/06-rotation-limit.log"
echo "  - k6 Persistence: $RESULTS_DIR/07-k6-persistence.log"
echo "  - k6 Limit: $RESULTS_DIR/08-k6-limit.log"
if [[ -f "$RESULTS_DIR/09-percentiles.txt" ]]; then
  echo "  - Percentiles: $RESULTS_DIR/09-percentiles.txt"
  cat "$RESULTS_DIR/09-percentiles.txt"
fi
