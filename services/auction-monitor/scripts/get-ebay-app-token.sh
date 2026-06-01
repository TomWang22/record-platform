#!/bin/bash
# Get eBay Application Token (simpler than User Token for testing)
# This uses your App ID and Cert ID to get a token

set -e

echo "🔑 eBay Application Token Generator"
echo "===================================="
echo ""

# Check if keys are set
if [ -z "$EBAY_APP_ID" ] || [ -z "$EBAY_CERT_ID" ]; then
  echo "❌ EBAY_APP_ID and EBAY_CERT_ID must be set"
  echo ""
  echo "Usage:"
  echo "  EBAY_APP_ID='your_app_id' EBAY_CERT_ID='your_cert_id' ./scripts/get-ebay-app-token.sh"
  echo ""
  exit 1
fi

echo "App ID: $EBAY_APP_ID"
echo "Getting application token..."
echo ""

# Get token using client credentials (no scope needed for Application Access Token)
RESPONSE=$(curl -s -X POST https://api.ebay.com/identity/v1/oauth2/token \
  -u "$EBAY_APP_ID:$EBAY_CERT_ID" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials")

# Check for errors
if echo "$RESPONSE" | grep -q "error"; then
  echo "❌ Error getting token:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

# Extract token
TOKEN=$(echo "$RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Could not extract token from response:"
  echo "$RESPONSE"
  exit 1
fi

echo "✅ Token received!"
echo ""
echo "Add this to your .env file:"
echo "EBAY_AUTH_TOKEN=\"$TOKEN\""
echo ""
echo "Or export it:"
echo "export EBAY_AUTH_TOKEN=\"$TOKEN\""
echo ""

