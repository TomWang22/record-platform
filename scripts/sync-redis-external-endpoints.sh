#!/usr/bin/env bash
# Sync redis-external Endpoints using execution-plane-aware resolution.
# Default Colima ownership: COLIMA_DEFAULT_DOCKER_CONTAINER → Colima VM published IP.
# Does not silently fall back to macOS gateway (192.168.5.2) or node IP confusion.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${K8S_NAMESPACE:-${HOUSING_NS:-record-platform}}"

# Prefer the reconciler (classify → resolve → protocol verify → materialize).
if [[ "${RP_REDIS_SYNC_USE_LEGACY:-0}" != "1" ]]; then
  exec "$SCRIPT_DIR/reconcile-external-endpoints.sh" reconcile
fi

# Legacy path retained for emergency only when RP_REDIS_SYNC_USE_LEGACY=1.
# shellcheck source=lib/rp-resolve-external-dependency-endpoint.sh
source "$SCRIPT_DIR/lib/rp-resolve-external-dependency-endpoint.sh"

export TARGET_EXECUTION_PLANE="${TARGET_EXECUTION_PLANE:-COLIMA_DEFAULT_DOCKER_CONTAINER}"
export TARGET_SERVICE=redis
export TARGET_PORT="${REDIS_PORT:-6379}"
export TARGET_PROTOCOL=redis
export COLIMA_PROFILE="${COLIMA_PROFILE:-default}"

ip="$(rp_resolve_external_dependency_endpoint)" || exit 1
ip="$(echo "$ip" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[[ -n "$ip" ]] || { echo "❌ empty redis endpoint IP" >&2; exit 1; }

kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Endpoints
metadata:
  name: redis-external
  namespace: ${NS}
subsets:
  - addresses:
      - ip: ${ip}
    ports:
      - name: redis
        port: ${TARGET_PORT}
        protocol: TCP
EOF
echo "✅ redis-external → ${ip}:${TARGET_PORT} (plane=${TARGET_EXECUTION_PLANE})"
