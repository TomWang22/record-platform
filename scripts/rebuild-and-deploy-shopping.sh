#!/usr/bin/env bash
# Rebuild record-platform-shopping-service:latest and deploy to cluster (Colima/k3d).
# Run from repo root. Requires: docker, kubectl, cluster running.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KARCH=$(uname -m)
case "$KARCH" in aarch64|arm64) PLAT="linux/arm64";; *) PLAT="linux/amd64";; esac

echo "Building record-platform-shopping-service:latest (platform=$PLAT)..."
docker build --platform="$PLAT" -t record-platform-shopping-service:latest -f services/shopping-service/Dockerfile . || {
  echo "Build failed. If it was a network error (e.g. pnpm fetch), retry when network is stable."
  exit 1
}

echo "Restarting shopping-service deployment..."
kubectl -n record-platform rollout restart deployment/shopping-service

echo "Waiting for rollout..."
kubectl -n record-platform rollout status deployment/shopping-service --timeout=120s

echo "Done. shopping-service is running the new image."
