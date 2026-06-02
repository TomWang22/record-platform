#!/usr/bin/env bash
# Point redis-external Endpoints at the host gateway IP where Compose publishes Redis :6379.
# Do NOT use the Compose container bridge IP (172.18.0.x) — k3s pods cannot route there on Colima.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${K8S_NAMESPACE:-${HOUSING_NS:-record-platform}}"
REDIS_PORT="${REDIS_PORT:-6379}"
VERIFY_ATTEMPTS="${RP_REDIS_SYNC_VERIFY_ATTEMPTS:-45}"
VERIFY_SLEEP="${RP_REDIS_SYNC_VERIFY_SLEEP:-2}"
PROBE_DEPLOY="${RP_REDIS_SYNC_PROBE_DEPLOY:-auth-service}"

# shellcheck source=lib/rp-resolve-external-host-gateway.sh
source "$SCRIPT_DIR/lib/rp-resolve-external-host-gateway.sh"

_extract_ipv4() { echo "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }

_compose_redis_published_on_host() {
  if nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
    return 0
  fi
  if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
    colima ssh -- nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null && return 0
  fi
  return 1
}

_resolve_redis_endpoint_ip() {
  local gw ip name
  gw="$(rp_resolve_external_host_gateway_ip)"
  gw="$(_extract_ipv4 "$gw")"
  if [[ -n "$gw" ]] && _compose_redis_published_on_host; then
    echo "$gw"
    return 0
  fi
  # Legacy fallback: bridge IP (may work via kube-proxy only; not pod-routable on Colima).
  for name in record-platform-redis record-platform-redis-1 redis; do
    ip="$(docker inspect "$name" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1 || true)"
    ip="$(_extract_ipv4 "$ip")"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  done
  local cid
  cid="$(docker ps --filter "publish=${REDIS_PORT}" --format '{{.ID}}' 2>/dev/null | head -1)"
  if [[ -n "$cid" ]]; then
    docker inspect "$cid" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1
    return 0
  fi
  return 1
}

_wait_for_probe_deploy() {
  local attempt
  for ((attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++)); do
    if kubectl -n "$NS" get deploy "$PROBE_DEPLOY" >/dev/null 2>&1; then
      if kubectl -n "$NS" rollout status "deployment/$PROBE_DEPLOY" --timeout=10s >/dev/null 2>&1; then
        return 0
      fi
      local ready
      ready="$(kubectl -n "$NS" get deploy "$PROBE_DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
      [[ "${ready:-0}" -ge 1 ]] && return 0
    fi
    sleep "$VERIFY_SLEEP"
  done
  return 1
}

_verify_pod_ping() {
  local host="redis-external.${NS}.svc.cluster.local"
  kubectl -n "$NS" exec "deploy/$PROBE_DEPLOY" -c app -- env \
    RP_REDIS_HOST="$host" RP_REDIS_PORT="$REDIS_PORT" node -e "
const net=require('net');
const h=process.env.RP_REDIS_HOST,p=+process.env.RP_REDIS_PORT;
const s=net.createConnection(p,h);
s.on('connect',()=>s.write('*1\r\n\$4\r\nPING\r\n'));
let d='';s.on('data',c=>{d+=c;if(d.includes('PONG')){console.log('PONG');process.exit(0)}});
s.on('error',e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),8000);
" 2>/dev/null | grep -q PONG
}

if ! _compose_redis_published_on_host; then
  echo "❌ Compose Redis not reachable on 127.0.0.1:${REDIS_PORT} — run: docker compose up -d redis" >&2
  exit 1
fi

ip="$(_resolve_redis_endpoint_ip || true)"
ip="$(_extract_ipv4 "$ip")"
if [[ -z "$ip" ]]; then
  echo "❌ Could not resolve host gateway IP for Redis (is compose redis up?)" >&2
  exit 1
fi
if [[ "$ip" == 127.* ]] || [[ "$ip" == ::1* ]]; then
  echo "❌ Resolved Redis IP is loopback ($ip) — Kubernetes Endpoints reject 127.0.0.0/8 and ::1" >&2
  exit 1
fi

echo "Syncing redis-external Endpoints → ${ip}:${REDIS_PORT} (namespace ${NS}, host-published via gateway)"

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
        port: ${REDIS_PORT}
        protocol: TCP
EOF

if [[ "${RP_REDIS_SYNC_SKIP_VERIFY:-0}" == "1" ]]; then
  echo "✅ redis-external endpoints synced to $ip (pod verify skipped; re-run after rollouts or set RP_REDIS_SYNC_SKIP_VERIFY=0)"
  exit 0
fi

if ! _wait_for_probe_deploy; then
  echo "❌ deployment/$PROBE_DEPLOY not ready — cannot verify redis-external from a pod" >&2
  exit 1
fi

verified=0
for ((attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++)); do
  if _verify_pod_ping; then
    echo "✅ Pod PING via redis-external OK (attempt ${attempt}/${VERIFY_ATTEMPTS})"
    verified=1
    break
  fi
  if [[ "$attempt" -lt "$VERIFY_ATTEMPTS" ]]; then
    echo "  … redis-external PING retry ${attempt}/${VERIFY_ATTEMPTS}" >&2
    sleep "$VERIFY_SLEEP"
  fi
done

if [[ "$verified" -ne 1 ]]; then
  echo "❌ redis-external Endpoints patched to ${ip} but pod PING failed after ${VERIFY_ATTEMPTS} attempts" >&2
  echo "   Check: kubectl exec -n $NS deploy/$PROBE_DEPLOY -c app -- getent hosts host.docker.internal" >&2
  echo "   Run: ./scripts/colima-apply-host-aliases.sh (Colima) or ensure REDIS_URL / gateway IP matches" >&2
  exit 1
fi

echo "✅ redis-external endpoints synced to $ip (gateway; Compose redis on host :${REDIS_PORT})"
