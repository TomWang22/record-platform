#!/usr/bin/env bash
# Build HTTP/3 enhanced image (alpine/curl-http3 + tcpdump, tshark, valgrind).
# Use this when you need packet capture + memory-leak tooling in-container.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "Building http3-curl-enhanced from alpine/curl-http3 + tcpdump, tshark, valgrind..."
docker build -t http3-curl-enhanced:latest \
  -f docker/http3-curl-enhanced/Dockerfile \
  docker/http3-curl-enhanced/

echo "Verifying image..."
docker run --rm http3-curl-enhanced:latest sh -c \
  "curl -V | head -1 && tcpdump --version 2>&1 | head -1 && jq --version"

echo "Done. Use HTTP3_IMAGE=http3-curl-enhanced:latest to use this image in tests."