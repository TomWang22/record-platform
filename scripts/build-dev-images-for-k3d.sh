#!/usr/bin/env bash
# Build all :dev images required for k3d (no Kind). After this run ./scripts/k3d-registry-push-and-patch.sh to push to registry and patch deployments.
# Usage: ./scripts/build-dev-images-for-k3d.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLATFORM="${PLATFORM:-linux/amd64}"
SERVICES=( api-gateway auth-service records-service listings-service analytics-service python-ai-service messaging-service shopping-service auction-monitor )

for name in "${SERVICES[@]}"; do
  if [[ -f "services/$name/Dockerfile" ]]; then
    echo "→ Building $name:dev (platform: $PLATFORM)..."
    if DOCKER_BUILDKIT=1 docker build --progress=plain -f "services/$name/Dockerfile" -t "$name:dev" .; then
      echo "  OK $name"
    else
      echo "  FAIL $name"
      exit 1
    fi
  else
    echo "  Skip $name (no Dockerfile)"
  fi
done
echo "✅ All :dev images built. Next: ./scripts/k3d-registry-push-and-patch.sh"
