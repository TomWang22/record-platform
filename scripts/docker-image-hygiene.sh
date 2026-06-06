#!/usr/bin/env bash
# Remove stale dev-tagged images so K8s/compose use the latest built images.
# After building with: docker compose build shopping-service listings-service
# we have record-platform-shopping-service:latest and record-platform-listings-service:latest.
# K8s is configured to use those. This script removes the old shopping-service:dev and
# listings-service:dev images (and optionally other stale *:dev app images).
# Usage: ./scripts/docker-image-hygiene.sh [--dry-run] [--all-dev]

set -euo pipefail

DRY_RUN=false
ALL_DEV=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --all-dev) ALL_DEV=true ;;
  esac
done

_rm() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [dry-run] would remove: $*"
  else
    docker rmi "$@" 2>/dev/null || echo "  (skip: $* not found or in use)"
  fi
}

echo "Docker image hygiene: removing stale dev images so latest (record-platform-*:latest) are used."
echo ""

# Remove old dev-tagged images that are superseded by record-platform-*:latest
STALE_IMAGES=()
while IFS= read -r line; do
  repo=$(echo "$line" | awk '{print $1}')
  tag=$(echo "$line" | awk '{print $2}')
  id=$(echo "$line" | awk '{print $3}')
  # Only remove if we have a record-platform-*:latest for the same service
  if [[ "$repo" == "shopping-service" ]] && [[ "$tag" == "dev" ]]; then
    if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "record-platform-shopping-service:latest"; then
      STALE_IMAGES+=( "$id" )
    fi
  fi
  if [[ "$repo" == "listings-service" ]] && [[ "$tag" == "dev" ]]; then
    if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "record-platform-listings-service:latest"; then
      STALE_IMAGES+=( "$id" )
    fi
  fi
done < <(docker images --format "{{.Repository}} {{.Tag}} {{.ID}}" | grep -E "shopping-service|listings-service" || true)

# Prefer removing by name:tag so we don't remove an ID that's shared
for name in shopping-service:dev listings-service:dev; do
  if docker image inspect "$name" &>/dev/null; then
    echo "Removing stale $name (use record-platform-*:latest instead)"
    _rm "$name"
  fi
done

if [[ "$ALL_DEV" == "true" ]]; then
  echo ""
  echo "Removing all *:dev app images (auth, records, api-gateway, etc.)..."
  for name in auth-service:dev records-service:dev api-gateway:dev analytics-service:dev social-service:dev auction-monitor:dev python-ai-service:dev cron-jobs:dev; do
    if docker image inspect "$name" &>/dev/null; then
      _rm "$name"
    fi
  done
fi

echo ""
echo "Done. Ensure K8s uses latest: image: record-platform-shopping-service:latest (and listings)."
echo "Load into kind/k3d if needed: kind load docker-image record-platform-shopping-service:latest record-platform-listings-service:latest"
