#!/usr/bin/env bash
set -euo pipefail

# Script to create a NEW multi-node Kind cluster (keeps existing cluster intact)
# This allows you to migrate resources without deleting your current cluster

CLUSTER_NAME="${CLUSTER_NAME:-h3-multi}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check if kind is installed
if ! command -v kind &> /dev/null; then
  fail "kind is not installed. Install with: brew install kind"
fi

# Check if cluster already exists
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  warn "Cluster '${CLUSTER_NAME}' already exists"
  say "Options:"
  echo "1. Use a different name: CLUSTER_NAME=h3-new ./scripts/create-multi-node-cluster.sh"
  echo "2. Delete existing: kind delete cluster --name ${CLUSTER_NAME}"
  exit 1
fi

say "Creating NEW multi-node cluster: ${CLUSTER_NAME}"
say "This will NOT affect your existing 'h3' cluster"
echo ""

# Create multi-node cluster config
say "Creating multi-node Kind cluster configuration..."
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

ok "Cluster config created (using port 8444 to avoid conflict with h3 on 8443)"

# Create the cluster
say "Creating multi-node Kind cluster (this may take a few minutes)..."
if kind create cluster --config /tmp/kind-multi-node-${CLUSTER_NAME}.yaml --name "${CLUSTER_NAME}"; then
  ok "Multi-node cluster created successfully!"
else
  fail "Failed to create cluster"
fi

# Wait for cluster to be ready
say "Waiting for cluster to be ready..."
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Verify nodes
say "Cluster nodes:"
kubectl get nodes -o wide

# Verify we have multiple nodes
NODE_COUNT=$(kubectl get nodes --no-headers | wc -l | tr -d ' ')
if [[ "$NODE_COUNT" -ge 3 ]]; then
  ok "Multi-node cluster ready! ($NODE_COUNT nodes: 1 control-plane + $((NODE_COUNT - 1)) workers)"
else
  warn "Expected 3+ nodes, got $NODE_COUNT. Cluster may not be fully ready yet."
fi

# Cleanup temp file
rm -f /tmp/kind-multi-node-${CLUSTER_NAME}.yaml

say "✅ New cluster '${CLUSTER_NAME}' is ready!"
echo ""
say "Next steps:"
echo "1. Switch to new cluster:"
echo "   kubectl config use-context kind-${CLUSTER_NAME}"
echo ""
echo "2. Set up your Kubernetes resources:"
echo "   kubectl apply -k infra/k8s/base"
echo ""
echo "3. Apply production overlay with 2 replicas:"
echo "   kubectl apply -f infra/k8s/overlays/prod/caddy-rolling-update.yaml"
echo ""
echo "4. Verify pods are on different nodes:"
echo "   kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide"
echo ""
echo "5. Test CA rotation:"
echo "   ./scripts/test-full-chain-with-rotation.sh"
echo ""
say "Note: New cluster uses port 8444 (old cluster uses 8443)"
say "You can switch between clusters with: kubectl config use-context kind-<cluster-name>"
echo ""
ok "Multi-node cluster setup complete!"

