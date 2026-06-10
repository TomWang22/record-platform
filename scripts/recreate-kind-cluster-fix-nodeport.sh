#!/usr/bin/env bash
# Fix NodePort TLS connection reset by recreating Kind cluster with correct port mappings
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLUSTER_NAME="h3"
NS="record-platform"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Recreating Kind Cluster to Fix NodePort TLS Issue ==="

# Check if cluster exists
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  fail "Kind cluster '${CLUSTER_NAME}' does not exist"
fi

say "Step 1: Backing up current cluster state..."
# Backup service manifests (if needed)
BACKUP_DIR="${ROOT}/.kind-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
kubectl get svc -n ingress-nginx caddy-h3 -o yaml > "$BACKUP_DIR/caddy-h3-service.yaml" 2>/dev/null || warn "Could not backup caddy-h3 service"
ok "Backup created at: $BACKUP_DIR"

say "Step 2: Deleting existing cluster..."
kind delete cluster --name "$CLUSTER_NAME" || fail "Failed to delete cluster"
ok "Cluster deleted"

say "Step 3: Creating new cluster with fixed configuration..."
kind create cluster --config infra/kind/kind-h3.yaml --name "$CLUSTER_NAME" || fail "Failed to create cluster"
ok "Cluster created"

say "Step 4: Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s || fail "Cluster not ready"
ok "Cluster is ready"

say "Step 5: Verifying NodePort port mapping..."
# Check if port 30443 is accessible (should be via kube-proxy, not extraPortMappings)
sleep 2
if netstat -an 2>/dev/null | grep -q "\.30443.*LISTEN" || lsof -i :30443 2>/dev/null; then
  ok "Port 30443 is listening (via kube-proxy)"
else
  warn "Port 30443 not yet listening (may need service deployment)"
fi

say "Step 6: Next Steps"
echo ""
echo "The cluster has been recreated. You now need to:"
echo "  1. Deploy all services: ./scripts/bootstrap-platform.sh (or equivalent)"
echo "  2. Test NodePort: curl -k https://record.local:30443/_caddy/healthz"
echo ""
echo "The fix: Removed extraPortMappings for 30443 since Kind automatically"
echo "exposes NodePort services. The connection reset was caused by a conflict"
echo "between extraPortMappings and kube-proxy routing."

ok "Cluster recreation complete!"

