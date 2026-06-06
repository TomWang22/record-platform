#!/usr/bin/env bash
# Fix kubectl context for Colima/k3s

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }

say "=== Fixing kubectl Context for Colima/k3s ==="

# Try Colima first
if command -v colima >/dev/null 2>&1; then
  say "Checking Colima..."
  if colima status >/dev/null 2>&1; then
    ok "Colima is running"
    # Try to get kubeconfig from Colima
    if colima kubectl -- get nodes >/dev/null 2>&1; then
      ok "Colima kubectl working"
      # Set context if needed
      COLIMA_CTX=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1)
      if [[ -n "$COLIMA_CTX" ]]; then
        kubectl config use-context "$COLIMA_CTX" 2>/dev/null && ok "Using Colima context: $COLIMA_CTX"
      fi
    fi
  else
    warn "Colima not running - start with: colima start"
  fi
fi

# Try k3s
if [[ -f ~/.kube/k3s.yaml ]] || [[ -f /etc/rancher/k3s/k3s.yaml ]]; then
  say "Checking k3s..."
  K3S_CONFIG="${K3S_CONFIG:-~/.kube/k3s.yaml}"
  if [[ -f "$K3S_CONFIG" ]]; then
    export KUBECONFIG="$K3S_CONFIG"
    if kubectl get nodes >/dev/null 2>&1; then
      ok "k3s cluster accessible"
      # Add to main kubeconfig if not present
      kubectl config view --flatten > ~/.kube/config.tmp 2>/dev/null || true
    fi
  fi
fi

# Check if we can access cluster now
if kubectl cluster-info >/dev/null 2>&1; then
  ok "Cluster accessible!"
  kubectl get nodes 2>&1 | head -3
  exit 0
else
  warn "Still cannot access cluster"
  echo ""
  echo "Try:"
  echo "  1. Start Colima: colima start"
  echo "  2. Or set KUBECONFIG for k3s"
  echo "  3. Or check: kubectl config get-contexts"
  exit 1
fi
