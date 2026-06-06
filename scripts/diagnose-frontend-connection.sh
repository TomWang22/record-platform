#!/bin/bash
# Diagnose frontend connection issues
set -euo pipefail

HOST="${HOST:-record.local}"
API_PORT="${API_PORT:-8080}"

echo "=== Frontend Connection Diagnostics ==="
echo ""

# Check if port-forward is needed
echo "1. Checking if API Gateway is accessible..."
if curl -s "http://localhost:${API_PORT}/health" > /dev/null 2>&1; then
  echo "✅ API Gateway is accessible at http://localhost:${API_PORT}"
else
  echo "⚠️  API Gateway not accessible at http://localhost:${API_PORT}"
  echo "   → You need to port-forward the service:"
  echo "   → kubectl port-forward -n record-platform svc/api-gateway ${API_PORT}:4000"
  echo ""
  echo "   Attempting to start port-forward..."
  if kubectl port-forward -n record-platform svc/api-gateway ${API_PORT}:4000 > /tmp/k8s-portforward.log 2>&1 & then
    PF_PID=$!
    sleep 3
    if curl -s "http://localhost:${API_PORT}/health" > /dev/null 2>&1; then
      echo "✅ Port-forward started successfully (PID: $PF_PID)"
      echo "   → Keep this terminal open or run port-forward in background"
    else
      echo "❌ Port-forward failed - check logs: /tmp/k8s-portforward.log"
      kill $PF_PID 2>/dev/null || true
    fi
  else
    echo "❌ Failed to start port-forward"
  fi
fi

echo ""
echo "2. Testing API Gateway endpoints..."
if curl -s "http://localhost:${API_PORT}/health" > /dev/null 2>&1; then
  echo "✅ /health endpoint works"
  HEALTH_RESPONSE=$(curl -s "http://localhost:${API_PORT}/health")
  echo "   Response: $HEALTH_RESPONSE"
else
  echo "❌ /health endpoint failed"
fi

echo ""
echo "3. Testing CORS headers..."
CORS_RESPONSE=$(curl -s -I -H "Origin: http://localhost:3001" \
  "http://localhost:${API_PORT}/health" 2>&1 || echo "")
if echo "$CORS_RESPONSE" | grep -qi "access-control"; then
  echo "✅ CORS headers present"
  echo "$CORS_RESPONSE" | grep -i "access-control" | head -3
else
  echo "⚠️  CORS headers not found (may be normal for /health endpoint)"
fi

echo ""
echo "4. Checking frontend configuration..."
if [[ -f "webapp/lib/config.ts" ]]; then
  GATEWAY_URL=$(grep -E "gatewayUrl|GATEWAY_URL" webapp/lib/config.ts | head -1 | sed 's/.*\(http[^"]*\).*/\1/' || echo "not found")
  echo "   Frontend gateway URL: $GATEWAY_URL"
  if [[ "$GATEWAY_URL" == *"localhost:${API_PORT}"* ]]; then
    echo "✅ Frontend configured for localhost:${API_PORT}"
  else
    echo "⚠️  Frontend gateway URL doesn't match expected localhost:${API_PORT}"
    echo "   → Check webapp/lib/config.ts or NEXT_PUBLIC_GATEWAY_URL env var"
  fi
else
  echo "⚠️  webapp/lib/config.ts not found"
fi

echo ""
echo "5. Checking Kubernetes services..."
if kubectl get svc -n record-platform api-gateway > /dev/null 2>&1; then
  echo "✅ API Gateway service exists"
  kubectl get svc -n record-platform api-gateway
else
  echo "❌ API Gateway service not found"
fi

echo ""
echo "6. Checking API Gateway pods..."
if kubectl get pods -n record-platform -l app=api-gateway > /dev/null 2>&1; then
  echo "✅ API Gateway pods:"
  kubectl get pods -n record-platform -l app=api-gateway
  POD_NAME=$(kubectl get pods -n record-platform -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$POD_NAME" ]]; then
    POD_STATUS=$(kubectl get pod -n record-platform "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    echo "   Pod status: $POD_STATUS"
    if [[ "$POD_STATUS" != "Running" ]]; then
      echo "   ⚠️  Pod is not Running - check logs: kubectl logs -n record-platform $POD_NAME"
    fi
  fi
else
  echo "❌ API Gateway pods not found"
fi

echo ""
echo "=== Summary ==="
echo ""
echo "To fix connection issues:"
echo "1. Ensure port-forward is running: kubectl port-forward -n record-platform svc/api-gateway ${API_PORT}:4000"
echo "2. Check frontend config: webapp/lib/config.ts should use http://localhost:${API_PORT}"
echo "3. Verify CORS is enabled in API Gateway for localhost:3001"
echo "4. Check API Gateway logs: kubectl logs -n record-platform -l app=api-gateway"
echo ""
echo "Note: Services run in Kubernetes, NOT Docker. They persist even if Docker Desktop is closed."

