#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Investigating Social Service ==="

# Get social service pods
PODS=$(kubectl -n "$NS" get pods -l app=social-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$PODS" ]]; then
  fail "No social service pods found"
  exit 1
fi

POD=$(echo "$PODS" | awk '{print $1}')
say "Investigating pod: $POD"

# Check pod status
say "Pod Status:"
kubectl -n "$NS" get pod "$POD" -o wide

# Check recent events
say "Recent Events:"
kubectl -n "$NS" describe pod "$POD" 2>&1 | grep -A 10 "Events:" | head -15

# Check logs
say "Recent Logs (last 50 lines):"
kubectl -n "$NS" logs "$POD" --tail=50 2>&1 | tail -30

# Check environment variables
say "Environment Variables:"
kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].envFrom}' | jq '.' 2>/dev/null || \
kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].envFrom}'

# Check ConfigMap
say "Database Configuration:"
kubectl -n "$NS" get configmap app-config -o jsonpath='{.data.POSTGRES_URL_SOCIAL}' 2>/dev/null && echo ""

# Check if pod can reach database
say "Testing Database Connectivity:"
DB_URL=$(kubectl -n "$NS" get configmap app-config -o jsonpath='{.data.POSTGRES_URL_SOCIAL}' 2>/dev/null || echo "")
if [[ -n "$DB_URL" ]]; then
  PGHOST=$(echo "$DB_URL" | sed 's|.*@\([^:]*\):.*|\1|')
  PGPORT=$(echo "$DB_URL" | sed 's|.*:\([0-9]*\)/.*|\1|')
  kubectl -n "$NS" run db-test-social --rm -i --restart=Never --image=postgres:16 --timeout=10s --quiet -- \
    sh -c "nc -zv $PGHOST $PGPORT 2>&1 || echo 'Connection test failed'" 2>&1 || true
else
  warn "Could not get POSTGRES_URL_SOCIAL from ConfigMap"
fi

# Check health endpoint if pod is running
if kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
  say "Testing Health Endpoint:"
  kubectl -n "$NS" run curl-health-social --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
    curl -sS -w "\n%{http_code}" "http://social-service.record-platform.svc.cluster.local:4006/healthz" 2>&1 | tail -5 || true
fi

say "=== Investigation Complete ==="
echo ""
echo "Next steps:"
echo "1. Check if database is accessible: kubectl -n $NS get configmap app-config -o yaml | grep POSTGRES_URL_SOCIAL"
echo "2. Rebuild service with health check fix: ./scripts/build-and-load.sh h3"
echo "3. Restart deployment: kubectl -n $NS rollout restart deploy/social-service"
echo "4. Monitor logs: kubectl -n $NS logs -f -l app=social-service"

