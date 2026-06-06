#!/usr/bin/env bash
# Diagnose slow startup / probe failures for one RP deployment.
# Usage: diagnose-rp-service-startup.sh <deployment> [namespace]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY="${1:?deployment name e.g. trust-service}"
NS="${2:-record-platform}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$REPO_ROOT/bench_logs/service-startup/$DEPLOY-$TS"
mkdir -p "$OUT"

pod="$(kubectl get pods -n "$NS" -l "app=$DEPLOY" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[[ -n "$pod" ]] || { echo "no pod for app=$DEPLOY in $NS" >&2; exit 1; }

python3 - <<PY >"$OUT/contract-port.json"
import json
from pathlib import Path
c = json.loads(Path("$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json").read_text())
s = c["services"].get("$DEPLOY", {})
print(json.dumps(s, indent=2))
PY

{
  echo "# Startup diagnose: $DEPLOY"
  echo "Pod: $pod"
  kubectl get pod "$pod" -n "$NS" -o wide
  kubectl describe pod "$pod" -n "$NS" >"$OUT/describe.txt"
  kubectl logs "$pod" -n "$NS" --all-containers --tail=200 >"$OUT/logs.txt" 2>&1 || true
  kubectl logs "$pod" -n "$NS" --all-containers --previous --tail=100 >"$OUT/logs-previous.txt" 2>&1 || true
} >"$OUT/summary.md"

hp="$(python3 -c "import json; print(json.load(open('$OUT/contract-port.json')).get('httpPort',''))")"
if [[ -n "$hp" && "$hp" != "null" ]]; then
  kubectl exec -n "$NS" "$pod" -c app -- sh -c "
    echo '=== listen ==='
    (ss -lntp 2>/dev/null || netstat -lnt 2>/dev/null || true) | head -20
    echo '=== curl healthz ==='
    if command -v curl >/dev/null 2>&1; then
      curl -sS -m 3 -w '\nhttp_code=%{http_code}\n' http://127.0.0.1:${hp}/healthz || echo FAIL
      curl -sS -m 3 -w '\nhttp_code=%{http_code}\n' http://127.0.0.1:${hp}/readyz || echo FAIL
    fi
    echo '=== env ports ==='
    env | grep -E 'PORT|POSTGRES|KAFKA|TLS|GRPC' | sort
  " >"$OUT/exec-in-pod.txt" 2>&1 || true
fi

echo "Wrote $OUT/summary.md"
