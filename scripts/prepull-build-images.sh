#!/usr/bin/env bash
# Pre-pull all base images used by platform Dockerfiles so builds don't hit Docker Hub during build.
# Run when network is good (e.g. VPN on, or retry until success). Then BUILD_NETWORK=host builds use cache.
# Usage: ./scripts/prepull-build-images.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# From services/*/Dockerfile: syntax directive + all FROM images (deduplicated)
IMAGES=(
  docker/dockerfile:1
  node:20-alpine
  node:20-bookworm-slim
  python:3.11-slim
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

say "Pre-pulling build base images (Docker Hub)..."
for img in "${IMAGES[@]}"; do
  if docker pull "$img" 2>&1; then
    ok "Pulled $img"
  else
    warn "Failed to pull $img (will retry once)"
    sleep 2
    docker pull "$img" 2>&1 && ok "Pulled $img (retry)" || { warn "Skip $img"; }
  fi
done
ok "Done. Run BUILD_NETWORK=host ./scripts/build-and-load-k3d.sh to build without daemon hitting Docker Hub for these."
