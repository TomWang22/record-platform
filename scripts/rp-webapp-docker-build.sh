#!/usr/bin/env bash
# Build webapp:dev from repository root (required Docker context).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f webapp/middleware.ts ]]; then
  echo "❌ webapp/middleware.ts missing — are you at repo root?" >&2
  exit 1
fi

GIT_COMMIT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
RP_WEBAPP_BUILD_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA="$(bash "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" webapp 2>/dev/null || echo unknown)"
IMAGE_TAG="${IMAGE_TAG:-dev}"
NO_CACHE="${NO_CACHE:-0}"

echo "▶ webapp docker build context=$REPO_ROOT GIT_COMMIT=$GIT_COMMIT"
build_args=(
  --build-arg "RP_SOURCE_SHA=$SHA"
  --build-arg "GIT_COMMIT=$GIT_COMMIT"
  --build-arg "RP_WEBAPP_BUILD_AT=$RP_WEBAPP_BUILD_AT"
  --build-arg "RP_WEBAPP_BUILD_SHA=$GIT_COMMIT"
)
cache_flag=()
if [[ "$NO_CACHE" == "1" ]]; then
  cache_flag=(--no-cache)
fi

docker build "${cache_flag[@]}" "${build_args[@]}" -t "webapp:${IMAGE_TAG}" -f webapp/Dockerfile .

docker image inspect "webapp:${IMAGE_TAG}" --format 'image_id={{.Id}} created={{.Created}}'
echo "RP_WEBAPP_BUILD_SHA=$GIT_COMMIT"
echo "RP_WEBAPP_BUILD_AT=$RP_WEBAPP_BUILD_AT"
