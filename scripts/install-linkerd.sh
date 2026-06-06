#!/usr/bin/env bash
# Install Linkerd service mesh (control plane + CRDs). Run once per cluster.
# Prereqs: linkerd CLI. Install: curl -sL https://run.linkerd.io/install | sh && export PATH=$PATH:$HOME/.linkerd2/bin
# Usage: ./scripts/install-linkerd.sh
#   LINKERD_NAMESPACE=linkerd  (default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

if ! command -v linkerd >/dev/null 2>&1; then
  echo "❌ linkerd CLI not found. Install: curl -sL https://run.linkerd.io/install | sh"
  echo "   Then add linkerd to PATH (e.g. export PATH=\$PATH:\$HOME/.linkerd2/bin)"
  exit 1
fi

echo "Running linkerd check --pre..."
linkerd check --pre 2>/dev/null || true

echo "Installing Linkerd CRDs..."
linkerd install --crds | kubectl apply -f - --request-timeout=120s

echo "Installing Linkerd control plane..."
linkerd install | kubectl apply -f - --request-timeout=120s

echo "Waiting for linkerd control plane to be ready..."
kubectl wait -n linkerd --for=condition=available deployment/linkerd-destination deployment/linkerd-identity --timeout=120s 2>/dev/null || true

echo "✅ Linkerd installed. To inject a namespace: kubectl get deploy -n record-platform -o yaml | linkerd inject - | kubectl apply -f -"
echo "   Or annotate namespace: kubectl annotate namespace record-platform linkerd.io/inject=enabled"
