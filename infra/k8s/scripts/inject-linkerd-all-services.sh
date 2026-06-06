#!/usr/bin/env bash
# Inject Linkerd into all services in record-platform namespace
# This ensures all services have Linkerd sidecar for service mesh features

set -euo pipefail

NS="record-platform"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Injecting Linkerd into all services ==="

# Check if Linkerd is installed
if ! command -v linkerd >/dev/null 2>&1; then
  fail "Linkerd CLI not found. Install Linkerd first: bash infra/k8s/scripts/install-linkerd.sh"
fi

if ! linkerd check --quiet 2>/dev/null; then
  fail "Linkerd is not healthy. Run: linkerd check"
fi

# Ensure namespace has Linkerd injection enabled
say "Step 1: Enabling Linkerd injection for namespace..."
kubectl annotate namespace "$NS" linkerd.io/inject=enabled --overwrite
ok "Namespace $NS has Linkerd injection enabled"

# Get all deployments in the namespace
say "Step 2: Injecting Linkerd into all deployments..."
DEPLOYMENTS=$(kubectl get deployments -n "$NS" -o jsonpath='{.items[*].metadata.name}')

if [[ -z "$DEPLOYMENTS" ]]; then
  warn "No deployments found in namespace $NS"
  exit 0
fi

for DEPLOYMENT in $DEPLOYMENTS; do
  say "Injecting Linkerd into $DEPLOYMENT..."
  
  # Check if already injected
  if kubectl get deployment "$DEPLOYMENT" -n "$NS" -o yaml | grep -q "linkerd.io/inject"; then
    ok "$DEPLOYMENT already has Linkerd annotation"
  else
    # Inject Linkerd
    kubectl get deployment "$DEPLOYMENT" -n "$NS" -o yaml | \
      linkerd inject - | kubectl apply -f -
    ok "Linkerd injected into $DEPLOYMENT"
    
    # Wait for rollout (non-blocking)
    kubectl rollout status deployment/"$DEPLOYMENT" -n "$NS" --timeout=60s || warn "$DEPLOYMENT rollout taking longer than expected"
  fi
done

say "=== Linkerd Injection Complete ==="
ok "All services in $NS namespace have Linkerd injection enabled"
echo ""
say "Verify injection:"
echo "  kubectl get pods -n $NS"
echo "  # Each pod should have 2 containers (app + linkerd-proxy)"
echo ""
say "Check Linkerd status:"
echo "  linkerd check"
echo "  linkerd viz dashboard"

