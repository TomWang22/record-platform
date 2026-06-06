#!/usr/bin/env bash
# Prove whether NodePort UDP is reachable from host namespace (macOS Docker VM).
# If nc on the node receives nothing from host → NodePort UDP not exposed to host.
# Usage: ./scripts/nodeport-udp-proof.sh

set -euo pipefail

NODE="${K3D_NODE:-k3d-record-platform-server-0}"
NODEPORT="${CADDY_NODEPORT:-30443}"

echo "🔬 Testing raw UDP to NodePort ${NODEPORT} (node ${NODE})..."

docker exec -d "$NODE" sh -c "nc -u -l -p ${NODEPORT} > /tmp/udp-test.log 2>&1" || true
sleep 2

echo "test" | nc -u -w 2 127.0.0.1 "$NODEPORT" 2>/dev/null || true
sleep 2

RECV=$(docker exec "$NODE" sh -c "cat /tmp/udp-test.log 2>/dev/null" || true)
docker exec "$NODE" sh -c "rm -f /tmp/udp-test.log" 2>/dev/null || true

if [[ -z "$RECV" ]]; then
  echo "❌ NodePort UDP not reachable from host namespace (nothing received in node)."
  exit 1
fi

echo "✅ NodePort UDP reachable (node received: $RECV)"
