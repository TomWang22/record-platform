#!/usr/bin/env bash
set -euo pipefail

# Script to add worker nodes to existing Kind cluster for zero-downtime CA rotation
# This allows 2+ replicas with hostNetwork (one pod per node)

CLUSTER_NAME="${CLUSTER_NAME:-h3}"
NUM_WORKERS="${NUM_WORKERS:-2}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check if kind is installed
if ! command -v kind &> /dev/null; then
  fail "kind is not installed. Install with: brew install kind"
fi

# Check if cluster exists
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  fail "Cluster '${CLUSTER_NAME}' does not exist. Create it first or use setup-multi-node-cluster.sh"
fi

# Check current nodes
say "Current cluster nodes:"
kubectl get nodes

CURRENT_NODES=$(kubectl get nodes --no-headers | wc -l | tr -d ' ')
CURRENT_WORKERS=$(kubectl get nodes --no-headers | grep -v control-plane | wc -l | tr -d ' ')

say "Current cluster state:"
echo "  Total nodes: $CURRENT_NODES"
echo "  Worker nodes: $CURRENT_WORKERS"
echo "  Target worker nodes: $NUM_WORKERS"

if [[ "$CURRENT_WORKERS" -ge "$NUM_WORKERS" ]]; then
  ok "Cluster already has $CURRENT_WORKERS worker nodes (need $NUM_WORKERS)"
  say "No additional nodes needed!"
  exit 0
fi

NEEDED=$((NUM_WORKERS - CURRENT_WORKERS))
say "Need to add $NEEDED worker node(s)..."

# Note: Kind doesn't support adding nodes to existing cluster directly
# We need to use a workaround: create new nodes and join them manually
# OR use kind's experimental node creation

say "⚠️  Note: Kind doesn't natively support adding nodes to existing clusters."
say "We'll use a workaround by creating new Kind 'clusters' as worker nodes."

# For each worker node needed
for i in $(seq 1 $NEEDED); do
  WORKER_NAME="${CLUSTER_NAME}-worker-${i}"
  
  # Check if worker node already exists
  if docker ps --format '{{.Names}}' | grep -q "^${WORKER_NAME}$"; then
    warn "Worker node ${WORKER_NAME} already exists, skipping..."
    continue
  fi
  
  say "Creating worker node: ${WORKER_NAME}..."
  
  # Create a temporary Kind config for the worker
  # We'll create it as a separate "cluster" but configure it to join the main cluster
  cat > /tmp/kind-worker-${i}.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${WORKER_NAME}
nodes:
- role: worker
EOF
  
  # Actually, Kind doesn't support this easily. Let's use a different approach:
  # We'll document the manual steps or use kubectl to create nodes via Docker
  
  warn "Kind limitation: Cannot easily add nodes to existing cluster"
  say "Alternative approach: Use kubectl to scale or migrate to a new multi-node cluster"
  say "See docs/MULTI_NODE_MIGRATION.md for migration options"
  
  # Cleanup
  rm -f /tmp/kind-worker-${i}.yaml
done

say "⚠️  Kind doesn't support adding nodes to existing clusters."
say ""
say "Options:"
echo "1. **Migrate to new multi-node cluster** (recommended):"
echo "   - Create new multi-node cluster with setup-multi-node-cluster.sh"
echo "   - Migrate resources (see docs/MULTI_NODE_MIGRATION.md)"
echo ""
echo "2. **Use different approach for zero-downtime**:"
echo "   - Remove hostNetwork, use NodePort/LoadBalancer"
echo "   - Allows multiple replicas on same node"
echo ""
echo "3. **Accept current limitation**:"
echo "   - Keep 1 replica, accept ~50-70% success during rotation"
echo ""
say "Which option would you prefer?"

