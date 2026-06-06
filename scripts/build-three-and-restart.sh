#!/usr/bin/env bash
# Build listings-service, analytics-service, python-ai-service; push to registry; restart deployments.
# Usage: ./scripts/build-three-and-restart.sh
# Same env vars as build-and-push-dev.sh (K3D_REGISTRY, BUILD_NETWORK).
#
# k3d: pushes to registry, then kubectl set image + rollout restart.
# Colima: listings/shopping use record-platform-*-service:latest; others use :dev.
#   For listings we also tag as record-platform-listings-service:latest when COLIMA=1.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REG="${K3D_REGISTRY:-k3d-record-platform-registry:5000}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")

SERVICES=(listings-service analytics-service python-ai-service)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

_build_net=()
[[ "${BUILD_NETWORK:-}" == "host" ]] && _build_net=(--network host) && say "Using host network for build (BUILD_NETWORK=host)"

say "Building ${SERVICES[*]}..."

for svc in "${SERVICES[@]}"; do
  if [[ ! -f "services/$svc/Dockerfile" ]]; then
    warn "Skipping $svc (no Dockerfile)"
    continue
  fi
  say "🔨 Building $svc..."
  docker build "${_build_net[@]}" -t "$svc:dev" -f "services/$svc/Dockerfile" . || { warn "Build $svc failed"; exit 1; }
  # Colima deploy uses record-platform-listings-service:latest
  if [[ "$svc" == "listings-service" ]] && [[ "$ctx" == *"colima"* ]]; then
    docker tag "$svc:dev" "record-platform-listings-service:latest"
    ok "Tagged record-platform-listings-service:latest (Colima)"
  fi
  # k3d: push to registry
  if [[ "$ctx" == *"k3d"* ]]; then
    say "🏷 Tagging $svc -> $REG/$svc:dev"
    docker tag "$svc:dev" "$REG/$svc:dev"
    say "🚀 Pushing $REG/$svc:dev"
    if ! docker push "$REG/$svc:dev" 2>/dev/null; then
      warn "Push to $REG failed, trying 127.0.0.1:5000..."
      docker tag "$REG/$svc:dev" "127.0.0.1:5000/$svc:dev"
      docker push "127.0.0.1:5000/$svc:dev" || { warn "Push $svc failed"; exit 1; }
    fi
    ok "Pushed $svc:dev"
  fi
done

say "♻️ Restarting deployments..."
if kubectl rollout restart deploy listings-service analytics-service python-ai-service -n record-platform 2>/dev/null; then
  ok "Rollout restarted"
  if [[ "$ctx" == *"k3d"* ]]; then
    say "Patching images to registry (k3d)..."
    for svc in "${SERVICES[@]}"; do
      kubectl set image deploy/$svc -n record-platform app="$REG/$svc:dev" 2>/dev/null && ok "Patched $svc" || true
    done
  fi
else
  warn "kubectl rollout restart failed (cluster down?)"
fi
echo ""
ok "Done. Wait for pods: kubectl get pods -n record-platform -w"
