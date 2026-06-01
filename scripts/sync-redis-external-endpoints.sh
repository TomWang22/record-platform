#!/usr/bin/env bash
# Point redis-external Endpoints at the Docker Compose Redis container IP (deterministic after compose up).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${K8S_NAMESPACE:-record-platform}"

_resolve_redis_ip() {
  local ip name
  for name in record-platform-redis record-platform-redis-1 redis; do
    ip="$(docker inspect "$name" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1 || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  done
  ip="$(docker ps --filter 'publish=6379' --format '{{.ID}}' 2>/dev/null | head -1)"
  if [[ -n "$ip" ]]; then
    docker inspect "$ip" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null | head -1
    return 0
  fi
  return 1
}

ip="$(_resolve_redis_ip || true)"
if [[ -z "$ip" ]]; then
  echo "❌ Could not resolve Docker Redis container IP (is compose redis up?)" >&2
  exit 1
fi
if [[ "$ip" == 127.* ]] || [[ "$ip" == ::1* ]]; then
  echo "❌ Resolved Redis IP is loopback ($ip) — Kubernetes Endpoints reject 127.0.0.0/8 and ::1" >&2
  exit 1
fi

echo "Syncing redis-external Endpoints → ${ip}:6379 (namespace ${NS})"

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
        port: 6379
        protocol: TCP
EOF

# Verify from a pod if auth-service exists
if kubectl -n "$NS" get deploy auth-service >/dev/null 2>&1; then
  if kubectl -n "$NS" exec deploy/auth-service -c app -- env RP_REDIS_HOST="redis-external.${NS}.svc.cluster.local" RP_REDIS_PORT=6379 node -e "
const net=require('net');
const h=process.env.RP_REDIS_HOST,p=+process.env.RP_REDIS_PORT;
const s=net.createConnection(p,h);
s.on('connect',()=>s.write('*1\r\n\$4\r\nPING\r\n'));
let d='';s.on('data',c=>{d+=c;if(d.includes('PONG')){console.log('PONG');process.exit(0)}});
s.on('error',e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),5000);
" 2>/dev/null | grep -q PONG; then
    echo "✅ Pod PING via redis-external OK"
  else
    echo "⚠️  Endpoints patched but pod PING not verified yet" >&2
  fi
fi

echo "✅ redis-external endpoints synced to $ip"
