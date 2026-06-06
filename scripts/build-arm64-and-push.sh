#!/usr/bin/env bash
# Build all platform services for linux/arm64 and push to k3d registry.
# Use when nodes are arm64 (e.g. M1/M2) and pods show "no match for platform".
# BUILD_NETWORK=host lets the build container use host network (fixes deb.debian.org/npm timeouts).
# Usage: ./scripts/build-arm64-and-push.sh [cluster-name]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PLATFORM=linux/arm64
export BUILD_NETWORK=host

echo "Building all services for arm64 (BUILD_NETWORK=host)..."
"$SCRIPT_DIR/build-and-load-k3d.sh" "${1:-record-platform}" || true

echo "Pushing to registry and patching deployments..."
"$SCRIPT_DIR/k3d-registry-push-and-patch.sh" "${1:-record-platform}"

echo "Done. Check: kubectl get pods -n record-platform"
