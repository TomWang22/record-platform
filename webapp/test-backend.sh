#!/bin/bash
# Comprehensive script to test frontend-backend connection
set -euo pipefail

GATEWAY_URL="${NEXT_PUBLIC_GATEWAY_URL:-http://localhost:8080}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3001}"

echo "=========================================="
echo "Frontend-Backend Connection Test"
echo "=========================================="
echo ""
echo "Gateway URL: $GATEWAY_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""

# Test 1: Health endpoint
echo "1. Testing /healthz endpoint..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/healthz" || echo "000")
if [ "$HEALTH_STATUS" = "200" ]; then
    echo "   ✅ Health check passed (200)"
    curl -s "$GATEWAY_URL/healthz" | jq '.' 2>/dev/null || curl -s "$GATEWAY_URL/healthz"
    echo ""
else
    echo "   ❌ Health check failed (status: $HEALTH_STATUS)"
    echo "   Is the API gateway running?"
    echo "   Try: kubectl port-forward svc/api-gateway 8080:4000 -n record-platform"
    echo "   Or: docker-compose up api-gateway"
    exit 1
fi

# Test 2: CORS headers
echo "2. Testing CORS configuration..."
CORS_ORIGIN=$(curl -s -I -H "Origin: $FRONTEND_URL" "$GATEWAY_URL/healthz" | grep -i "access-control-allow-origin" || echo "")
if echo "$CORS_ORIGIN" | grep -qi "access-control-allow-origin"; then
    echo "   ✅ CORS headers present"
    echo "   $CORS_ORIGIN"
else
    echo "   ⚠️  CORS headers not found - may cause issues in browser"
fi
echo ""

# Test 3: Auth endpoints
echo "3. Testing auth endpoints..."
LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: $FRONTEND_URL" \
    -d '{"email":"test@example.com","password":"test"}' || echo "000")
if [ "$LOGIN_STATUS" = "400" ] || [ "$LOGIN_STATUS" = "401" ] || [ "$LOGIN_STATUS" = "422" ]; then
    echo "   ✅ Auth login endpoint accessible (status: $LOGIN_STATUS - expected for invalid credentials)"
else
    echo "   ⚠️  Auth login endpoint returned unexpected status: $LOGIN_STATUS"
fi

REGISTER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/auth/register" \
    -H "Content-Type: application/json" \
    -H "Origin: $FRONTEND_URL" \
    -d '{}' || echo "000")
if [ "$REGISTER_STATUS" = "400" ] || [ "$REGISTER_STATUS" = "422" ]; then
    echo "   ✅ Auth register endpoint accessible (status: $REGISTER_STATUS - expected for invalid data)"
else
    echo "   ⚠️  Auth register endpoint returned unexpected status: $REGISTER_STATUS"
fi
echo ""

# Test 4: Records endpoint (requires auth)
echo "4. Testing records endpoint (should return 401 without auth)..."
RECORDS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Origin: $FRONTEND_URL" \
    "$GATEWAY_URL/records" || echo "000")
if [ "$RECORDS_STATUS" = "401" ]; then
    echo "   ✅ Records endpoint accessible and properly protected (401)"
elif [ "$RECORDS_STATUS" = "200" ]; then
    echo "   ⚠️  Records endpoint accessible without auth (200) - may be in debug mode"
elif [ "$RECORDS_STATUS" = "404" ]; then
    echo "   ❌ Records endpoint not found (404)"
else
    echo "   ⚠️  Records endpoint returned status: $RECORDS_STATUS"
fi
echo ""

# Test 5: Whoami endpoint
echo "5. Testing /whoami endpoint..."
WHOAMI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/whoami" || echo "000")
if [ "$WHOAMI_STATUS" = "200" ]; then
    echo "   ✅ Whoami endpoint accessible"
    curl -s "$GATEWAY_URL/whoami" | jq '.' 2>/dev/null || curl -s "$GATEWAY_URL/whoami"
    echo ""
else
    echo "   ⚠️  Whoami endpoint returned status: $WHOAMI_STATUS"
fi

# Test 6: Frontend connectivity (if running)
echo "6. Testing frontend connectivity..."
if curl -s -f "$FRONTEND_URL" > /dev/null 2>&1; then
    echo "   ✅ Frontend is running and accessible"
else
    echo "   ⚠️  Frontend not accessible at $FRONTEND_URL"
    echo "   Start it with: cd webapp && pnpm dev"
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "✅ Backend connection test complete!"
echo ""
echo "Next steps:"
echo "  1. Ensure API gateway is running:"
echo "     - K8s: kubectl port-forward svc/api-gateway 8080:4000 -n record-platform"
echo "     - Docker: docker-compose up api-gateway"
echo ""
echo "  2. Start the frontend:"
echo "     cd webapp && pnpm dev"
echo ""
echo "  3. Open browser:"
echo "     $FRONTEND_URL"
echo ""
echo "  4. Test login with:"
echo "     - Email: any@example.com"
echo "     - Password: (register first, then login)"
echo ""
