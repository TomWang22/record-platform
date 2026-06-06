#!/usr/bin/env bash
set -euo pipefail

# Webapp build script that shows real-time progress
# Uses a background monitor to show the build is still running

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${WEBAPP_IMAGE:-record-platform/webapp}"
IMAGE_TAG="${WEBAPP_TAG:-latest}"

say "=== Building Webapp ==="
say "This will take 2-5 minutes. Next.js compilation may pause output."
say "Starting build monitor to show progress..."

export DOCKER_BUILDKIT=1

# Start a background process to show the build is still running
(
  while true; do
    sleep 15
    if pgrep -f "docker build.*webapp" > /dev/null; then
      echo ""
      echo "[$(date +%H:%M:%S)] ⏳ Build still running... (Next.js is compiling)"
    else
      break
    fi
  done
) &
MONITOR_PID=$!

# Build with plain progress - shows ALL output
# Next.js output may be buffered, but Docker BuildKit will show progress
docker build \
  --progress=plain \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" \
  -f webapp/Dockerfile \
  "$PROJECT_ROOT"

BUILD_EXIT=$?

# Kill the monitor
kill $MONITOR_PID 2>/dev/null || true
wait $MONITOR_PID 2>/dev/null || true

if [[ $BUILD_EXIT -eq 0 ]]; then
  ok "Webapp image built: ${IMAGE_NAME}:${IMAGE_TAG}"
  IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}" | head -1)
  ok "Image size: $IMAGE_SIZE"
  say "To load into Kind: docker save ${IMAGE_NAME}:${IMAGE_TAG} | kind load docker-image ${IMAGE_NAME}:${IMAGE_TAG} --name h3"
else
  warn "Build failed (exit code: $BUILD_EXIT)"
  exit 1
fi
