#!/usr/bin/env bash
set -euo pipefail

CLUSTER="${1:-h3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "❌ kind cluster '$CLUSTER' not found."
  echo "   Create it (e.g. 'kind create cluster --name $CLUSTER') and re-run."
  exit 1
fi

# Ensure buildx is available and create builder if needed
if ! docker buildx ls | grep -q "multi-platform"; then
  echo "🔧 Setting up buildx builder for optimized builds..."
  docker buildx create --name multi-platform --use --driver-opt network=host 2>/dev/null || \
    docker buildx use multi-platform 2>/dev/null || true
fi

# Create cache directories for buildx cache
mkdir -p /tmp/.buildx-cache

# Prune old images and volumes to prevent stale image issues and disk space problems
# NOTE: We do NOT prune build cache here to preserve BuildKit cache mounts for faster builds
echo "🧹 Docker cleanup (preserving BuildKit cache for faster builds)..."
echo "📊 Current Docker disk usage:"
docker system df || true
echo ""
# Remove dangling images only (preserve BuildKit cache)
# Note: docker image prune only removes dangling by default, no filter needed
docker image prune -f || true
# Remove old :dev images before rebuilding (prevents disk space issues)
echo "  Removing old :dev images..."
docker images --format "{{.Repository}}:{{.Tag}}" | grep ":dev$" | xargs -r docker rmi 2>/dev/null || true
# Remove unused volumes (be careful - only removes volumes not attached to containers)
echo "  Pruning unused volumes..."
docker volume prune -f || true
echo "📊 Docker disk usage after cleanup:"
docker system df || true
echo "✅ Cleanup complete (BuildKit cache preserved for faster builds)"
echo "💡 To clear BuildKit cache if needed: docker builder prune -af"

# KIND nodes are linux/amd64; build images for that platform on Apple Silicon
PLATFORM="${PLATFORM:-linux/amd64}"

# Services to build (excluding webapp as it's already built)
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
  cron-jobs
  # webapp - excluded: already built, no changes made
  # pgbouncer - removed: connection pooling not needed yet (postgres is externalized)
)

build_one () {
  local name="$1"
  local df=""
  # Prefer services/<name>/Dockerfile; fallbacks allowed
  if   [ -f "services/$name/Dockerfile" ]; then df="services/$name/Dockerfile"
  elif [ -f "$name/Dockerfile" ];        then df="$name/Dockerfile"
  elif [ -f "Dockerfile.$name" ];        then df="Dockerfile.$name"
  else
    echo "❌ No Dockerfile for '$name' (looked in services/$name/, $name/, Dockerfile.$name)"
    return 1
  fi

  echo "→ Building $name:dev using $df (context: . ; platform: $PLATFORM)"
  # Retry build up to 3 times for network issues
  local retries=3
  local attempt=1
  while [ $attempt -le $retries ]; do
    # Use BuildKit with optimized cache settings for faster builds
    # --cache-from: Use previous build cache if available
    # --cache-to: Export cache for next build (local cache mount)
    # --progress=plain: Better output for CI/CD
    if DOCKER_BUILDKIT=1 docker buildx build \
      --load \
      --pull --progress=plain \
      --platform "$PLATFORM" \
      --rm \
      --build-arg BUILDKIT_INLINE_CACHE=1 \
      --cache-from type=local,src=/tmp/.buildx-cache/$name \
      --cache-to type=local,dest=/tmp/.buildx-cache/$name,mode=max \
      -f "$df" -t "$name:dev" .; then
      break
    fi
    if [ $attempt -eq $retries ]; then
      echo "❌ Failed to build $name after $retries attempts"
      return 1
    fi
    echo "⚠️  Build attempt $attempt failed, retrying in 5 seconds..."
    # Clean build cache on retry to free space
    docker builder prune -f || true
    sleep 5
    attempt=$((attempt + 1))
  done

  echo "→ Loading $name:dev into kind ($CLUSTER)"
  kind load docker-image "$name:dev" --name "$CLUSTER"
  
  # Note: We do NOT prune build cache here to preserve BuildKit cache mounts
  # The cache will be reused for faster subsequent builds
}

# Cleanup function to trim bloat after all builds complete
cleanup_bloat() {
  echo ""
  echo "🧹 Trimming build bloat (preserving BuildKit cache)..."
  
  # Remove dangling images (safe - these are orphaned layers)
  # Note: docker image prune only removes dangling by default, no filter needed
  echo "  Removing dangling images..."
  docker image prune -f || true
  
  # Remove old unused build cache (keep recent cache for BuildKit)
  # This removes cache older than 24 hours that's not being used
  echo "  Removing old unused build cache (keeping recent for BuildKit)..."
  docker builder prune -f --filter "until=24h" || true
  
  # Remove unused volumes (safe - only removes unattached volumes)
  echo "  Removing unused volumes..."
  docker volume prune -f || true
  
  # Remove stopped containers (they take up space)
  echo "  Removing stopped containers..."
  docker container prune -f || true
  
  # Show final disk usage
  echo ""
  echo "📊 Final Docker disk usage:"
  docker system df || true
  
  # Calculate space reclaimed
  echo ""
  echo "✅ Bloat cleanup complete (BuildKit cache preserved)"
  echo "💡 To see detailed breakdown: docker system df -v"
}

for s in "${SERVICES[@]}"; do
  build_one "$s"
done

echo "✅ All images built and loaded into kind:$CLUSTER"

# Ensure Caddy service with NodePort 30443 is preserved
# This prevents the service from being lost during rebuilds
if [ -f "scripts/ensure-caddy-service.sh" ]; then
  bash scripts/ensure-caddy-service.sh || echo "⚠️  Warning: Could not ensure Caddy service (may not be deployed yet)"
fi

# Cleanup bloat after all builds complete (preserves BuildKit cache)
cleanup_bloat
