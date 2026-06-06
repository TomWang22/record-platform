#!/usr/bin/env bash
# Build and load a service image for Colima/k3s. Colima's Docker daemon runs inside the VM,
# so building with context colima puts the image where k3s can use it (imagePullPolicy: IfNotPresent).
#
# Usage:
#   ./scripts/build-and-load-colima.sh [service-name]
#   ./scripts/build-and-load-colima.sh                    # builds analytics-service only (default)
#   ./scripts/build-and-load-colima.sh analytics-service  # same
#   ./scripts/build-and-load-colima.sh all                # build all app services
#
# Requires: Docker context colima (docker context use colima).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE="${1:-analytics-service}"

if [[ "$(docker context show 2>/dev/null)" != *"colima"* ]]; then
  echo "⚠️  Docker context is not colima. Switch with: docker context use colima"
  echo "   (Colima must be running: colima start)"
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans,,}" != "y" ]] && exit 1
fi

build_one() {
  local name="$1"
  local df=""
  if   [[ -f "services/$name/Dockerfile" ]]; then df="services/$name/Dockerfile"
  elif [[ -f "$name/Dockerfile" ]];        then df="$name/Dockerfile"
  elif [[ -f "Dockerfile.$name" ]];        then df="Dockerfile.$name"
  else
    echo "❌ No Dockerfile for '$name'" >&2
    return 1
  fi
  echo "→ Building $name:dev (context: colima)"
  docker build -f "$df" -t "$name:dev" . || return 1
  echo "→ Restarting deployment so it picks up the new image"
  kubectl rollout restart "deploy/$name" -n record-platform 2>/dev/null || true
  echo "✅ $name:dev built; deployment restarting."
}

if [[ "$SERVICE" == "all" ]]; then
  for s in api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor cron-jobs; do
    build_one "$s" || true
  done
else
  build_one "$SERVICE"
fi
