#!/usr/bin/env bash
# Build platform service images and load into k3d cluster (record-platform).
# Usage: ./scripts/build-and-load-k3d.sh [cluster-name]
set -euo pipefail
CLUSTER="${1:-record-platform}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! k3d cluster list 2>/dev/null | grep -q "$CLUSTER"; then
  echo "❌ k3d cluster '$CLUSTER' not found."
  exit 1
fi
# Default to host arch so k3d nodes (often arm64 on M1/M2) can pull; override with PLATFORM=linux/amd64 if needed
_arch=$(docker info -f '{{.Architecture}}' 2>/dev/null || uname -m)
[[ "$_arch" == "aarch64" ]] || [[ "$_arch" == "arm64" ]] && _plat="linux/arm64" || _plat="linux/amd64"
PLATFORM="${PLATFORM:-$_plat}"
SERVICES=( api-gateway auth-service records-service listings-service analytics-service python-ai-service messaging-service shopping-service auction-monitor )
build_one() {
  local name="$1" df="" net_opt=()
  if [[ -f "$ROOT/services/$name/Dockerfile" ]]; then df="$ROOT/services/$name/Dockerfile"
  elif [[ -f "$ROOT/$name/Dockerfile" ]]; then df="$ROOT/$name/Dockerfile"
  else echo "❌ No Dockerfile $name"; return 1; fi
  # Use host network for RUN steps when requested (fixes npm/Docker Hub timeouts in many envs)
  [[ "${BUILD_NETWORK:-}" == "host" ]] && net_opt=( --network host )
  echo "→ Building $name:dev (context=$ROOT) ${net_opt[*]}"
  ( cd "$ROOT" && DOCKER_BUILDKIT=1 docker buildx build --load --platform "$PLATFORM" "${net_opt[@]}" -f "$df" -t "$name:dev" . ) || return 1
  echo "→ Loading $name:dev into k3d ($CLUSTER)"
  docker rm -f k3d-"$CLUSTER"-tools 2>/dev/null || true
  k3d image import "$name:dev" -c "$CLUSTER" || return 1
}
for s in "${SERVICES[@]}"; do build_one "$s" || true; done
echo "✅ Done. Restart deployments if needed: kubectl rollout restart deployment -n record-platform"
