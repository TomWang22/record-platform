#!/usr/bin/env bash
# Verify k3d publishes both TCP and UDP 30443 to the host (required for HTTP/3/QUIC).
# If UDP is missing, HTTP/3 will fail on both NodePort and LB IP. Recreate cluster with UDP 30443.
# See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md and docs/HTTP3-CURL-EXIT-CODES.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-record-platform}"

echo "=== Verify k3d TCP+UDP 30443 (cluster: $CLUSTER_NAME) ==="

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker not found. Install Docker or set DOCKER_HOST."
  exit 1
fi

# k3d v2+: serverlb container is typically k3d-<cluster>-serverlb; with --no-lb use server-0
CONTAINER=""
for name in "k3d-${CLUSTER_NAME}-serverlb" "k3d-${CLUSTER_NAME}-lb"; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    CONTAINER="$name"
    break
  fi
done
# If not running, try to start serverlb (e.g. after docker restart)
if [[ -z "$CONTAINER" ]]; then
  for name in "k3d-${CLUSTER_NAME}-serverlb" "k3d-${CLUSTER_NAME}-lb"; do
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
      docker start "$name" 2>/dev/null && sleep 2 && CONTAINER="$name" && break
    fi
  done
fi
# With --no-lb, ports are on server-0
if [[ -z "$CONTAINER" ]] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "k3d-${CLUSTER_NAME}-server-0"; then
  CONTAINER="k3d-${CLUSTER_NAME}-server-0"
fi
if [[ -z "$CONTAINER" ]]; then
  echo "❌ k3d loadbalancer or server container not found (tried serverlb, lb, server-0)."
  echo "   Is the cluster running? Run: k3d cluster start $CLUSTER_NAME"
  exit 1
fi

# docker inspect: NetworkSettings.Ports has keys like "30443/tcp" and "30443/udp"
NPUB=$(docker inspect "$CONTAINER" --format '{{range $p, $v := .NetworkSettings.Ports}}{{$p}} {{end}}' 2>/dev/null || true)
TCP_30443=0
UDP_30443=0
echo "$NPUB" | tr ' ' '\n' | grep -q '30443/tcp' && TCP_30443=1 || true
echo "$NPUB" | tr ' ' '\n' | grep -q '30443/udp' && UDP_30443=1 || true

# Fallback: host lsof (confirms something is listening on 30443)
if [[ "$UDP_30443" -eq 0 ]] && command -v lsof >/dev/null 2>&1; then
  lsof -i UDP:30443 2>/dev/null | grep -q . && UDP_30443=1 || true
fi
if [[ "$TCP_30443" -eq 0 ]] && command -v lsof >/dev/null 2>&1; then
  lsof -i TCP:30443 -sTCP:LISTEN 2>/dev/null | grep -q . && TCP_30443=1 || true
fi

echo "  Port bindings: $NPUB"

echo ""
if [[ "$TCP_30443" -eq 1 ]]; then
  echo "✅ TCP 30443 is published"
else
  echo "⚠️  TCP 30443 not detected (HTTP/2 to NodePort may still work via other mapping)"
fi
if [[ "$UDP_30443" -eq 1 ]]; then
  echo "✅ UDP 30443 is published (HTTP/3/QUIC can work)"
else
  echo "❌ UDP 30443 is NOT published — HTTP/3 will fail (connection refused) on both NodePort and LB IP."
  echo ""
  echo "   Fix: Recreate the cluster with both TCP and UDP 30443:"
  echo "     k3d cluster delete $CLUSTER_NAME"
  echo "     $SCRIPT_DIR/k3d-create-2-node-cluster.sh"
  echo "   See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md"
  exit 1
fi

echo ""
echo "Quick test (requires curl with --http3):"
echo "  NGTCP2_ENABLE_GSO=0 curl --http3-only -k --connect-timeout 5 --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz"
exit 0
