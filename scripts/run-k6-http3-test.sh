#!/usr/bin/env bash
set -euo pipefail

# Script to run k6 HTTP/3 tests
# This script uses the custom k6 binary with HTTP/3 support if available,
# otherwise falls back to standard k6 (which may use HTTP/2)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

K6_BINARY="${K6_HTTP3_BINARY:-}"
if [[ -z "$K6_BINARY" ]]; then
  # Try to find custom k6-http3 binary
  if [[ -f "$(pwd)/.k6-build/bin/k6-http3" ]]; then
    K6_BINARY="$(pwd)/.k6-build/bin/k6-http3"
    ok "Using custom k6-http3 binary: $K6_BINARY"
  elif [[ -f "$(pwd)/.k6-build/k6-http3" ]]; then
    K6_BINARY="$(pwd)/.k6-build/k6-http3"
    ok "Using custom k6-http3 binary: $K6_BINARY"
  else
    # Use standard k6
    K6_BINARY="k6"
    warn "Custom k6-http3 binary not found. Using standard k6 (may fall back to HTTP/2)"
    warn "To build custom k6 with HTTP/3: ./scripts/build-k6-http3.sh"
  fi
fi

# Test configuration
BASE_URL="${BASE_URL:-https://record.local:30443}"
HOST="${HOST:-record.local}"
VUS="${VUS:-5}"
DURATION="${DURATION:-30s}"

say "=== Running k6 HTTP/3 Test ==="
say "Binary: $K6_BINARY"
say "URL: $BASE_URL"
say "VUs: $VUS, Duration: $DURATION"

# Check if binary exists
if ! command -v "$K6_BINARY" >/dev/null 2>&1 && [[ ! -f "$K6_BINARY" ]]; then
  warn "k6 binary not found: $K6_BINARY"
  warn "Falling back to standard k6..."
  K6_BINARY="k6"
fi

# Run the test
"$K6_BINARY" run \
  --vus "$VUS" \
  --duration "$DURATION" \
  -e "BASE_URL=$BASE_URL" \
  -e "HOST=$HOST" \
  scripts/load/k6-http3-toolchain.js

say "Test complete!"

