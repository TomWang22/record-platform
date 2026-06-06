#!/usr/bin/env bash
set -euo pipefail

# Fix kubectl connection issues with kind cluster
# This script diagnoses and fixes common Kubernetes connection problems

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

CLUSTER="${KIND_CLUSTER:-h3}"

say "=== Diagnosing kubectl Connection Issues ==="

# 1. Check if cluster container is running
say "1. Checking cluster container..."
if docker ps --format '{{.Names}}' | grep -q "^${CLUSTER}-control-plane$"; then
  ok "Cluster container ${CLUSTER}-control-plane is running"
else
  fail "Cluster container ${CLUSTER}-control-plane is not running"
  say "To start: kind create cluster --name ${CLUSTER}"
  exit 1
fi

# 2. Check node status
say "2. Checking node status..."
NODE_STATUS=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>&1 || echo "Unknown")
if [[ "$NODE_STATUS" == "True" ]]; then
  ok "Node is Ready"
elif [[ "$NODE_STATUS" == "False" ]]; then
  warn "Node is NotReady - attempting to fix..."
  
  # Check CoreDNS
  COREDNS_READY=$(kubectl get pods -n kube-system -l k8s-app=kube-dns -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>&1 || echo "false")
  if [[ "$COREDNS_READY" != "true" ]]; then
    warn "CoreDNS is not ready - restarting..."
    kubectl delete pod -n kube-system -l k8s-app=kube-dns 2>&1 || true
    sleep 5
  fi
  
  # Restart cluster container
  warn "Restarting cluster container..."
  docker restart "${CLUSTER}-control-plane"
  say "Waiting 30s for cluster to stabilize..."
  sleep 30
  
  # Check again
  NODE_STATUS=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>&1 || echo "Unknown")
  if [[ "$NODE_STATUS" == "True" ]]; then
    ok "Node is now Ready after restart"
  else
    warn "Node is still NotReady - may need manual intervention"
  fi
else
  warn "Cannot determine node status: $NODE_STATUS"
fi

# 3. Regenerate kubeconfig
say "3. Regenerating kubeconfig..."
if kind get kubeconfig --name "$CLUSTER" > /tmp/kubeconfig-${CLUSTER}.yaml 2>&1; then
  ok "Kubeconfig regenerated"
  
  # Test with new kubeconfig
  if KUBECONFIG=/tmp/kubeconfig-${CLUSTER}.yaml kubectl get nodes >/dev/null 2>&1; then
    ok "New kubeconfig works"
    warn "To use new kubeconfig: export KUBECONFIG=/tmp/kubeconfig-${CLUSTER}.yaml"
    warn "Or merge: KUBECONFIG=/tmp/kubeconfig-${CLUSTER}.yaml:~/.kube/config kubectl config view --flatten > ~/.kube/config.new && mv ~/.kube/config.new ~/.kube/config"
  else
    warn "New kubeconfig still has issues"
  fi
else
  warn "Failed to regenerate kubeconfig"
fi

# 4. Test kubectl connection
say "4. Testing kubectl connection..."
if kubectl get nodes >/dev/null 2>&1; then
  ok "kubectl connection works"
  kubectl get nodes
else
  fail "kubectl connection still failing"
  say "Troubleshooting steps:"
  say "  1. Check cluster container: docker ps | grep ${CLUSTER}"
  say "  2. Check API server port: nc -zv 127.0.0.1 64313"
  say "  3. Restart cluster: docker restart ${CLUSTER}-control-plane"
  say "  4. Regenerate kubeconfig: kind get kubeconfig --name ${CLUSTER}"
  exit 1
fi

# 5. Check CoreDNS
say "5. Checking CoreDNS..."
COREDNS_PODS=$(kubectl get pods -n kube-system -l k8s-app=kube-dns --no-headers 2>/dev/null | wc -l || echo "0")
if [[ "$COREDNS_PODS" -gt 0 ]]; then
  COREDNS_READY=$(kubectl get pods -n kube-system -l k8s-app=kube-dns -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>&1 || echo "false")
  if [[ "$COREDNS_READY" == "true" ]]; then
    ok "CoreDNS is ready"
  else
    warn "CoreDNS is not ready - restarting..."
    kubectl delete pod -n kube-system -l k8s-app=kube-dns 2>&1 || true
    sleep 5
    kubectl get pods -n kube-system -l k8s-app=kube-dns
  fi
else
  warn "No CoreDNS pods found"
fi

say "=== Diagnosis Complete ==="
say "If kubectl still doesn't work, try:"
say "  1. docker restart ${CLUSTER}-control-plane"
say "  2. sleep 30"
say "  3. kubectl get nodes"

