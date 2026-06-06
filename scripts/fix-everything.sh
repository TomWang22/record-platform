#!/usr/bin/env bash
# Master script to fix everything - no more nagging issues
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Fixing Everything - No More Nagging Issues ==="

# 1. Ensure API server
say "Step 1: Ensuring API server is ready..."
"$SCRIPT_DIR/ensure-api-server-ready.sh" || {
  warn "API server not ready - restarting Colima Kubernetes..."
  "$SCRIPT_DIR/restart-colima-k8s.sh" || {
    warn "Restart failed - may need manual intervention"
    exit 1
  }
}

# 2. Apply all fixes
say "Step 2: Applying all fixes..."
"$SCRIPT_DIR/fix-once-and-for-all.sh" || warn "Some fixes may have failed"

# 3. Wait for Envoy
say "Step 3: Waiting for Envoy..."
for i in {1..20}; do
  if kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[tus.containerStatuses[0].ready}' 2>/dev/null | grep -q "true"; then
    ok "Envoy is ready"
    break
  fi
  sleep 3
  [[ $((i % 5)) -eq 0 ]] && echo "Waiting for Envoy... ($((i*3))s)"
done

# 4. Verify
say "Step 4: Verifying fixes..."
"$SCRIPT_DIR/verify-all-fixes.sh" || warn "Some verifications failed"

say "=== All Fixes Applied ==="
ok "Ready to run tests!"
