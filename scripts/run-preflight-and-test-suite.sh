#!/usr/bin/env bash
# Run preflight, then test suite with timestamped output
# Handles terminal wraparound by timestamping all output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Timestamp function for all output (handles terminal wraparound)
timestamp() {
  while IFS= read -r line; do
    # Preserve color codes and add timestamp
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $line"
  done
}

# Function to add timestamps to command output
run_with_timestamps() {
  local log_file="$1"
  shift
  local cmd="$*"
  
  # Run command with timestamps, preserving colors
  eval "$cmd" 2>&1 | while IFS= read -r line; do
    timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
    echo "$timestamped" | tee -a "$log_file"
  done
  return ${PIPESTATUS[0]}
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="$REPO_ROOT/test-results/${TIMESTAMP}-preflight-and-tests"
mkdir -p "$RESULTS_DIR"

MAIN_LOG="$RESULTS_DIR/main.log"
PREFLIGHT_LOG="$RESULTS_DIR/preflight.log"
TEST_SUITE_LOG="$RESULTS_DIR/test-suite.log"

# Function to run command with timestamping and logging (better version)
run_with_timestamps_v2() {
  local log_file="$1"
  shift
  local cmd="$*"
  
  say "Running: $cmd"
  say "Output logged to: $log_file"
  
  # Create log file
  touch "$log_file"
  
  # Run command, add timestamps, and save to log
  eval "$cmd" 2>&1 | while IFS= read -r line; do
    timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
    echo "$timestamped" | tee -a "$log_file"
  done
  return ${PIPESTATUS[0]}
}

say "=== Preflight and Test Suite Runner ==="
echo "Results directory: $RESULTS_DIR"
echo "Main log: $MAIN_LOG"
echo "All output will be timestamped to handle terminal wraparound"
echo ""

# Step 0: Investigate gRPC NodePort and Messaging Service Issues
say "=== Step 0: Investigating gRPC NodePort and Messaging Service Issues ==="
INVESTIGATION_LOG="$RESULTS_DIR/investigation.log"
if [[ -f "$SCRIPT_DIR/investigate-grpc-social-issues.sh" ]]; then
  say "Running investigation before tests..."
  "$SCRIPT_DIR/investigate-grpc-social-issues.sh" 2>&1 | while IFS= read -r line; do
    timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
    echo "$timestamped" | tee -a "$INVESTIGATION_LOG" | tee -a "$MAIN_LOG"
  done
  INVESTIGATION_EXIT=${PIPESTATUS[0]}
  if [[ $INVESTIGATION_EXIT -eq 0 ]]; then
    ok "Investigation completed"
  else
    warn "Investigation completed with issues (exit $INVESTIGATION_EXIT)"
  fi
  
  # Attempt to fix messaging-plane targetPort if needed
  if [[ -f "$SCRIPT_DIR/fix-messaging-service-targetport.sh" ]]; then
    say "Attempting to fix messaging-plane targetPort issue..."
    "$SCRIPT_DIR/fix-messaging-service-targetport.sh" 2>&1 | while IFS= read -r line; do
      timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
      echo "$timestamped" | tee -a "$INVESTIGATION_LOG" | tee -a "$MAIN_LOG"
    done
    FIX_EXIT=${PIPESTATUS[0]}
    if [[ $FIX_EXIT -eq 0 ]]; then
      ok "messaging-plane fix attempted"
    fi
  fi
else
  warn "Investigation script not found - skipping"
fi

echo ""
say "=== Step 1: Running Preflight ==="
say "All output will be timestamped to handle terminal wraparound"
"$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | while IFS= read -r line; do
  timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
  echo "$timestamped" | tee -a "$PREFLIGHT_LOG" | tee -a "$MAIN_LOG"
done
PREFLIGHT_EXIT=${PIPESTATUS[0]}

if [[ $PREFLIGHT_EXIT -eq 0 ]]; then
  ok "Preflight completed successfully"
else
  warn "Preflight completed with exit code: $PREFLIGHT_EXIT"
  # Continue anyway - preflight may have warnings but tests can still run
fi

echo ""
say "=== Step 2: Running Test Suite ==="
say "All output will be timestamped to handle terminal wraparound"

# Step 2: Run test suite (run-all-test-suites.sh)
"$SCRIPT_DIR/run-all-test-suites.sh" 2>&1 | while IFS= read -r line; do
  timestamped="[$(date +'%Y-%m-%d %H:%M:%S')] $line"
  echo "$timestamped" | tee -a "$TEST_SUITE_LOG" | tee -a "$MAIN_LOG"
done
TEST_EXIT=${PIPESTATUS[0]}

if [[ $TEST_EXIT -eq 0 ]]; then
  ok "Test suite completed successfully"
else
  warn "Test suite completed with exit code: $TEST_EXIT"
fi

# Step 3: Generate summary
say "=== Generating Summary ==="
cat > "$RESULTS_DIR/SUMMARY.md" <<EOF
# Preflight and Test Suite Results

**Date**: $(date)
**Results Directory**: $RESULTS_DIR

## Log Files

- **Investigation Log**: \`investigation.log\` (gRPC NodePort and Messaging Service diagnostics)
- **Main Log**: \`main.log\`
- **Preflight Log**: \`preflight.log\`
- **Test Suite Log**: \`test-suite.log\`

## Exit Codes

- Investigation: ${INVESTIGATION_EXIT:-0}
- Preflight: ${PREFLIGHT_EXIT:-0}
- Test Suite: ${TEST_EXIT:-0}

## Quick Analysis

\`\`\`bash
# View all results with timestamps
cat $RESULTS_DIR/*.log | grep -E '(✅|❌|⚠️|FAILED|error|PASSED)'

# Analyze test results
$SCRIPT_DIR/analyze-test-results.sh $RESULTS_DIR
\`\`\`

## Next Steps

1. Review logs in: $RESULTS_DIR
2. Check comprehensive verification: Look for \`comprehensive-verification.log\` in suite logs
3. Analyze results: \`$SCRIPT_DIR/analyze-test-results.sh $RESULTS_DIR\`
EOF

ok "Summary generated: $RESULTS_DIR/SUMMARY.md"

say "=== Complete ==="
ok "All results saved to: $RESULTS_DIR"
echo ""
echo "To view results:"
echo "  cat $RESULTS_DIR/*.log"
echo ""
echo "To analyze:"
echo "  $SCRIPT_DIR/analyze-test-results.sh $RESULTS_DIR"

exit ${TEST_EXIT:-0}
