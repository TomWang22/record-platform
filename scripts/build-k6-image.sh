#!/usr/bin/env bash
# Build custom k6 image with debugging tools
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_DOCKERFILE="${SCRIPT_DIR}/../infra/k8s/base/k6/Dockerfile"
IMAGE_NAME="k6-custom:latest"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "[OK] $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }

if [[ ! -f "$K6_DOCKERFILE" ]]; then
  warn "Dockerfile not found at $K6_DOCKERFILE"
  exit 1
fi

say "Building custom k6 image with HTTP/3 support and debugging tools..."
# Build from repo root so we can copy xk6-http3 directory
docker build -f "$K6_DOCKERFILE" -t "$IMAGE_NAME" "$SCRIPT_DIR/.." || fail "Failed to build k6 image"

ok "Custom k6 image built: $IMAGE_NAME"
docker images "$IMAGE_NAME" | head -2
