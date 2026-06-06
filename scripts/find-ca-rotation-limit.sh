#!/usr/bin/env bash
# Incremental CA Rotation Limit Finder
# 
# This script runs k6-find-ca-rotation-limit.js multiple times, incrementally
# increasing load until it finds the limit (error rate > 0% or drops > 1%).
# 
# It runs certificate rotation during each test to find the maximum sustainable
# throughput with zero downtime during rotation.
#
# Usage:
#   ./scripts/find-ca-rotation-limit.sh
#   
#   # Start from specific rates
#   H2_START_RATE=100 H3_START_RATE=50 ./scripts/find-ca-rotation-limit.sh
#
#   # Custom increment steps
#   H2_INCREMENT=20 H3_INCREMENT=10 ./scripts/find-ca-rotation-limit.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Configuration
H2_START_RATE="${H2_START_RATE:-80}"
H3_START_RATE="${H3_START_RATE:-40}"
H2_INCREMENT="${H2_INCREMENT:-10}"
H3_INCREMENT="${H3_INCREMENT:-5}"
H2_MAX_RATE="${H2_MAX_RATE:-300}"
H3_MAX_RATE="${H3_MAX_RATE:-200}"
MAX_ITERATIONS="${MAX_ITERATIONS:-20}"
DURATION="${DURATION:-180s}"

NS_ING="ingress-nginx"
NS_APP="record-platform"
HOST="${HOST:-record.local}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check prerequisites
if ! command -v k6 >/dev/null 2>&1; then
  fail "k6 not installed. Install with: brew install k6"
fi

if ! kubectl -n "$NS_ING" get deploy caddy-h3 >/dev/null 2>&1; then
  fail "Caddy deployment not found in namespace $NS_ING"
fi

# Results directory
RESULTS_DIR="/tmp/ca-rotation-limit-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

say "=== CA Rotation Limit Finder ==="
echo "Starting rates: H2=${H2_START_RATE} req/s, H3=${H3_START_RATE} req/s"
echo "Increment: H2=${H2_INCREMENT} req/s, H3=${H3_INCREMENT} req/s"
echo "Max rates: H2=${H2_MAX_RATE} req/s, H3=${H3_MAX_RATE} req/s"
echo "Results directory: $RESULTS_DIR"
echo ""

# Initialize current rates
current_h2_rate=$H2_START_RATE
current_h3_rate=$H3_START_RATE
iteration=0
limit_found=false
last_successful_h2=$H2_START_RATE
last_successful_h3=$H3_START_RATE

# Run iterations until limit found or max iterations reached
while [[ $iteration -lt $MAX_ITERATIONS ]] && [[ "$limit_found" == "false" ]]; do
  iteration=$((iteration + 1))
  
  say "Iteration $iteration: H2=${current_h2_rate} req/s, H3=${current_h3_rate} req/s"
  
  # Run rotation suite in background (triggers rotation during test)
  say "Starting certificate rotation..."
  (
    "$SCRIPT_DIR/rotation-suite.sh" > "$RESULTS_DIR/rotation-iter${iteration}.log" 2>&1 &
    ROTATION_PID=$!
    echo $ROTATION_PID > "$RESULTS_DIR/rotation-iter${iteration}.pid"
  ) &
  
  # Wait a moment for rotation to start
  sleep 2
  
  # Run k6 limit finder test
  say "Running k6 limit finder test..."
  K6_OUTPUT="$RESULTS_DIR/k6-iter${iteration}.json"
  K6_LOG="$RESULTS_DIR/k6-iter${iteration}.log"
  
  H2_RATE=$current_h2_rate \
  H3_RATE=$current_h3_rate \
  H2_START_RATE=$current_h2_rate \
  H3_START_RATE=$current_h3_rate \
  DURATION=$DURATION \
  HOST=$HOST \
  k6 run \
    --out json="$K6_OUTPUT" \
    "$SCRIPT_DIR/load/k6-find-ca-rotation-limit.js" \
    2>&1 | tee "$K6_LOG"
  
  # Wait for rotation to complete
  if [[ -f "$RESULTS_DIR/rotation-iter${iteration}.pid" ]]; then
    ROTATION_PID=$(cat "$RESULTS_DIR/rotation-iter${iteration}.pid")
    wait $ROTATION_PID 2>/dev/null || true
  fi
  
  # Parse results
  if [[ -f "$K6_OUTPUT" ]]; then
    # Extract metrics from k6 JSON output
    H2_FAIL_RATE=$(jq -r '.metrics.h2_fail.values.rate // 0' "$K6_OUTPUT" 2>/dev/null || echo "0")
    H3_FAIL_RATE=$(jq -r '.metrics.h3_fail.values.rate // 0' "$K6_OUTPUT" 2>/dev/null || echo "0")
    DROPPED_RATE=$(jq -r '.metrics.dropped_iterations.values.rate // 0' "$K6_OUTPUT" 2>/dev/null || echo "0")
    
    # Check if limit found
    if (( $(echo "$H2_FAIL_RATE > 0" | bc -l 2>/dev/null || echo "0") )) || \
       (( $(echo "$H3_FAIL_RATE > 0" | bc -l 2>/dev/null || echo "0") )) || \
       (( $(echo "$DROPPED_RATE > 0.01" | bc -l 2>/dev/null || echo "0") )); then
      limit_found=true
      warn "Limit found at iteration $iteration"
      warn "  H2 Rate: ${current_h2_rate} req/s (fail rate: $(printf "%.2f" $(echo "$H2_FAIL_RATE * 100" | bc -l)))%"
      warn "  H3 Rate: ${current_h3_rate} req/s (fail rate: $(printf "%.2f" $(echo "$H3_FAIL_RATE * 100" | bc -l)))%"
      warn "  Dropped: $(printf "%.2f" $(echo "$DROPPED_RATE * 100" | bc -l))%"
      ok "Last successful rates: H2=${last_successful_h2} req/s, H3=${last_successful_h3} req/s"
    else
      ok "Iteration $iteration passed: No errors"
      last_successful_h2=$current_h2_rate
      last_successful_h3=$current_h3_rate
      
      # Increment rates for next iteration
      current_h2_rate=$((current_h2_rate + H2_INCREMENT))
      current_h3_rate=$((current_h3_rate + H3_INCREMENT))
      
      # Check max rates
      if [[ $current_h2_rate -gt $H2_MAX_RATE ]]; then
        warn "H2 rate exceeds max ($H2_MAX_RATE), stopping"
        limit_found=true
      fi
      if [[ $current_h3_rate -gt $H3_MAX_RATE ]]; then
        warn "H3 rate exceeds max ($H3_MAX_RATE), stopping"
        limit_found=true
      fi
    fi
  else
    warn "k6 output file not found, assuming failure"
    limit_found=true
  fi
  
  echo ""
done

# Final summary
say "=== Limit Finding Complete ==="
echo "Total iterations: $iteration"
echo "Last successful rates:"
echo "  H2: ${last_successful_h2} req/s"
echo "  H3: ${last_successful_h3} req/s"
echo "  Combined: $((last_successful_h2 + last_successful_h3)) req/s"
echo ""
echo "Results directory: $RESULTS_DIR"
echo ""
echo "To review results:"
echo "  cat $RESULTS_DIR/k6-iter*.log"
echo "  jq '.metrics' $RESULTS_DIR/k6-iter*.json"
