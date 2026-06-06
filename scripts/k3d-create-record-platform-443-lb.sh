#!/usr/bin/env bash
# Create k3d cluster with HTTPS (TCP+UDP) published on the loadbalancer.
# Use with Caddy hostPort 443 and ClusterIP service (no NodePort) so QUIC
# bypasses docker-proxy. See docs/HTTP3-K3D-DOCKER-PROXY.md.
#
# K3D_HOST_HTTPS_PORT: host port to publish (default 8443 so host 443 can stay free on Mac).
#   Use 443 to bind host 443: K3D_HOST_HTTPS_PORT=443 ./scripts/k3d-create-record-platform-443-lb.sh
set -euo pipefail

CLUSTER="${1:-record-platform}"
HOST_PORT="${K3D_HOST_HTTPS_PORT:-8443}"

echo "Deleting existing cluster (if any): $CLUSTER"
k3d cluster delete "$CLUSTER" 2>/dev/null || true

echo "Creating cluster: $CLUSTER (host $HOST_PORT -> loadbalancer 443, no NodePort for QUIC)"
k3d cluster create "$CLUSTER" \
  --agents 1 \
  --k3s-arg "--disable=traefik@server:*" \
  --port "${HOST_PORT}:443@loadbalancer" \
  --port "${HOST_PORT}:443/udp@loadbalancer"

echo "Done. From Mac: curl -k -I --http2 -H 'Host: record.local' https://127.0.0.1:${HOST_PORT}/_caddy/healthz"
echo "  HTTP/3: curl -k -I --http3-only -H 'Host: record.local' --resolve 'record.local:${HOST_PORT}:127.0.0.1' https://record.local/_caddy/healthz"
echo "  Deploy Caddy: CADDY_USE_HOSTPORT=1 ./scripts/rollout-caddy.sh"
