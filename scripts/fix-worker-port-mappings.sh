#!/usr/bin/env bash
set -euo pipefail

# Script to recreate cluster with port mappings on worker nodes
# This is needed because Caddy pods run on workers with hostNetwork

CLUSTER_NAME="${CLUSTER_NAME:-h3-multi}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "Recreating cluster with port mappings on worker nodes..."

# Delete existing cluster
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  say "Deleting existing cluster..."
  kind delete cluster --name "${CLUSTER_NAME}"
fi

# Create new cluster config with port mappings on all nodes
say "Creating cluster config with worker port mappings..."
cat > /tmp/kind-multi-node-${CLUSTER_NAME}.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER_NAME}
nodes:
- role: control-plane
  extraPortMappings:
  - containerPort: 443
    hostPort: 8444
    protocol: TCP
  - containerPort: 443
    hostPort: 8444
    protocol: UDP
- role: worker
  extraPortMappings:
  - containerPort: 443
    hostPort: 8445
    protocol: TCP
  - containerPort: 443
    hostPort: 8445
    protocol: UDP
- role: worker
  extraPortMappings:
  - containerPort: 443
    hostPort: 8446
    protocol: TCP
  - containerPort: 443
    hostPort: 8446
    protocol: UDP
EOF

# Create cluster
say "Creating cluster..."
kind create cluster --config /tmp/kind-multi-node-${CLUSTER_NAME}.yaml --name "${CLUSTER_NAME}"

# Wait for ready
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Verify port mappings
say "Verifying port mappings..."
docker ps --filter "name=${CLUSTER_NAME}" --format "table {{.Names}}\t{{.Ports}}"

ok "Cluster recreated with worker port mappings!"
say "Note: Pods on worker1 use port 8445, worker2 use 8446"
say "You'll need to update test scripts to handle multiple ports or use a load balancer"

rm -f /tmp/kind-multi-node-${CLUSTER_NAME}.yaml

