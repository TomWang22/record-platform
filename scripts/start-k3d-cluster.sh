#!/usr/bin/env bash
# Get Docker (Colima) reachable and start the k3d cluster so you can run reset/setup and tests.
# Use when: "Cannot connect to the Docker daemon" or "connection refused" to the API.
#
# Usage: ./scripts/start-k3d-cluster.sh
#   CLUSTER_NAME=record-platform (default)
#
# Does: fix DOCKER_HOST for Colima → docker info → if needed colima stop/start → k3d cluster start → kubeconfig merge → next steps.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# ---------------------------------------------------------------------------
# 1. Ensure Docker is reachable (Colima socket or context)
# ---------------------------------------------------------------------------
_ensure_docker() {
  # Prefer Colima context so k3d and docker use the same engine
  if ! docker info >/dev/null 2>&1; then
    _ctx=$(docker context ls -q 2>/dev/null | grep -i colima | head -1)
    if [[ -n "$_ctx" ]]; then
      _host=$(docker context inspect "$_ctx" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
      if [[ -n "$_host" ]]; then
        export DOCKER_HOST="$_host"
        info "Set DOCKER_HOST from context $_ctx"
      fi
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    _colima_sock="$HOME/.colima/default/docker.sock"
    if [[ -S "$_colima_sock" ]] || [[ -f "$_colima_sock" ]]; then
      export DOCKER_HOST="unix://$_colima_sock"
      info "Set DOCKER_HOST to Colima socket"
    fi
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

say "Starting k3d cluster: $CLUSTER_NAME"
echo ""

# 1a. Try to reach Docker
if ! _ensure_docker; then
  warn "Docker not reachable. Restarting Colima to refresh the socket..."
  if command -v colima >/dev/null 2>&1; then
    colima stop 2>/dev/null || true
    sleep 3
    colima start 2>&1 || { warn "colima start failed."; exit 1; }
    sleep 2
    _ensure_docker || true
  fi
fi

if ! docker info >/dev/null 2>&1; then
  warn "Docker still not reachable."
  info "  Run: colima start   then re-run this script."
  info "  Or: docker context use colima   then re-run."
  exit 1
fi
ok "Docker is reachable (DOCKER_HOST=${DOCKER_HOST:-default})"
echo ""

# ---------------------------------------------------------------------------
# 2. Start k3d cluster if it exists
# ---------------------------------------------------------------------------
if ! k3d cluster list 2>/dev/null | grep -q "^$CLUSTER_NAME "; then
  warn "No k3d cluster named '$CLUSTER_NAME' found."
  info "  Create it first: ./scripts/k3d-create-2-node-cluster.sh"
  info "  Then run this script again to start it after a reboot or Colima restart."
  exit 1
fi

info "Starting k3d cluster $CLUSTER_NAME..."
k3d cluster start "$CLUSTER_NAME" 2>&1 || { warn "k3d cluster start failed."; exit 1; }
ok "Cluster started"
echo ""

# ---------------------------------------------------------------------------
# 3. Merge kubeconfig and use k3d context
# ---------------------------------------------------------------------------
k3d kubeconfig merge "$CLUSTER_NAME" 2>/dev/null || true
kubectl config use-context "k3d-$CLUSTER_NAME" 2>/dev/null || true
info "Context: k3d-$CLUSTER_NAME"
echo ""

# ---------------------------------------------------------------------------
# 4. Wait for API (brief) and show next steps
# ---------------------------------------------------------------------------
info "Waiting for API server (up to 30s)..."
for _i in $(seq 1 30); do
  if kubectl get nodes --request-timeout=3 2>/dev/null | grep -q Ready; then
    ok "API server and nodes are up"
    break
  fi
  [[ $_i -eq 30 ]] && warn "API not ready yet; run: kubectl get nodes -w"
  sleep 1
done
echo ""

say "Next steps (table setting + LB IP path)"
echo "  1. Get Caddy/MetalLB IP: kubectl -n ingress-nginx get svc caddy-h3"
echo "  2. Run reset + setup:"
echo "     export LB_IP=<EXTERNAL-IP>  NODEPORT=30443"
echo "     sudo LB_IP=\$LB_IP NODEPORT=\$NODEPORT ./scripts/fix-http3-lb-ip-reset.sh"
echo "     sudo LB_IP=\$LB_IP NODEPORT=\$NODEPORT ./scripts/setup-lb-ip-host-access.sh"
echo "  3. Use Homebrew curl for manual tests: export PATH=\"/opt/homebrew/opt/curl/bin:\$PATH\""
echo ""
info "See: docs/HTTP3-LB-IP-FIX-CHECKLIST.md §0"
