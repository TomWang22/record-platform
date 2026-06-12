#!/bin/bash
# API Keys Setup Helper Script
# Interactive script to help set up API keys for Auction Monitor

set -e

echo "🔑 Auction Monitor API Keys Setup"
echo "=================================="
echo ""

# Check if .env file exists
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "📝 Creating .env file..."
  touch "$ENV_FILE"
  echo "# Auction Monitor Environment Variables" >> "$ENV_FILE"
  echo "" >> "$ENV_FILE"
fi

echo "This script will help you set up API keys for the Auction Monitor service."
echo "You can skip any step by pressing Enter."
echo ""

# eBay API Setup
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 eBay API Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To get eBay API keys:"
echo "1. Go to https://developer.ebay.com/"
echo "2. Sign in with your eBay account"
echo "3. Go to 'My Account' → 'Keys'"
echo "4. Click 'Create an App Key'"
echo "5. Copy your App ID, Dev ID, Cert ID, and OAuth Token"
echo ""
read -p "Enter eBay App ID (or press Enter to skip): " EBAY_APP_ID
if [ ! -z "$EBAY_APP_ID" ]; then
  grep -q "^EBAY_APP_ID=" "$ENV_FILE" && sed -i '' "s/^EBAY_APP_ID=.*/EBAY_APP_ID=$EBAY_APP_ID/" "$ENV_FILE" || echo "EBAY_APP_ID=$EBAY_APP_ID" >> "$ENV_FILE"
fi

read -p "Enter eBay Dev ID (or press Enter to skip): " EBAY_DEV_ID
if [ ! -z "$EBAY_DEV_ID" ]; then
  grep -q "^EBAY_DEV_ID=" "$ENV_FILE" && sed -i '' "s/^EBAY_DEV_ID=.*/EBAY_DEV_ID=$EBAY_DEV_ID/" "$ENV_FILE" || echo "EBAY_DEV_ID=$EBAY_DEV_ID" >> "$ENV_FILE"
fi

read -p "Enter eBay Cert ID (or press Enter to skip): " EBAY_CERT_ID
if [ ! -z "$EBAY_CERT_ID" ]; then
  grep -q "^EBAY_CERT_ID=" "$ENV_FILE" && sed -i '' "s/^EBAY_CERT_ID=.*/EBAY_CERT_ID=$EBAY_CERT_ID/" "$ENV_FILE" || echo "EBAY_CERT_ID=$EBAY_CERT_ID" >> "$ENV_FILE"
fi

read -p "Enter eBay OAuth Token (or press Enter to skip): " EBAY_AUTH_TOKEN
if [ ! -z "$EBAY_AUTH_TOKEN" ]; then
  grep -q "^EBAY_AUTH_TOKEN=" "$ENV_FILE" && sed -i '' "s/^EBAY_AUTH_TOKEN=.*/EBAY_AUTH_TOKEN=$EBAY_AUTH_TOKEN/" "$ENV_FILE" || echo "EBAY_AUTH_TOKEN=$EBAY_AUTH_TOKEN" >> "$ENV_FILE"
fi

read -p "Use eBay Sandbox? (y/n, default: n): " USE_SANDBOX
if [ "$USE_SANDBOX" = "y" ] || [ "$USE_SANDBOX" = "Y" ]; then
  grep -q "^EBAY_SANDBOX=" "$ENV_FILE" && sed -i '' "s/^EBAY_SANDBOX=.*/EBAY_SANDBOX=true/" "$ENV_FILE" || echo "EBAY_SANDBOX=true" >> "$ENV_FILE"
else
  grep -q "^EBAY_SANDBOX=" "$ENV_FILE" && sed -i '' "s/^EBAY_SANDBOX=.*/EBAY_SANDBOX=false/" "$ENV_FILE" || echo "EBAY_SANDBOX=false" >> "$ENV_FILE"
fi

echo ""

# Discogs API Setup
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💿 Discogs API Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To get Discogs API token:"
echo "1. Go to https://www.discogs.com/"
echo "2. Sign in with your account"
echo "3. Go to Settings → Developer"
echo "4. Click 'Generate New Token'"
echo "5. Copy the token (you'll only see it once!)"
echo ""
read -p "Enter Discogs User Token (or press Enter to skip): " DISCOGS_TOKEN
if [ ! -z "$DISCOGS_TOKEN" ]; then
  grep -q "^DISCOGS_USER_TOKEN=" "$ENV_FILE" && sed -i '' "s/^DISCOGS_USER_TOKEN=.*/DISCOGS_USER_TOKEN=$DISCOGS_TOKEN/" "$ENV_FILE" || echo "DISCOGS_USER_TOKEN=$DISCOGS_TOKEN" >> "$ENV_FILE"
fi

echo ""

# Database URLs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  Database URLs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if ! grep -q "^POSTGRES_URL_AUCTION_MONITOR=" "$ENV_FILE"; then
  echo "POSTGRES_URL_AUCTION_MONITOR=postgresql://postgres:postgres@localhost:5438/postgres" >> "$ENV_FILE"
  echo "✅ Added default POSTGRES_URL_AUCTION_MONITOR"
fi

if ! grep -q "^POSTGRES_URL_ANALYTICS=" "$ENV_FILE"; then
  echo "POSTGRES_URL_ANALYTICS=postgresql://postgres:postgres@localhost:5439/analytics" >> "$ENV_FILE"
  echo "✅ Added default POSTGRES_URL_ANALYTICS"
fi

# Redis URL
if ! grep -q "^REDIS_URL=" "$ENV_FILE"; then
  echo "REDIS_URL=redis://localhost:6379/0" >> "$ENV_FILE"
  echo "✅ Added default REDIS_URL"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Your API keys have been saved to: $ENV_FILE"
echo ""
echo "🧪 Test your API keys:"
echo "   npx tsx scripts/test-api-keys.ts"
echo ""
echo "🚀 Start the worker:"
echo "   npm run start:worker"
echo ""

