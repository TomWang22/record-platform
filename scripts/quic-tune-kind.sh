#!/usr/bin/env bash
set -euo pipefail
NODE=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
echo "Tuning QUIC buffers on ${NODE} (kind node container)"
docker exec "$NODE" sysctl -w net.core.rmem_max=2500000 net.core.rmem_default=212992 >/dev/null
docker exec "$NODE" sysctl -w net.core.wmem_max=2500000 net.core.wmem_default=212992 >/dev/null
echo "Done."