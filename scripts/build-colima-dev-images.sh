#!/usr/bin/env bash
# Build all app :dev images on the Colima Docker daemon so k3s can run them (same daemon).
# Run from repo root after Colima is up. Idempotent: only builds missing images unless BUILD_FORCE=1.
# Usage: ./scripts/build-colima-dev-images.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

_colima_services=(api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor)

need_build=()
for _s in "${_colima_services[@]}"; do
  if [[ "${BUILD_FORCE:-0}" == "1" ]] || ! docker image inspect "${_s}:dev" &>/dev/null; then
    need_build+=("$_s")
  fi
done

if [[ ${#need_build[@]} -eq 0 ]]; then
  echo "✅ All :dev images present. Set BUILD_FORCE=1 to rebuild."
  exit 0
fi

KARCH=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || uname -m)
case "$KARCH" in aarch64|arm64) PLAT="linux/arm64";; *) PLAT="linux/amd64";; esac
echo "Building ${#need_build[@]} image(s) in parallel (max 4); platform=$PLAT"
max_parallel=4
idx=0
while [[ $idx -lt ${#need_build[@]} ]]; do
  batch=()
  for ((i = 0; i < max_parallel && idx + i < ${#need_build[@]}; i++)); do
    batch+=("${need_build[$((idx + i))]}")
  done
  for _s in "${batch[@]}"; do
    (
      if [[ -f "$REPO_ROOT/services/$_s/Dockerfile" ]]; then
        if [[ "$_s" == "python-ai-service" ]]; then
          docker build --platform="$PLAT" -t "${_s}:dev" -f "$REPO_ROOT/services/$_s/Dockerfile" "$REPO_ROOT" 2>/dev/null && echo "  built $_s:dev" || echo "  ⚠️  $_s:dev failed"
        else
          docker build --platform="$PLAT" -t "${_s}:dev" -f "$REPO_ROOT/services/$_s/Dockerfile" "$REPO_ROOT" 2>/dev/null && echo "  built $_s:dev" || echo "  ⚠️  $_s:dev failed"
        fi
      fi
    ) &
  done
  wait
  idx=$((idx + ${#batch[@]}))
done
echo "✅ Colima :dev images build finished."
