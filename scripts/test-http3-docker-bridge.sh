#!/usr/bin/env bash
# Quick test: HTTP/3 via Docker bridge (host.docker.internal:18443).
# Use when native curl to LB IP fails (host↔NodePort UDP limit on macOS).
# Requires: Docker/Colima running; setup-lb-ip-host-access.sh has started the Docker bridge socat (0.0.0.0:18443).
#
# Usage: ./scripts/test-http3-docker-bridge.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export HTTP3_USE_NATIVE_CURL=0
export DOCKER_FORWARD_PORT="${DOCKER_FORWARD_PORT:-18443}"
export HTTP3_DOCKER_FORWARD_PORT="$DOCKER_FORWARD_PORT"

# Resolve host.docker.internal (required for Docker bridge path)
DOCKER_HOST_IP=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
if [[ -z "$DOCKER_HOST_IP" ]]; then
  echo "Cannot resolve host.docker.internal. Is Docker/Colima running?"
  exit 1
fi
export DOCKER_HOST_IP
export HTTP3_RESOLVE="record.local:${DOCKER_FORWARD_PORT}:${DOCKER_HOST_IP}"

# Prefer local image to avoid pull failures
if docker image inspect http3-curl-enhanced:latest >/dev/null 2>&1; then
  export HTTP3_IMAGE=http3-curl-enhanced:latest
elif docker image inspect alpine/curl-http3:latest >/dev/null 2>&1; then
  export HTTP3_IMAGE=alpine/curl-http3:latest
elif docker image inspect rmarx/curl-http3:latest >/dev/null 2>&1; then
  export HTTP3_IMAGE=rmarx/curl-http3:latest
fi

. "$SCRIPT_DIR/lib/http3.sh"
code=$(http3_curl --http3-only -k -sS -o /dev/null -w "%{http_code}" --resolve "$HTTP3_RESOLVE" "https://record.local:${DOCKER_FORWARD_PORT}/_caddy/healthz" 2>/dev/null || echo "000")
echo "HTTP code: $code"
if [[ "$code" == "200" ]]; then
  echo "HTTP/3 via Docker bridge OK"
  exit 0
else
  echo "HTTP/3 via Docker bridge failed (code $code). Ensure: (1) Colima/Docker running, (2) setup-lb-ip-host-access.sh has been run (Docker bridge socat on 18443), (3) Caddy is up."
  exit 1
fi
