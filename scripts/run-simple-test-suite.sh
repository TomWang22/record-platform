#!/usr/bin/env bash
set -euo pipefail

# Simple Test Suite: Smoke Test + Simple k6 Test
# Runs without complex monitoring to avoid hanging

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/${TIMESTAMP}-simple-test-suite"
mkdir -p "$RESULTS_DIR"

say "=== Simple Test Suite ==="
echo "Results: $RESULTS_DIR"
echo ""

# Step 1: Smoke Test
say "=== Step 1: Smoke Test (gRPC Health Checks) ==="
echo "Running smoke test to verify gRPC health checks..."
./scripts/test-microservices-http2-http3.sh 2>&1 | tee "$RESULTS_DIR/01-smoke-test.log"

SMOKE_EXIT=${PIPESTATUS[0]}
if [[ $SMOKE_EXIT -eq 0 ]]; then
  ok "Smoke test completed"
else
  warn "Smoke test completed with warnings (exit code: $SMOKE_EXIT)"
fi

say "Waiting 10 seconds before next test..."
sleep 10

# Step 2: Simple k6 Test
say "=== Step 2: Simple k6 Test (HTTP/2 and HTTP/3) ==="
echo "Running simple k6 test (no complex monitoring)..."
./scripts/run-simple-k6-test.sh 2>&1 | tee "$RESULTS_DIR/02-simple-k6.log"

K6_EXIT=${PIPESTATUS[0]}
if [[ $K6_EXIT -eq 0 ]]; then
  ok "Simple k6 test completed"
else
  warn "Simple k6 test completed with warnings (exit code: $K6_EXIT)"
fi

# Copy k6 results
SIMPLE_K6_DIR=$(find test-results -name "*simple-k6" -type d | sort | tail -1)
if [[ -n "$SIMPLE_K6_DIR" ]] && [[ -d "$SIMPLE_K6_DIR" ]]; then
  cp -r "$SIMPLE_K6_DIR"/* "$RESULTS_DIR/k6-results/" 2>/dev/null || mkdir -p "$RESULTS_DIR/k6-results" && cp -r "$SIMPLE_K6_DIR"/* "$RESULTS_DIR/k6-results/" 2>/dev/null || true
  ok "k6 results copied"
fi

# Generate Summary
say "=== Generating Summary ==="
cat > "$RESULTS_DIR/SUMMARY.md" <<EOF
# Simple Test Suite Results

**Date**: $(date)
**Results Directory**: $RESULTS_DIR

## Test Execution Summary

### Step 1: Smoke Test
- **Status**: $(if [[ $SMOKE_EXIT -eq 0 ]]; then echo "✅ Passed"; else echo "⚠️  Completed with warnings"; fi)
- **Log**: \`01-smoke-test.log\`

### Step 2: Simple k6 Test
- **Status**: $(if [[ $K6_EXIT -eq 0 ]]; then echo "✅ Passed"; else echo "⚠️  Completed with warnings"; fi)
- **Log**: \`02-simple-k6.log\`
- **Results**: \`k6-results/\`

## Files Generated

- \`01-smoke-test.log\`: Complete smoke test output
- \`02-simple-k6.log\`: Simple k6 test output
- \`k6-results/\`: k6 test results (HTTP/2 and HTTP/3)
- \`SUMMARY.md\`: This summary

EOF

ok "Summary generated: $RESULTS_DIR/SUMMARY.md"

say "=== Test Suite Complete ==="
ok "All results saved to: $RESULTS_DIR"

if [[ $SMOKE_EXIT -eq 0 ]] && [[ $K6_EXIT -eq 0 ]]; then
  ok "All tests completed successfully"
  exit 0
else
  warn "Some tests had warnings or errors"
  exit 1
fi

