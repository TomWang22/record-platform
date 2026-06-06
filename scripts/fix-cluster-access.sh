#!/usr/bin/env bash
# Fix cluster access - try both kind and Colima

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }

say "=== Fixing Cluster Access ==="

# Try kind-h3 first (current context)
if kubectl cluster-info >/dev/null 2>&1; then
  ok "Cluster accessible with current context (kind-h3)"
  kubectl get nodes 2>&1 | head -3
  exit 0
fi

warn "Current context (kind-h3) not accessible"

# Check if kind cluster exists
if command -v kind >/dev/null 2>&1; then
  say "Checking kind clusters..."
  KIND_CLUSTERS=$(kind get clusters 2>&1)
  if echo "$KIND_CLUSTERS" | grep -q "h3"; then
    ok "kind-h3 cluster exists"
    # Check if nodes are running
    if docker ps --filter "name=h3-" --format "{{.Names}}" 2>&1 | grep -q "h3-"; then
      ok "kind-h3 nodes are running"
      # Try to access again (may need time to be ready)
      sleep 2
      if kubectl cluster-info >/dev/null 2>&1; then
        ok "Cluster now accessible!"
        exit 0
      fi
    else
      warn "kind-h3 nodes not running - cluster may need to be started"
    fi
  else
    warn "kind-h3 cluster not found"
  fi
fi

# Try Colima
say "Checking Colima Kubernetes..."
if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  ok "Colima is running"
  # Check for Colima context
  COLIMA_CTX=$(kubectl config get-contexts -o name 2>&1 | grep -i colima | head -1)
  if [[ -n "$COLIMA_CTX" ]]; then
    warn "Found Colima context: $COLIMA_CTX"
    kubectl config use-context "$COLIMA_CTX" 2>/dev/null
    if kubectl cluster-info >/dev/null 2>&1; then
      ok "Switched to Colima context - cluster accessible!"
      kubectl get nodes 2>&1 | head -3
      exit 0
    fi
  else
    warn "No Colima context found in kubeconfig"
  fi
fi

fail "Cannot access cluster - manual intervention needed"
echo ""
echo "Try:"
echo "  1. Start kind cluster: kind create cluster --name h3"
echo "  2. Or configure Colima Kubernetes context"
echo "  3. Or check: kubectl config get-contexts"
exit 1
