#!/usr/bin/env bash
# Create k3d cluster with 2 agents, registry on 5000, and TCP+UDP 30443 published (required for HTTP/3/QUIC).
# Usage: ./scripts/k3d-create-2-node-cluster.sh [cluster-name]
# After create: apply base, install MetalLB, run setup-lb-ip-host-access.sh when using LB IP. See Runbook #54.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER_NAME="${1:-record-platform}"
# Registry base name; k3d registry create prefixes with "k3d-" so container is k3d-record-platform-registry.
REGISTRY_NAME="${CLUSTER_NAME}-registry"
REGISTRY_CONTAINER="k3d-${REGISTRY_NAME}"
REG_PORT="${REG_PORT:-5000}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if ! command -v k3d >/dev/null 2>&1; then
  echo "❌ k3d not found. Install: brew install k3d (or https://k3d.io)"
  exit 1
fi
# k3d needs a working Docker daemon. In Cursor/IDE terminals the Colima socket is often unreachable (docker ps fails).
# Fail fast with clear instructions so the user runs from a shell where Docker works.
if ! docker info >/dev/null 2>&1; then
  _err=$(docker info 2>&1 || true)
  echo "❌ Docker is not reachable. k3d cannot create the cluster from this environment."
  echo ""
  echo "Typical cause: this terminal cannot reach Colima's Docker socket (e.g. IDE vs your shell)."
  echo ""
  echo "Run this script from a terminal where Docker works:"
  echo "  colima status && docker context show && docker ps   # all must succeed"
  echo "  cd $(cd "$REPO_ROOT" && pwd)"
  echo "  ./scripts/k3d-create-2-node-cluster.sh"
  echo ""
  echo "See: docs/K3D_VS_COLIMA_K3S.md §2.4 (run from your machine, not from an environment where docker ps fails)."
  [[ -n "$_err" ]] && echo "Error: $_err" | head -3
  exit 1
fi

if k3d cluster list 2>/dev/null | grep -q "$CLUSTER_NAME"; then
  echo "Cluster $CLUSTER_NAME already exists. Delete first: k3d cluster delete $CLUSTER_NAME"
  exit 1
fi

say "Creating registry $REGISTRY_CONTAINER (port $REG_PORT)..."
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$REGISTRY_CONTAINER"; then
  docker start "$REGISTRY_CONTAINER" 2>/dev/null || true
else
  k3d registry create "$REGISTRY_NAME" --port "$REG_PORT" 2>/dev/null || \
    docker run -d --name "$REGISTRY_CONTAINER" -p 127.0.0.1:${REG_PORT}:5000 --restart=always registry:2 2>/dev/null || true
fi
sleep 2

# Ensure registry is reachable (insecure for local dev)
if ! curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:${REG_PORT}/v2/" 2>/dev/null | grep -qE '200|401'; then
  warn "Registry 127.0.0.1:${REG_PORT} not yet reachable; cluster may still create. Add to Docker insecure registries if push fails."
fi

say "Creating k3d cluster $CLUSTER_NAME (2 agents, 30443 TCP+UDP, registry)..."
# --port 30443:30443@server:0 and 30443:30443/udp@server:0 so NodePort 30443 is published for HTTP/3
k3d cluster create "$CLUSTER_NAME" \
  --agents 2 \
  --registry-use "$REGISTRY_CONTAINER:${REG_PORT}" \
  --port "30443:30443@server:0" \
  --port "30443:30443/udp@server:0" \
  --k3s-arg "--tls-san=127.0.0.1@server:0" \
  --k3s-arg "--tls-san=localhost@server:0" \
  --k3s-arg "--disable=traefik@server:0" \
  --timeout 300s

k3d kubeconfig merge "$CLUSTER_NAME" --kubeconfig-merge-default 2>/dev/null || true
ok "Cluster $CLUSTER_NAME created. Verify UDP 30443: $SCRIPT_DIR/verify-k3d-30443-udp.sh $CLUSTER_NAME"
echo ""
echo "Next: kubectl apply -k $REPO_ROOT/infra/k8s/base (then MetalLB, then preflight or setup-lb-ip-host-access.sh for LB IP)."
