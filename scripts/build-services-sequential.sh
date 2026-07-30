#!/usr/bin/env bash
set -euo pipefail

CLUSTER="${1:-h3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Services to build (one at a time)
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
)

PLATFORM="${PLATFORM:-linux/amd64}"

build_one() {
  local name="$1"
  local df=""
  
  if [ -f "services/$name/Dockerfile" ]; then 
    df="services/$name/Dockerfile"
  elif [ -f "$name/Dockerfile" ]; then 
    df="$name/Dockerfile"
  else
    echo "❌ No Dockerfile for '$name'"
    return 1
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔨 Building: $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   Dockerfile: $df"
  echo "   Platform: $PLATFORM"
  echo "   Tag: $name:dev"
  echo ""
  
  local start_time=$(date +%s)
  
  if DOCKER_BUILDKIT=1 docker buildx build \
    --load \
    --pull --progress=plain \
    --platform "$PLATFORM" \
    --rm \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    -f "$df" -t "$name:dev" .; then
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo ""
    echo "✅ $name built successfully (${duration}s)"
  else
    echo ""
    echo "❌ Failed to build $name"
    return 1
  fi

  echo ""
  echo "📦 Loading $name:dev into kind cluster ($CLUSTER)..."
  if kind load docker-image "$name:dev" --name "$CLUSTER"; then
    echo "✅ $name loaded into kind cluster"
  else
    echo "❌ Failed to load $name into kind cluster"
    return 1
  fi
}

# Build each service sequentially
TOTAL=${#SERVICES[@]}
CURRENT=0
FAILED=()

for service in "${SERVICES[@]}"; do
  CURRENT=$((CURRENT + 1))
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "📦 Service $CURRENT of $TOTAL: $service"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  
  if ! build_one "$service"; then
    FAILED+=("$service")
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Build Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ All $TOTAL services built and loaded successfully!"
else
  echo "⚠️  ${#FAILED[@]} service(s) failed: ${FAILED[*]}"
  echo "✅ $((TOTAL - ${#FAILED[@]})) service(s) succeeded"
fi

echo ""
echo "📦 Built images:"
docker images | grep -E "^($(IFS='|'; echo "${SERVICES[*]}"))" | grep ":dev" | head -20
