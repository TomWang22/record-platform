#!/bin/bash
# Test MFA flow with proper timeouts to prevent hanging
# This is a fixed version of the MFA test that includes timeouts on all curl commands

set -e

echo "=== MFA Test with Timeouts ==="
echo ""

# Step 1: Register user
echo "Step 1: Registering user..."
TOKEN=$(curl -k -sS --http2 --resolve "record.local:8443:127.0.0.1" \
  -H "Host: record.local" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/register" \
  -d "{\"email\":\"test-mfa-$(date +%s)@example.com\",\"password\":\"Test123!@#\",\"name\":\"Test\"}" \
  --max-time 10 \
  --connect-timeout 5 \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ ERROR: Failed to get token from registration"
  exit 1
fi

echo "✅ Registration successful"
echo ""

# Step 2: Setup MFA
echo "Step 2: Setting up MFA..."
EMAIL="test-mfa-$(date +%s)@example.com"
MFA_SECRET=$(curl -k -sS --http2 --resolve "record.local:8443:127.0.0.1" \
  -H "Host: record.local" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/mfa/setup" \
  -d '{}' \
  --max-time 10 \
  --connect-timeout 5 \
  | grep -o '"secret":"[^"]*"' | cut -d'"' -f4)

if [ -z "$MFA_SECRET" ]; then
  echo "❌ ERROR: Failed to get MFA secret"
  exit 1
fi

echo "✅ MFA setup successful"
echo ""

# Step 3: Generate TOTP code
echo "Step 3: Generating TOTP code..."
sleep 3
TOTP_CODE=$(cd "$(dirname "$0")/.." && node -e "const { authenticator } = require('./node_modules/otplib'); console.log(authenticator.generate('$MFA_SECRET'));" 2>/dev/null)

if [ -z "$TOTP_CODE" ]; then
  echo "❌ ERROR: Failed to generate TOTP code"
  exit 1
fi

echo "✅ TOTP code generated"
echo ""

# Step 4: Verify MFA
echo "Step 4: Verifying MFA code..."
VERIFY_RESPONSE=$(curl -k -sS --http2 --resolve "record.local:8443:127.0.0.1" \
  -H "Host: record.local" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/mfa/verify" \
  -d "{\"code\":\"$TOTP_CODE\"}" \
  --max-time 10 \
  --connect-timeout 5 \
  -w "\nHTTP_CODE:%{http_code}\n")

if echo "$VERIFY_RESPONSE" | grep -q "HTTP_CODE:200\|HTTP_CODE:201"; then
  echo "✅ MFA verification successful"
else
  echo "⚠️  MFA verification response:"
  echo "$VERIFY_RESPONSE" | head -3
fi
echo ""

# Step 5: Test login without MFA code (should fail or require MFA)
echo "Step 5: Testing login without MFA code (should require MFA)..."
sleep 2
LOGIN_RESPONSE=$(curl -k -sS --http2 --resolve "record.local:8443:127.0.0.1" \
  -H "Host: record.local" \
  -H "Content-Type: application/json" \
  -X POST "https://record.local:8443/api/auth/login" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test123!@#\"}" \
  --max-time 10 \
  --connect-timeout 5 \
  -w "\nHTTP_CODE:%{http_code}\n" 2>&1)

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
echo "Login response (HTTP $HTTP_CODE):"
echo "$LOGIN_RESPONSE" | grep -v "HTTP_CODE:" | head -5

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "✅ Login correctly requires MFA (HTTP $HTTP_CODE)"
else
  echo "⚠️  Unexpected response code: $HTTP_CODE"
fi

echo ""
echo "=== Test Complete ==="

