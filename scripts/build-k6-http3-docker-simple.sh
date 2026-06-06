#!/usr/bin/env bash
set -euo pipefail

# Build a Docker image containing the custom k6-http3 binary
# This version builds k6 locally (using host Go) and copies it into Docker

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if custom k6 binary exists (built for Linux)
K6_BINARY="${PROJECT_ROOT}/.k6-build/k6-http3"
if [[ ! -f "$K6_BINARY" ]]; then
  K6_BINARY="${PROJECT_ROOT}/.k6-build/bin/k6-http3"
fi

if [[ ! -f "$K6_BINARY" ]]; then
  warn "Custom k6-http3 binary not found. Building for Linux..."
  
  # Check if we need to build for Linux (cross-compile)
  if [[ "$(uname -m)" == "arm64" ]] || [[ "$(uname)" == "Darwin" ]]; then
    say "Cross-compiling k6 for Linux (amd64)..."
    export GOOS=linux
    export GOARCH=amd64
    # Temporarily disable the test in build script
    SKIP_TEST=1 "$SCRIPT_DIR/build-k6-http3.sh" || fail "Failed to build k6-http3 for Linux"
  else
    "$SCRIPT_DIR/build-k6-http3.sh" || fail "Failed to build k6-http3"
  fi
  
  # Check again after build
  if [[ -f "${PROJECT_ROOT}/.k6-build/k6-http3" ]]; then
    K6_BINARY="${PROJECT_ROOT}/.k6-build/k6-http3"
  elif [[ -f "${PROJECT_ROOT}/.k6-build/bin/k6-http3" ]]; then
    K6_BINARY="${PROJECT_ROOT}/.k6-build/bin/k6-http3"
  fi
fi

# Verify binary is for Linux
if file "$K6_BINARY" | grep -q "ELF.*Linux"; then
  ok "Found Linux k6-http3 binary: $K6_BINARY"
elif file "$K6_BINARY" | grep -q "Mach-O"; then
  warn "Binary is macOS, need to cross-compile for Linux"
  say "Cross-compiling k6 for Linux (amd64)..."
  export GOOS=linux
  export GOARCH=amd64
  # Rebuild for Linux
  cd "$PROJECT_ROOT"
  rm -f "$K6_BINARY"
  "$SCRIPT_DIR/build-k6-http3.sh" || fail "Failed to cross-compile k6-http3 for Linux"
  
  if [[ ! -f "$K6_BINARY" ]]; then
    fail "Cross-compiled binary not found at $K6_BINARY"
  fi
  
  if file "$K6_BINARY" | grep -q "ELF.*Linux"; then
    ok "Cross-compiled Linux binary ready: $K6_BINARY"
  else
    fail "Cross-compilation failed - binary is still not Linux"
  fi
else
  warn "Unknown binary format, attempting to use anyway"
fi

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
if docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" "$TMP_DIR" 2>&1 | tee /tmp/k6-docker-build-simple.log; then
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
  fail "Failed to build Docker image (check /tmp/k6-docker-build-simple.log)"
fi

say "=== Docker Image Build Complete ==="
ok "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
ok "To use in Kubernetes, ensure this image is available in your cluster"
ok "  - For Kind: docker save ${IMAGE_NAME}:${IMAGE_TAG} | kind load docker-image ${IMAGE_NAME}:${IMAGE_TAG}"
ok "  - Or push to a registry accessible by your cluster"

