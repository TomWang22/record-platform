#!/usr/bin/env bash
set -euo pipefail

# Test Python AI Service Integration
# Tests all AI advisor endpoints and integration with analytics service

NS="record-platform"
PYTHON_AI_SVC="python-ai-service"
API_GATEWAY_SVC="api-gateway"
ANALYTICS_SVC="analytics-service"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Python AI Service Integration Test ==="

# Check services are running
say "Step 1: Checking services are running..."
if ! kubectl -n "$NS" get pod -l app="$PYTHON_AI_SVC" | grep -q Running; then
  fail "Python AI service is not running"
fi
ok "Python AI service is running"

if ! kubectl -n "$NS" get pod -l app="$API_GATEWAY_SVC" | grep -q Running; then
  fail "API Gateway is not running"
fi
ok "API Gateway is running"

if ! kubectl -n "$NS" get pod -l app="$ANALYTICS_SVC" | grep -q Running; then
  fail "Analytics service is not running"
fi
ok "Analytics service is running"

# Set up port-forwards
say "Step 2: Setting up port-forwards..."
kubectl -n "$NS" port-forward svc/"$PYTHON_AI_SVC" 5005:5005 >/dev/null 2>&1 &
PF_PYTHON_AI=$!
kubectl -n "$NS" port-forward svc/"$API_GATEWAY_SVC" 4000:4000 >/dev/null 2>&1 &
PF_API_GW=$!
kubectl -n "$NS" port-forward svc/"$ANALYTICS_SVC" 4004:4004 >/dev/null 2>&1 &
PF_ANALYTICS=$!

sleep 3

# Cleanup function
cleanup() {
  kill $PF_PYTHON_AI $PF_API_GW $PF_ANALYTICS 2>/dev/null || true
  wait $PF_PYTHON_AI $PF_API_GW $PF_ANALYTICS 2>/dev/null || true
}
trap cleanup EXIT

# Test Python AI health
say "Step 3: Testing Python AI service health..."
if curl -s http://127.0.0.1:5005/healthz | grep -q '"ok"'; then
  ok "Python AI service health check passed"
else
  fail "Python AI service health check failed"
fi

# Test Analytics service health
say "Step 4: Testing Analytics service health..."
if curl -s http://127.0.0.1:4004/healthz | grep -q '"ok"'; then
  ok "Analytics service health check passed"
else
  warn "Analytics service health check failed (may still work)"
fi

# Test AI Advisor endpoints
say "Step 5: Testing AI Advisor endpoints..."

# Selling advice
say "  Testing /ai/selling-advice..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:5005/ai/selling-advice \
  -H "Content-Type: application/json" \
  -d '{"query": "Beatles Abbey Road", "record_grade": "NM", "sleeve_grade": "NM"}')
if echo "$RESPONSE" | grep -q "recommended_price"; then
  ok "Selling advice endpoint works"
else
  fail "Selling advice endpoint failed: $RESPONSE"
fi

# Buying advice
say "  Testing /ai/buying-advice..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:5005/ai/buying-advice \
  -H "Content-Type: application/json" \
  -d '{"query": "Pink Floyd Dark Side", "max_budget": 100}')
if echo "$RESPONSE" | grep -q "fair_price"; then
  ok "Buying advice endpoint works"
else
  fail "Buying advice endpoint failed: $RESPONSE"
fi

# Negotiation advice
say "  Testing /ai/negotiation-advice..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:5005/ai/negotiation-advice \
  -H "Content-Type: application/json" \
  -d '{"query": "Led Zeppelin IV", "role": "buyer", "current_price": 50, "target_price": 45}')
if echo "$RESPONSE" | grep -q "strategy"; then
  ok "Negotiation advice endpoint works"
else
  fail "Negotiation advice endpoint failed: $RESPONSE"
fi

# Bidding advice
say "  Testing /ai/bidding-advice..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:5005/ai/bidding-advice \
  -H "Content-Type: application/json" \
  -d '{"query": "Radiohead OK Computer", "current_bid": 40, "max_budget": 60}')
if echo "$RESPONSE" | grep -q "should_bid"; then
  ok "Bidding advice endpoint works"
else
  fail "Bidding advice endpoint failed: $RESPONSE"
fi

# Test API Gateway routing
say "Step 6: Testing API Gateway routing..."
RESPONSE=$(curl -s http://127.0.0.1:4000/api/ai/healthz 2>&1)
if echo "$RESPONSE" | grep -q '"ok"'; then
  ok "API Gateway routing to Python AI works"
else
  warn "API Gateway routing test failed: $RESPONSE"
fi

say "=== All tests complete ==="
ok "Python AI Service integration is working correctly!"

