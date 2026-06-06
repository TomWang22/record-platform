#!/usr/bin/env bash
# Build Record Platform service images (:dev) from repo root and load into Colima/k3s.
#
# Usage:
#   make build-images
#   SERVICES="trust-service notification-service" make build-images
#   RP_SKIP_FRESH_BUILD=1 SERVICES="api-gateway" make build-images  # skip if already fresh
#   RP_SKIP_BASE_IMAGE_PREPULL=1 make build-images
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/record-platform-docker-services-default.sh
source "$SCRIPT_DIR/lib/record-platform-docker-services-default.sh"
SERVICES="${SERVICES:-$RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT}"
SERVICES="${SERVICES//,/ }"

IMAGE_TAG="${IMAGE_TAG:-dev}"
DOCKER="${DOCKER:-docker}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

dockerfile_for() {
  local svc="$1"
  case "$svc" in
    webapp) echo "webapp/Dockerfile" ;;
    *) echo "services/$svc/Dockerfile" ;;
  esac
}

image_is_fresh() {
  local svc="$1"
  RP_IMAGE_TARGETS="$svc" bash "$SCRIPT_DIR/audit-rp-image-freshness.sh" >/dev/null 2>&1
}

docker_build_service() {
  local svc="$1"
  local tag="${svc}:${IMAGE_TAG}"
  local df
  df="$(dockerfile_for "$svc")"
  if [[ ! -f "$df" ]]; then
    warn "Skip $svc (no $df)"
    return 0
  fi

  local sha git_commit
  sha="$(bash "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" "$svc")"
  if [[ "${RP_SKIP_FRESH_BUILD:-0}" == "1" ]] && image_is_fresh "$svc"; then
    echo "  ⏭️  ${tag} fresh (labeled) — skip docker build (RP_SKIP_FRESH_BUILD=1)"
    return 0
  fi

  git_commit="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
  echo "  🔨 building ${tag} expected_sha=${sha} GIT_COMMIT=${git_commit}"
  local build_args=(--build-arg "RP_SOURCE_SHA=$sha" --build-arg "GIT_COMMIT=$git_commit")
  local net_args=()
  if [[ "${RP_DOCKER_BUILD_NETWORK:-host}" == "host" ]]; then
    net_args=(--network=host)
  fi
  local attempt=1 max_attempts="${RP_DOCKER_BUILD_ATTEMPTS:-3}"
  local build_ok=0
  while [[ $attempt -le $max_attempts ]]; do
    echo "  ▶ docker build attempt ${attempt}/${max_attempts}"
    if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
      if $DOCKER build --platform "$DOCKER_DEFAULT_PLATFORM" "${net_args[@]}" "${build_args[@]}" -t "$tag" -f "$df" "$REPO_ROOT"; then
        build_ok=1
        break
      fi
    elif $DOCKER build "${net_args[@]}" "${build_args[@]}" -t "$tag" -f "$df" "$REPO_ROOT"; then
      build_ok=1
      break
    fi
    echo "  ⚠️  docker build failed (attempt ${attempt})" >&2
    sleep "${RP_DOCKER_BUILD_RETRY_DELAY_SEC:-5}"
    attempt=$((attempt + 1))
  done
  if [[ $build_ok -ne 1 ]]; then
    echo "  ❌ docker build failed after ${max_attempts} attempts: ${tag}" >&2
    return 1
  fi
  if ! $DOCKER image inspect "$tag" >/dev/null 2>&1; then
    echo "  ❌ image not present after build: ${tag}" >&2
    return 1
  fi
  local image_id
  image_id="$($DOCKER image inspect --format '{{.Id}}' "$tag" 2>/dev/null | sed 's/^sha256://' | cut -c1-12)"
  echo "  ✅ built ${tag} image_id=${image_id:-unknown} source_sha=${sha}"
}

if [[ "${RP_SKIP_BASE_IMAGE_PREPULL:-0}" == "1" || "${RP_BASE_IMAGE_PREPULL_DONE:-0}" == "1" ]]; then
  : # global prepull already completed in E.build_images / rp-build-missing-images
elif [[ "${RP_SKIP_BASE_IMAGE_PREPULL:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/rp-prepull-base-images.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/rp-prepull-base-images.sh"
  export RP_BASE_IMAGE_PREPULL_DONE=1
fi

if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
  say "Building Record Platform images — platform=${DOCKER_DEFAULT_PLATFORM} tag=${IMAGE_TAG}"
else
  say "Building Record Platform images — native platform tag=${IMAGE_TAG}"
fi
echo "Services: $SERVICES"

built=()
for s in $SERVICES; do
  if [[ "$s" == "booking-service" || "$s" == "social-service" ]]; then
    warn "Skip $s (not an active RP image target)"
    continue
  fi
  echo "  → $s"
  docker_build_service "$s" || {
    warn "Build failed for $s"
    exit 1
  }
  built+=("$s")
  ok "Built ${s}:${IMAGE_TAG}"
done

if [[ ${#built[@]} -gt 0 ]]; then
  say "Post-build freshness check"
  RP_IMAGE_TARGETS="${built[*]}" bash "$SCRIPT_DIR/audit-rp-image-freshness.sh" || {
    warn "Freshness audit failed for built services"
    exit 1
  }
fi

if [[ "${SKIP_LOAD:-0}" == "1" ]]; then
  say "SKIP_LOAD=1 — not loading into VM"
  exit 0
fi

if command -v colima >/dev/null 2>&1 && colima status &>/dev/null; then
  say "Loading images into Colima (k3s docker)…"
  for s in "${built[@]}"; do
    docker save "${s}:${IMAGE_TAG}" | colima ssh -- docker load || warn "Load failed for ${s}:${IMAGE_TAG}"
  done
  ok "Colima docker load complete. Restart pods if needed: kubectl rollout restart deploy/<name> -n record-platform"
else
  warn "Colima not running — images built on host only."
fi
