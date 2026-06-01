#!/bin/bash
# Start ngrok tunnel for eBay webhook endpoint

set -e

echo "🚀 Starting eBay Webhook Setup"
echo "==============================="
echo ""

# Check if webhook server is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo "⚠️  Webhook server not running on port 3000"
  echo "Starting webhook server..."
  cd "$(dirname "$0")/.."
  node scripts/create-ebay-webhook-endpoint.js &
  WEBHOOK_PID=$!
  sleep 2
  echo "✅ Webhook server started (PID: $WEBHOOK_PID)"
  echo ""
fi

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
  echo "❌ ngrok not found. Installing..."
  brew install ngrok/ngrok/ngrok
fi

echo "📡 Starting ngrok tunnel..."
echo ""
echo "Your webhook endpoint will be available at:"
echo "  https://[random-id].ngrok.io/ebay/notifications"
echo ""
echo "Copy the HTTPS URL above and use it in eBay's notification form."
echo ""
echo "Press Ctrl+C to stop ngrok when done."
echo ""

# Start ngrok
ngrok http 3000

