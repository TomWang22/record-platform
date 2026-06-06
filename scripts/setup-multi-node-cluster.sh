#!/usr/bin/env bash
set -euo pipefail

# Script to set up multi-node Kind cluster for zero-downtime CA rotation
# This allows 2+ replicas with hostNetwork (one pod per node)

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
  say "Cluster '${CLUSTER_NAME}' already exists"
  if [[ "$CLUSTER_NAME" == "h3" ]]; then
    warn "⚠️  You're trying to create 'h3' which is your existing cluster!"
    say "To keep your existing cluster, use a different name:"
    echo "  CLUSTER_NAME=h3-multi ./scripts/setup-multi-node-cluster.sh"
    echo ""
    read -p "Delete and recreate 'h3'? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      say "Deleting existing cluster..."
      kind delete cluster --name "${CLUSTER_NAME}"
    else
      say "Keeping existing cluster. Use CLUSTER_NAME=h3-multi to create a new one."
      exit 0
    fi
  else
    say "Cluster exists. Use a different CLUSTER_NAME or delete it first."
    exit 1
  fi
fi

# Create multi-node cluster config
say "Creating multi-node Kind cluster configuration..."
cat > /tmp/kind-multi-node.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER_NAME}
nodes:
- role: control-plane
  extraPortMappings:
  - containerPort: 443
    hostPort: 8443
    protocol: TCP
  - containerPort: 443
    hostPort: 8443
    protocol: UDP
- role: worker
- role: worker
EOF

ok "Cluster config created"

# Create the cluster
say "Creating multi-node Kind cluster (this may take a few minutes)..."
if kind create cluster --config /tmp/kind-multi-node.yaml --name "${CLUSTER_NAME}"; then
  ok "Multi-node cluster created successfully!"
else
  fail "Failed to create cluster"
fi

# Wait for cluster to be ready
say "Waiting for cluster to be ready..."
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
rm -f /tmp/kind-multi-node.yaml

say "Next steps:"
echo "1. Set up your Kubernetes resources:"
echo "   kubectl apply -k infra/k8s/base"
echo ""
echo "2. Apply production overlay with 2 replicas:"
echo "   kubectl apply -f infra/k8s/overlays/prod/caddy-rolling-update.yaml"
echo ""
echo "3. Verify pods are on different nodes:"
echo "   kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide"
echo ""
echo "4. Test CA rotation:"
echo "   ./scripts/test-full-chain-with-rotation.sh"
echo ""
ok "Multi-node cluster setup complete!"

