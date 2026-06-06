#!/usr/bin/env bash
# Fix Social Service targetPort issue (http -> 4006)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Fixing Social Service targetPort ==="

# Check current service configuration
SOCIAL_SVC=$(kubectl get svc -n record-platform social-service -o json 2>/dev/null || echo "")

if [[ -z "$SOCIAL_SVC" ]]; then
  warn "Social service not found"
  exit 1
fi

TARGET_PORT=$(echo "$SOCIAL_SVC" | jq -r '.spec.ports[0].targetPort' 2>/dev/null || echo "")

if [[ "$TARGET_PORT" == "4006" ]]; then
  ok "Social service targetPort is already correct (4006)"
  exit 0
fi

warn "Current targetPort: $TARGET_PORT (should be 4006)"

# Patch the service
say "Patching social-service targetPort to 4006..."
kubectl patch svc -n record-platform social-service --type='json' \
  -p='[{"op": "replace", "path": "/spec/ports/0/targetPort", "value": 4006}]' 2>&1

if [[ $? -eq 0 ]]; then
  ok "Social service targetPort patched to 4006"
  
  # Verify the change
  sleep 2
  NEW_TARGET_PORT=$(kubectl get svc -n record-platform social-service -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || echo "")
  if [[ "$NEW_TARGET_PORT" == "4006" ]]; then
    ok "Verification: targetPort is now 4006"
  else
    warn "Verification failed: targetPort is $NEW_TARGET_PORT"
  fi
else
  warn "Failed to patch social-service targetPort"
  exit 1
fi
