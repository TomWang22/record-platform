#!/bin/bash
# Quick script to test if backend is accessible

GATEWAY_URL="${NEXT_PUBLIC_GATEWAY_URL:-http://localhost:8080}"

echo "Testing backend connection at: $GATEWAY_URL"
echo ""

# Test health endpoint
echo "1. Testing /healthz endpoint..."
if curl -s -f "$GATEWAY_URL/healthz" > /dev/null; then
    echo "   ✅ Health check passed"
else
    echo "   ❌ Health check failed - is the API gateway running?"
    exit 1
fi

# Test auth endpoints exist
echo ""
echo "2. Testing auth endpoints..."
if curl -s -f -X POST "$GATEWAY_URL/auth/login" -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1; then
    echo "   ✅ Auth endpoints accessible (expected 400/401 is fine)"
else
    echo "   ⚠️  Auth endpoint may not be configured correctly"
fi

# Test records endpoint (will fail without auth, but should return 401, not 404)
echo ""
echo "3. Testing records endpoint..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/records")
if [ "$STATUS" = "401" ] || [ "$STATUS" = "200" ]; then
    echo "   ✅ Records endpoint accessible (status: $STATUS)"
elif [ "$STATUS" = "404" ]; then
    echo "   ❌ Records endpoint not found (404)"
else
    echo "   ⚠️  Records endpoint returned status: $STATUS"
fi

echo ""
echo "✅ Backend connection test complete!"
echo ""
echo "To start the webapp:"
echo "  cd webapp && pnpm dev"
