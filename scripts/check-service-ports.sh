#!/usr/bin/env bash
set -euo pipefail

# Check all service ports to ensure they're not conflicting
# Verify pods are running and ports are correctly configured

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

NS="record-platform"

# Expected ports
declare -A SERVICE_PORTS=(
  ["api-gateway"]="4000:HTTP,50051:gRPC"
  ["auth-service"]="4001:HTTP,50051:gRPC"
  ["records-service"]="4002:HTTP,50051:gRPC"
  ["listings-service"]="4003:HTTP,50057:gRPC"
  ["analytics-service"]="4004:HTTP,50054:gRPC"
  ["social-service"]="4006:HTTP,50056:gRPC"
  ["shopping-service"]="4007:HTTP,50058:gRPC"
  ["auction-monitor"]="4008:HTTP,50059:gRPC"
  ["python-ai-service"]="5005:HTTP,50060:gRPC"
  ["webapp"]="3001:HTTP"
  ["nginx"]="8080:HTTP"
  ["haproxy"]="8081:HTTP,8404:Stats"
)

say "=== Checking Service Ports and Pod Status ==="

# Check kubectl connectivity
if ! kubectl get nodes >/dev/null 2>&1; then
  fail "kubectl cannot connect to cluster"
  say "Fixing cluster connection..."
  docker restart h3-control-plane
  sleep 45
  if ! kubectl get nodes >/dev/null 2>&1; then
    fail "Cluster still not accessible"
    exit 1
  fi
  ok "Cluster connection restored"
fi

# Check Docker containers for port conflicts
say "Step 1: Checking Docker container port usage..."
CONFLICTS=0
for port in 4000 4001 4002 4003 4004 4006 4007 4008 5005 50051 50054 50056 50057 50058 50059 50060 3001 8080 8081; do
  COUNT=$(docker ps --format "{{.Ports}}" | grep -c ":$port" || echo "0")
  if [ "$COUNT" -gt 1 ]; then
    warn "Port $port is used by $COUNT containers (potential conflict)"
    docker ps --format "table {{.Names}}\t{{.Ports}}" | grep ":$port"
    CONFLICTS=$((CONFLICTS + 1))
  fi
done

if [ "$CONFLICTS" -eq 0 ]; then
  ok "No Docker port conflicts detected"
else
  warn "$CONFLICTS potential port conflicts found"
fi

# Check Kubernetes services
say "Step 2: Checking Kubernetes service ports..."
kubectl get svc -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.ports[*]}{.port}{":"}{.protocol}{" "}{end}{"\n"}{end}' 2>/dev/null | while read -r svc ports; do
  echo "  $svc: $ports"
done

# Check pod status
say "Step 3: Checking pod status..."
PODS=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null || echo "")
if [ -z "$PODS" ]; then
  fail "No pods found in namespace $NS"
  exit 1
fi

HEALTHY=0
UNHEALTHY=0
while IFS= read -r line; do
  POD_NAME=$(echo "$line" | awk '{print $1}')
  READY=$(echo "$line" | awk '{print $2}')
  STATUS=$(echo "$line" | awk '{print $3}')
  
  # Extract service name from pod name
  SERVICE_NAME=$(echo "$POD_NAME" | sed 's/-[0-9].*//')
  
  if [[ "$READY" =~ ^[0-9]+/[0-9]+$ ]]; then
    READY_COUNT=$(echo "$READY" | cut -d'/' -f1)
    TOTAL_COUNT=$(echo "$READY" | cut -d'/' -f2)
    
    if [ "$READY_COUNT" -eq "$TOTAL_COUNT" ] && [ "$STATUS" == "Running" ]; then
      ok "$SERVICE_NAME: $READY ($STATUS)"
      HEALTHY=$((HEALTHY + 1))
    else
      warn "$SERVICE_NAME: $READY ($STATUS)"
      UNHEALTHY=$((UNHEALTHY + 1))
      
      # Show pod details for unhealthy pods
      echo "    Pod: $POD_NAME"
      if [ "$STATUS" == "Error" ] || [ "$STATUS" == "CrashLoopBackOff" ]; then
        echo "    Last logs:"
        kubectl logs -n "$NS" "$POD_NAME" --tail=5 2>&1 | sed 's/^/      /' || true
      fi
    fi
  fi
done <<< "$PODS"

echo
say "Pod Status Summary:"
echo "  Healthy: $HEALTHY"
echo "  Unhealthy: $UNHEALTHY"

# Check service ports in deployments
say "Step 4: Verifying service port configuration..."
for service in "${!SERVICE_PORTS[@]}"; do
  if kubectl get deployment "$service" -n "$NS" >/dev/null 2>&1; then
    EXPECTED_PORTS="${SERVICE_PORTS[$service]}"
    ok "$service: Expected ports $EXPECTED_PORTS"
  else
    warn "$service: Deployment not found"
  fi
done

# Check for Puddle port conflicts
say "Step 5: Checking for Puddle port conflicts..."
PUDDLE_CONTAINERS=$(docker ps --format "{{.Names}}" | grep -i puddle || echo "")
if [ -n "$PUDDLE_CONTAINERS" ]; then
  warn "Puddle containers detected:"
  for container in $PUDDLE_CONTAINERS; do
    PORTS=$(docker port "$container" 2>/dev/null || echo "N/A")
    echo "  $container: $PORTS"
  done
  
  # Check for overlapping ports
  for port in 4000 4001 4002 4003 4004 4006 4007 4008 5005 50051 50054 50056 50057 50058 50059 50060 3001 8080 8081; do
    PUDDLE_USES=$(docker ps --format "{{.Names}}\t{{.Ports}}" | grep -i puddle | grep -c ":$port" || echo "0")
    if [ "$PUDDLE_USES" -gt 0 ]; then
      warn "Puddle may be using port $port"
    fi
  done
else
  ok "No Puddle containers detected"
fi

# Summary
say "=== Summary ==="
if [ "$UNHEALTHY" -eq 0 ]; then
  ok "All service pods are healthy"
else
  warn "$UNHEALTHY pods need attention"
  say "To fix unhealthy pods:"
  echo "  1. Check logs: kubectl logs -n $NS <pod-name>"
  echo "  2. Restart deployment: kubectl rollout restart deployment/<service-name> -n $NS"
  echo "  3. Check events: kubectl describe pod <pod-name> -n $NS"
fi

if [ "$CONFLICTS" -eq 0 ]; then
  ok "No port conflicts detected"
else
  warn "Review port conflicts above"
fi

