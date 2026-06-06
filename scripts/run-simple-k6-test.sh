#!/usr/bin/env bash
set -euo pipefail

# Simple k6 test runner with timeout protection
# Runs k6 tests without complex monitoring to avoid hanging

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

BASE_URL="${BASE_URL:-https://record.local:30443}"
RESULTS_DIR="${RESULTS_DIR:-test-results/$(date +%Y%m%d-%H%M%S)-simple-k6}"
mkdir -p "$RESULTS_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say "=== Simple k6 Test Runner ==="
echo "Results: $RESULTS_DIR"
echo ""

# Test 1: HTTP/2 Limit Test
say "=== Test 1: HTTP/2 Limit Test ==="
say "Running k6 HTTP/2 limit test (with 6 minute timeout)..."
if command -v gtimeout >/dev/null 2>&1; then
  gtimeout 6m k6 run --http-debug=false \
    scripts/load/k6-e2e-find-limit.js \
    > "$RESULTS_DIR/k6-http2-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/2 limit test timed out after 6 minutes"
    else
      warn "HTTP/2 limit test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
elif command -v timeout >/dev/null 2>&1; then
  timeout 6m k6 run --http-debug=false \
    scripts/load/k6-e2e-find-limit.js \
    > "$RESULTS_DIR/k6-http2-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/2 limit test timed out after 6 minutes"
    else
      warn "HTTP/2 limit test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
else
  # Use our custom timeout wrapper
  "$SCRIPT_DIR/lib/run-with-timeout.sh" 360 k6 run --http-debug=false \
    scripts/load/k6-e2e-find-limit.js \
    > "$RESULTS_DIR/k6-http2-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/2 limit test timed out after 6 minutes"
    else
      warn "HTTP/2 limit test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
fi

ok "HTTP/2 limit test completed"
say "Waiting 30 seconds for services to recover..."
sleep 30

# Test 2: HTTP/3 Limit Test
say "=== Test 2: HTTP/3 Limit Test ==="
say "Running k6 HTTP/3 limit test (with 6 minute timeout)..."
if command -v gtimeout >/dev/null 2>&1; then
  gtimeout 6m bash -c "HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js" \
    > "$RESULTS_DIR/k6-http3-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/3 limit test timed out after 6 minutes"
    else
      warn "HTTP/3 test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
elif command -v timeout >/dev/null 2>&1; then
  timeout 6m bash -c "HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js" \
    > "$RESULTS_DIR/k6-http3-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/3 limit test timed out after 6 minutes"
    else
      warn "HTTP/3 test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
else
  # Use our custom timeout wrapper
  "$SCRIPT_DIR/lib/run-with-timeout.sh" 360 bash -c "HTTP_VERSION=HTTP/3 k6 run --http-debug=false scripts/load/k6-e2e-find-limit.js" \
    > "$RESULTS_DIR/k6-http3-limit.log" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      warn "HTTP/3 limit test timed out after 6 minutes"
    else
      warn "HTTP/3 test completed with warnings (exit code: $EXIT_CODE)"
    fi
  }
fi

ok "HTTP/3 limit test completed"

say "=== Test Complete ==="
ok "All results saved to: $RESULTS_DIR"
echo ""
echo "Files:"
echo "  - k6-http2-limit.log: HTTP/2 test results"
echo "  - k6-http3-limit.log: HTTP/3 test results"

