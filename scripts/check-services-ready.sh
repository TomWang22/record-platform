#!/usr/bin/env bash
# Check if services are ready for k6 testing

set -euo pipefail

NAMESPACE="${NAMESPACE:-record-platform}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "🔍 Checking service readiness for k6 testing..."
echo ""

# Check shopping service
echo "📦 Shopping Service:"
SHOPPING_READY=$(kubectl -n "$NAMESPACE" get deployment shopping-service -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
SHOPPING_DESIRED=$(kubectl -n "$NAMESPACE" get deployment shopping-service -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [ "$SHOPPING_READY" = "$SHOPPING_DESIRED" ] && [ "$SHOPPING_READY" != "0" ]; then
  log_info "✓ Shopping service is ready ($SHOPPING_READY/$SHOPPING_DESIRED pods)"
else
  log_error "✗ Shopping service is NOT ready ($SHOPPING_READY/$SHOPPING_DESIRED pods)"
  echo "  Logs:"
  kubectl -n "$NAMESPACE" logs -l app=shopping-service --tail=5 2>&1 | sed 's/^/    /' || true
fi

# Check auth service
echo ""
echo "🔐 Auth Service:"
AUTH_READY=$(kubectl -n "$NAMESPACE" get deployment auth-service -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
AUTH_DESIRED=$(kubectl -n "$NAMESPACE" get deployment auth-service -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
if [ "$AUTH_READY" = "$AUTH_DESIRED" ] && [ "$AUTH_READY" != "0" ]; then
  log_info "✓ Auth service is ready ($AUTH_READY/$AUTH_DESIRED pods)"
else
  log_warn "⚠ Auth service is partially ready ($AUTH_READY/$AUTH_DESIRED pods)"
fi

# Check databases
echo ""
echo "🗄️  Databases:"
DB_COUNT=$(docker ps --filter "name=postgres" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
if [ "$DB_COUNT" -ge "8" ]; then
  log_info "✓ All databases running ($DB_COUNT PostgreSQL instances)"
  docker ps --filter "name=postgres" --format "  - {{.Names}}: {{.Status}}" 2>/dev/null | head -3
else
  log_error "✗ Not all databases running (found $DB_COUNT, expected 8+)"
fi

# Check Redis
echo ""
echo "📮 Redis:"
REDIS_STATUS=$(docker ps --filter "name=redis" --format "{{.Status}}" 2>/dev/null | head -1 || echo "")
if [ -n "$REDIS_STATUS" ]; then
  log_info "✓ Redis is running ($REDIS_STATUS)"
else
  log_error "✗ Redis is NOT running"
fi

# Check shopping DB specifically
echo ""
echo "🛒 Shopping Database (port 5436):"
SHOPPING_DB=$(docker ps --filter "name=postgres-shopping" --format "{{.Names}}\t{{.Status}}" 2>/dev/null | head -1)
if [ -n "$SHOPPING_DB" ]; then
  log_info "✓ Shopping DB: $SHOPPING_DB"
else
  log_error "✗ Shopping DB is NOT running"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$SHOPPING_READY" = "$SHOPPING_DESIRED" ] && [ "$SHOPPING_READY" != "0" ] && \
   [ "$AUTH_READY" != "0" ] && [ "$DB_COUNT" -ge "8" ] && [ -n "$REDIS_STATUS" ]; then
  log_info "✅ All services ready for k6 testing!"
  echo ""
  echo "Run k6 test:"
  echo "  k6 run --vus 50 --duration 10m scripts/load/k6-shopping-ramp.js"
  exit 0
else
  log_error "❌ Services NOT ready. Please fix issues above before running k6 tests."
  exit 1
fi
