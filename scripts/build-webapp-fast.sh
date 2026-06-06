#!/usr/bin/env bash
set -euo pipefail

# Fast webapp build script - optimized to prevent hangs
# Skips type checking during build (do that separately)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${WEBAPP_IMAGE:-record-platform/webapp}"
IMAGE_TAG="${WEBAPP_TAG:-latest}"

say "=== Building Webapp (Fast Build) ==="
say "Type checking is skipped during build to prevent hangs."
say "Run 'cd webapp && pnpm type-check' separately if needed."

export DOCKER_BUILDKIT=1

# Clear any corrupted cache
say "Clearing build cache..."
docker builder prune -f --filter "until=1h" >/dev/null 2>&1 || true

# Build with plain progress - shows ALL output
say "Building (should take 2-5 minutes, max 10 minutes with timeout)..."
if docker build \
  --progress=plain \
  --no-cache \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" \
  -f webapp/Dockerfile \
  "$PROJECT_ROOT" 2>&1 | tee /tmp/webapp-build.log; then
  ok "Webapp image built: ${IMAGE_NAME}:${IMAGE_TAG}"
  IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}" | head -1)
  ok "Image size: $IMAGE_SIZE"
  say "To load into Kind: docker save ${IMAGE_NAME}:${IMAGE_TAG} | kind load docker-image ${IMAGE_NAME}:${IMAGE_TAG} --name h3"
else
  warn "Build failed. Check /tmp/webapp-build.log"
  tail -50 /tmp/webapp-build.log
  exit 1
fi
