#!/usr/bin/env sh
# Snippet: run in build stage (network available during docker build --network=host)
set -eu
apt-get update -qq
apt-get install -y -qq --no-install-recommends curl ca-certificates "$@"
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "aarch64" ]; then ARCH=arm64; fi
GRPC_HEALTH_PROBE_VERSION="${GRPC_HEALTH_PROBE_VERSION:-v0.4.24}"
curl -Lf -o /tmp/grpc-health-probe \
  "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${ARCH}"
chmod +x /tmp/grpc-health-probe
/tmp/grpc-health-probe -version >/dev/null 2>&1
apt-get purge -y curl 2>/dev/null || true
rm -rf /var/lib/apt/lists/*
