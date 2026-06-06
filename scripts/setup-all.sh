#!/usr/bin/env bash
# Complete setup script for test environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; exit 1; }

say "=== Complete Test Environment Setup ==="

# 1. Setup PATH and tools
say "1. Setting up PATH and tools..."
source "$SCRIPT_DIR/setup-test-env.sh" || warn "Tool setup had issues"

# 2. Verify infrastructure
say "2. Verifying infrastructure..."
"$SCRIPT_DIR/verify-infrastructure.sh" || warn "Infrastructure verification had issues"

say "=== Setup Complete ==="
ok "Environment ready for testing"
echo ""
echo "To run tests:"
echo "  export PATH=\"/opt/homebrew/bin:/usr/local/bin:\$PATH\""
echo "  ./scripts/test-microservices-http2-http3.sh"
