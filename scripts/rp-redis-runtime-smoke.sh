#!/usr/bin/env bash
# Runtime Redis reachability from cluster (no secret values).
set -euo pipefail

NS="${K8S_NAMESPACE:-record-platform}"
REPORT_DIR="${REPORT_DIR:-bench_logs/redis-lua-contract}"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/runtime-smoke.md"

redis_host="${REDIS_HOST:-redis.record-platform.svc.cluster.local}"
redis_port="${REDIS_PORT:-6379}"

{
  echo "# Redis runtime smoke"
  echo ""
  echo "- Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Target: \`${redis_host}:${redis_port}\`"
  echo ""
} >"$REPORT"

ping_ok=no
if kubectl -n "$NS" run rp-redis-ping --rm -i --restart=Never --image=redis:7-alpine -- \
  redis-cli -h "${redis_host%%.*}" -p "$redis_port" PING 2>/dev/null | grep -q PONG; then
  ping_ok=yes
  echo "- PING: OK" >>"$REPORT"
else
  echo "- PING: FAIL (debug pod or redis unreachable)" >>"$REPORT"
fi

for dep in auth-service api-gateway shopping-service messaging-service; do
  if kubectl -n "$NS" get deploy "$dep" &>/dev/null; then
    env_present="$(kubectl -n "$NS" set env deployment/"$dep" --list 2>/dev/null | grep -c REDIS || true)"
    echo "- $dep REDIS_* env lines: $env_present" >>"$REPORT"
  else
    echo "- $dep: not deployed" >>"$REPORT"
  fi
done

if [[ "$ping_ok" != yes ]]; then
  echo "⚠️  Redis PING failed — see $REPORT" >&2
  exit 1
fi
echo "✅ Redis runtime smoke — $REPORT"
