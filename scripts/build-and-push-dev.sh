#!/usr/bin/env bash
# Build all app :dev images, tag with canonical registry hostname, push, then restart deployments.
# Single pipeline so cluster always pulls k3d-record-platform-registry:5000/<service>:dev (no localhost, no Docker Hub fallback).
# Usage: ./scripts/build-and-push-dev.sh
# Env: BUILD_NETWORK=host — use host network for build RUN steps (fixes pnpm ERR_SOCKET_TIMEOUT in Colima).
# Requires: k3d cluster and registry running. If push fails with "could not resolve host", add:
#   127.0.0.1 k3d-record-platform-registry
# to /etc/hosts (registry is on localhost:5000 but cluster expects that hostname).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REG="${K3D_REGISTRY:-k3d-record-platform-registry:5000}"
CLUSTER="${K3D_CLUSTER:-record-platform}"

SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  analytics-service
  python-ai-service
  messaging-service
  shopping-service
  auction-monitor
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# Use host network for build when npm/pnpm times out in Colima (RUN steps use host's network stack)
_build_net=()
[[ "${BUILD_NETWORK:-}" == "host" ]] && _build_net=(--network host) && say "Using host network for build (BUILD_NETWORK=host)"

say "Building, tagging, and pushing to $REG (canonical; cluster pulls this ref)..."

for svc in "${SERVICES[@]}"; do
  if [[ ! -f "services/$svc/Dockerfile" ]]; then
    warn "Skipping $svc (no services/$svc/Dockerfile)"
    continue
  fi
  say "🔨 Building $svc..."
  docker build "${_build_net[@]}" -t "$svc:dev" -f "services/$svc/Dockerfile" . || { warn "Build $svc failed"; continue; }
  say "🏷 Tagging $svc -> $REG/$svc:dev"
  docker tag "$svc:dev" "$REG/$svc:dev"
  say "🚀 Pushing $REG/$svc:dev"
  _push_err=""
  if ! _push_err=$(docker push "$REG/$svc:dev" 2>&1); then
    warn "Push to $REG failed, trying 127.0.0.1:5000..."
    docker tag "$REG/$svc:dev" "127.0.0.1:5000/$svc:dev"
    if docker push "127.0.0.1:5000/$svc:dev" 2>/dev/null; then
      ok "Pushed $svc:dev via 127.0.0.1:5000 (cluster needs canonical ref: run ./scripts/push-dev-images-to-registry.sh after adding insecure-registries)"
    else
      warn "Push $svc failed. Add to Colima daemon insecure-registries: k3d-record-platform-registry:5000 and 127.0.0.1:5000, restart Docker, then ./scripts/push-dev-images-to-registry.sh"
      echo "  Error: $(echo "$_push_err" | head -1)"
    fi
  else
    ok "Pushed $svc:dev"
  fi
done

say "♻️ Restarting deployments in record-platform..."
kubectl rollout restart deploy -n record-platform 2>/dev/null && ok "Rollout restarted" || warn "kubectl rollout restart failed (cluster down?)"
echo ""
ok "Done. Wait for pods: kubectl get pods -n record-platform -w"
