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

# KIND nodes are linux/amd64; build images for that platform on Apple Silicon
PLATFORM="${PLATFORM:-linux/amd64}"

SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  analytics-service
  python-ai-service
  auction-monitor
  cron-jobs
  pgbouncer
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
  DOCKER_BUILDKIT=1 docker build \
    --pull --progress=plain \
    --platform "$PLATFORM" \
    -f "$df" -t "$name:dev" .

  echo "→ Loading $name:dev into kind ($CLUSTER)"
  kind load docker-image "$name:dev" --name "$CLUSTER"
}

for s in "${SERVICES[@]}"; do
  build_one "$s"
done

echo "✅ All images built and loaded into kind:$CLUSTER"
