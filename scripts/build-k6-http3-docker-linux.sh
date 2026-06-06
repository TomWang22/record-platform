#!/usr/bin/env bash
set -euo pipefail

# Build a Docker image containing the custom k6-http3 binary
# This version builds k6 inside Docker (for Linux) to avoid architecture mismatches

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Docker image name and tag
IMAGE_NAME="${K6_HTTP3_IMAGE:-record-platform/k6-http3}"
IMAGE_TAG="${K6_HTTP3_TAG:-latest}"

say "Building k6-http3 Docker image (building k6 inside Docker for Linux)..."

# Check if xk6-http3 extension exists
EXTENSION_PATH="${PROJECT_ROOT}/xk6-http3"
if [[ ! -d "$EXTENSION_PATH" ]]; then
  fail "xk6-http3 extension not found at $EXTENSION_PATH"
fi

# Create temporary Dockerfile that builds k6 inside Docker
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Copy extension to temp directory
cp -r "$EXTENSION_PATH" "$TMP_DIR/xk6-http3"

cat > "$TMP_DIR/Dockerfile" <<'EOF'
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make

# Install xk6 (use v1.2.0 which works with Go 1.23)
ENV PATH=$PATH:/root/go/bin
RUN go install go.k6.io/xk6/cmd/xk6@v1.2.0

# Copy extension source
WORKDIR /build
COPY xk6-http3 ./xk6-http3

# Build k6 with HTTP/3 extension
# Create go.mod with replace directive
RUN cat > go.mod <<'MODEOF'
module k6-custom

go 1.23

require go.k6.io/k6 v0.50.0
require github.com/record-platform/xk6-http3 v0.0.0

replace github.com/record-platform/xk6-http3 => ./xk6-http3
MODEOF

RUN go mod tidy && \
    xk6 build --with github.com/record-platform/xk6-http3=./xk6-http3 -o k6-http3

# Final stage
FROM alpine:latest

# Install ca-certificates for TLS verification
RUN apk add --no-cache ca-certificates

# Copy k6 binary from builder
COPY --from=builder /build/k6-http3 /usr/local/bin/k6
RUN chmod +x /usr/local/bin/k6

# Verify k6 is installed
RUN k6 version

# Default entrypoint
ENTRYPOINT ["k6"]
EOF

# Build Docker image
say "Building Docker image (this may take a few minutes)..."
if docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" "$TMP_DIR" 2>&1 | tee /tmp/k6-docker-build.log; then
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
  fail "Failed to build Docker image (check /tmp/k6-docker-build.log)"
fi

say "=== Docker Image Build Complete ==="
ok "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
ok "To use in Kubernetes, ensure this image is available in your cluster"
ok "  - For Kind: docker save ${IMAGE_NAME}:${IMAGE_TAG} | kind load docker-image ${IMAGE_NAME}:${IMAGE_TAG}"
ok "  - Or push to a registry accessible by your cluster"

