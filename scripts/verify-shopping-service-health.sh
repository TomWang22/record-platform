#!/usr/bin/env bash
set -euo pipefail

# Verify Shopping Service Health Checks and Configuration

echo "🔍 Verifying Shopping Service Health Checks and Configuration..."
echo ""

CONTEXT="${CONTEXT:-kind-h3}"
NAMESPACE="record-platform"
SERVICE_NAME="shopping-service"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check 1: Verify health.proto is in ConfigMap
echo "1️⃣  Checking health.proto in ConfigMap..."
if kubectl get configmap proto-files -n "$NAMESPACE" --context "$CONTEXT" -o jsonpath='{.data.health\.proto}' | grep -q "grpc.health.v1"; then
  echo -e "${GREEN}✓${NC} health.proto found in proto-files ConfigMap"
else
  echo -e "${RED}✗${NC} health.proto NOT found in proto-files ConfigMap"
fi
echo ""

# Check 2: Verify Caddyfile has shopping service health check routing
echo "2️⃣  Checking Caddyfile health check configuration..."
if kubectl get configmap caddy-h3 -n ingress-nginx --context "$CONTEXT" -o jsonpath='{.data.Caddyfile}' | grep -q "shopping-service.record-platform.svc.cluster.local:50058"; then
  echo -e "${GREEN}✓${NC} Caddyfile routes health checks to shopping-service:50058"
else
  echo -e "${RED}✗${NC} Caddyfile missing shopping-service health check routing"
fi
echo ""

# Check 3: Verify Redis is accessible
echo "3️⃣  Checking Redis connectivity..."
REDIS_POD=$(docker ps --filter "name=redis" --format "{{.Names}}" | head -1)
if [ -n "$REDIS_POD" ]; then
  if docker exec "$REDIS_POD" redis-cli ping >/dev/null 2>&1 || docker exec "$REDIS_POD" redis-cli -a "$(kubectl get secret app-secrets -n "$NAMESPACE" --context "$CONTEXT" -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d 2>/dev/null || echo '')" ping >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Redis is accessible"
  else
    echo -e "${RED}✗${NC} Redis is NOT accessible"
  fi
else
  echo -e "${YELLOW}⚠${NC}  Redis container not found"
fi
echo ""

# Check 4: Verify database exists
echo "4️⃣  Checking shopping database..."
if PGPASSWORD=postgres psql -h 127.0.0.1 -p 5436 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='shopping';" 2>/dev/null | grep -q 1; then
  echo -e "${GREEN}✓${NC} Database 'shopping' exists"
else
  echo -e "${RED}✗${NC} Database 'shopping' does NOT exist"
fi
echo ""

# Check 5: Verify shopping service pod status
echo "5️⃣  Checking shopping service pod status..."
POD_STATUS=$(kubectl get pods -n "$NAMESPACE" --context "$CONTEXT" -l app="$SERVICE_NAME" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "NotFound")
if [ "$POD_STATUS" = "Running" ]; then
  echo -e "${GREEN}✓${NC} Shopping service pod is Running"
  
  # Check if health probe is passing
  READY=$(kubectl get pods -n "$NAMESPACE" --context "$CONTEXT" -l app="$SERVICE_NAME" -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
  if [ "$READY" = "True" ]; then
    echo -e "${GREEN}✓${NC} Shopping service pod is Ready (health checks passing)"
    
    # Try to run grpc-health-probe
    POD_NAME=$(kubectl get pods -n "$NAMESPACE" --context "$CONTEXT" -l app="$SERVICE_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$POD_NAME" ]; then
      if kubectl exec -n "$NAMESPACE" --context "$CONTEXT" "$POD_NAME" -- /usr/local/bin/grpc-health-probe -addr=localhost:50058 -service=shopping.ShoppingService >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} gRPC health probe passes (grpc.health.v1.Health/Check)"
      else
        echo -e "${RED}✗${NC} gRPC health probe FAILED"
      fi
    fi
  else
    echo -e "${YELLOW}⚠${NC}  Shopping service pod is NOT Ready (health checks may be failing)"
  fi
  
  POD_NAME=$(kubectl get pods -n "$NAMESPACE" --context "$CONTEXT" -l app="$SERVICE_NAME" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
else
  echo -e "${RED}✗${NC} Shopping service pod status: $POD_STATUS"
  POD_NAME=""
fi
echo ""

# Check 6: Verify strict TLS configuration
echo "6️⃣  Checking strict TLS configuration..."
if kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" --context "$CONTEXT" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="NODE_TLS_REJECT_UNAUTHORIZED")].value}' 2>/dev/null | grep -q "1"; then
  echo -e "${GREEN}✓${NC} NODE_TLS_REJECT_UNAUTHORIZED=1 (strict TLS enabled)"
else
  echo -e "${YELLOW}⚠${NC}  NODE_TLS_REJECT_UNAUTHORIZED not set to 1"
fi

if kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" --context "$CONTEXT" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="TLS_KEY_PATH")].value}' 2>/dev/null | grep -q "/etc/certs"; then
  echo -e "${GREEN}✓${NC} TLS certificates configured"
else
  echo -e "${YELLOW}⚠${NC}  TLS certificates not configured"
fi
echo ""

# Check 7: Verify Lua scripts
echo "7️⃣  Checking Lua scripts..."
if [ -f "services/shopping-service/src/lib/lfu_lru_cache.lua" ]; then
  echo -e "${GREEN}✓${NC} Lua script source exists: lfu_lru_cache.lua"
  
  # If pod is running, check if it's in the image
  if [ "$POD_STATUS" = "Running" ] && [ -n "$POD_NAME" ]; then
    if kubectl exec -n "$NAMESPACE" --context "$CONTEXT" "$POD_NAME" -- ls /app/services/shopping-service/dist/lib/*.lua >/dev/null 2>&1; then
      echo -e "${GREEN}✓${NC} Lua scripts found in pod"
    else
      echo -e "${YELLOW}⚠${NC}  Lua scripts NOT found in pod (may need image rebuild)"
    fi
  fi
else
  echo -e "${RED}✗${NC} Lua script source NOT found"
fi
echo ""

# Check 8: Verify secrets and configmaps
echo "8️⃣  Checking required secrets and configmaps..."
REQUIRED_SECRETS=("dev-root-ca" "service-tls" "app-secrets")
REQUIRED_CONFIGMAPS=("proto-files" "app-config")

for secret in "${REQUIRED_SECRETS[@]}"; do
  if kubectl get secret "$secret" -n "$NAMESPACE" --context "$CONTEXT" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Secret '$secret' exists"
  else
    echo -e "${RED}✗${NC} Secret '$secret' NOT found"
  fi
done

for cm in "${REQUIRED_CONFIGMAPS[@]}"; do
  if kubectl get configmap "$cm" -n "$NAMESPACE" --context "$CONTEXT" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} ConfigMap '$cm' exists"
  else
    echo -e "${RED}✗${NC} ConfigMap '$cm' NOT found"
  fi
done
echo ""

echo "✅ Health check verification complete!"
echo ""
echo "📝 Summary:"
echo "   - After rebuilding the shopping service image with the health service fix,"
echo "     the health checks should pass."
echo "   - The service now registers the standard grpc.health.v1.Health service"
echo "   - Database and Redis connectivity are checked in health probes"
