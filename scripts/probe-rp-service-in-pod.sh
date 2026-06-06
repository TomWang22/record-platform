#!/usr/bin/env bash
# In-pod probe helper: HTTP health/ready + optional grpcurl.
# Usage: probe-rp-service-in-pod.sh <deployment|pod> [namespace]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:?deployment or pod name}"
NS="${2:-record-platform}"
CONTRACT="$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json"

pod="$TARGET"
if kubectl get deploy "$TARGET" -n "$NS" >/dev/null 2>&1; then
  pod="$(kubectl get pods -n "$NS" -l "app=$TARGET" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
fi
[[ -n "$pod" ]] || { echo "no pod for $TARGET" >&2; exit 1; }

read -r http_port grpc_port health_path ready_path < <(
  python3 - "$CONTRACT" "$TARGET" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["services"]
key = sys.argv[2].replace("-service", "-service")
if key not in c:
    key = sys.argv[2]
s = c.get(key) or c.get(sys.argv[2])
if not s:
    print("0 0 /healthz /healthz")
else:
    print(s["httpPort"], s.get("grpcPort") or 0, s["healthPath"], s.get("readyPath", s["healthPath"]))
PY
)

echo "Pod: $pod (ns=$NS) contract HTTP=$http_port gRPC=$grpc_port"
kubectl exec -n "$NS" "$pod" -c app -- sh -c "
  echo '--- listen ---'
  (ss -lntp 2>/dev/null || netstat -lnt 2>/dev/null || true) | head -25
  echo '--- curl health ---'
  if command -v curl >/dev/null 2>&1; then
    curl -sfS -o /dev/null -w 'healthz %{http_code}\n' http://127.0.0.1:${http_port}${health_path} || echo healthz FAIL
    curl -sfS -o /dev/null -w 'ready %{http_code}\n' http://127.0.0.1:${http_port}${ready_path} || echo ready FAIL
  else
    node -e \"const h=require('http');h.get('http://127.0.0.1:${http_port}${health_path}',r=>{console.log('health',r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',e=>{console.error(e);process.exit(1)})\" || true
  fi
" 2>&1 || kubectl exec -n "$NS" "$pod" -- sh -c "echo fallback container list; true" 2>&1

if [[ "${grpc_port:-0}" != "0" ]]; then
  kubectl exec -n "$NS" "$pod" -c app -- sh -c "command -v grpcurl >/dev/null && grpcurl -plaintext localhost:${grpc_port} list || echo 'grpcurl N/A'" 2>&1 || true
fi

kubectl logs -n "$NS" "$pod" --tail=15 2>&1 || true
