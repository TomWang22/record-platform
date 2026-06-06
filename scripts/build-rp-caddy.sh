#!/usr/bin/env bash
# Build rp-caddy image from docker/caddy/Dockerfile and load for local k8s (Colima).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${RP_CADDY_IMAGE:-rp-caddy:dev}"
DOCKERFILE="${RP_CADDY_DOCKERFILE:-$REPO_ROOT/docker/caddy/Dockerfile}"

cd "$REPO_ROOT"
echo "Building $IMAGE from $DOCKERFILE ..."
docker build -t "$IMAGE" -f "$DOCKERFILE" "$REPO_ROOT/docker/caddy"

docker image inspect "$IMAGE" --format 'image_id={{.Id}} created={{.Created}}'
# Legacy alias for debug rollout scripts
docker tag "$IMAGE" rp-caddy-debug:dev 2>/dev/null || true

if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  echo "Colima active — loading image into VM ..."
  docker save "$IMAGE" | colima ssh -- docker load
fi

echo "Run: ./scripts/smoke-rp-caddy-tools.sh && ./scripts/smoke-rp-caddy-quic.sh"
