#!/usr/bin/env bash
# Build rp-caddy debug image (delegates to docker/caddy).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RP_CADDY_IMAGE="${RP_CADDY_DEBUG_IMAGE:-rp-caddy-debug:dev}"
exec "$SCRIPT_DIR/build-rp-caddy.sh"
