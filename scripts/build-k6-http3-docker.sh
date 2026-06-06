#!/usr/bin/env bash
set -euo pipefail

# Build a Docker image containing the custom k6-http3 binary
# This allows us to run k6 HTTP/3 tests inside the Kubernetes cluster

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if custom k6 binary exists
K6_BINARY="${PROJECT_ROOT}/.k6-build/bin/k6-http3"
if [[ ! -f "$K6_BINARY" ]]; then
  fail "Custom k6-http3 binary not found at $K6_BINARY"
  fail "Please run ./scripts/build-k6-http3.sh first"
fi

ok "Found custom k6-http3 binary: $K6_BINARY"

# Docker image name and tag
IMAGE_NAME="${K6_HTTP3_IMAGE:-record-platform/k6-http3}"
IMAGE_TAG="${K6_HTTP3_TAG:-latest}"

say "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"

# Create temporary Dockerfile
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

cat > "$TMP_DIR/Dockerfile" <<EOF
FROM alpine:latest

# Install ca-certificates for TLS verification
RUN apk add --no-cache ca-certificates

# Copy custom k6-http3 binary
COPY k6-http3 /usr/local/bin/k6
RUN chmod +x /usr/local/bin/k6

# Verify k6 is installed
RUN k6 version

# Default entrypoint
ENTRYPOINT ["k6"]
EOF

# Copy k6 binary to temp directory
cp "$K6_BINARY" "$TMP_DIR/k6-http3"

# Build Docker image
say "Building Docker image..."
if docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" "$TMP_DIR" >/dev/null 2>&1; then
  ok "Docker image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
  
  # Verify the image
  say "Verifying image..."
  if docker run --rm "${IMAGE_NAME}:${IMAGE_TAG}" version >/dev/null 2>&1; then
    ok "Image verification successful"
    docker run --rm "${IMAGE_NAME}:${IMAGE_TAG}" version | head -3
  else
    warn "Image verification failed"
  fi
else
  fail "Failed to build Docker image"
fi

say "=== Docker Image Build Complete ==="
ok "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
ok "To use in Kubernetes, ensure this image is available in your cluster"
ok "  - For Kind: docker save ${IMAGE_NAME}:${IMAGE_TAG} | kind load docker-image ${IMAGE_NAME}:${IMAGE_TAG}"
ok "  - Or push to a registry accessible by your cluster"

