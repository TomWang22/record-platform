#!/usr/bin/env bash
# Fix kind cluster port in kubeconfig

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

CLUSTER_NAME="${1:-h3}"

echo "=== Fixing kind cluster port for $CLUSTER_NAME ==="

# Get correct port from docker
CORRECT_PORT=$(docker port "${CLUSTER_NAME}-control-plane" 2>&1 | grep 6443 | awk '{print $3}' | cut -d: -f2)

if [[ -z "$CORRECT_PORT" ]]; then
  echo "❌ Could not determine port for ${CLUSTER_NAME}-control-plane"
  exit 1
fi

echo "✅ Found port: $CORRECT_PORT"
echo "Updating kubeconfig..."

kubectl config set-cluster "kind-${CLUSTER_NAME}" --server="https://127.0.0.1:$CORRECT_PORT" 2>&1

sleep 2

if kubectl cluster-info >/dev/null 2>&1; then
  echo "✅ Cluster accessible!"
  kubectl get nodes
else
  echo "❌ Still not accessible"
  exit 1
fi
