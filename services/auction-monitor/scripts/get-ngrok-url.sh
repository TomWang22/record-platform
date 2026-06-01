#!/bin/bash
# Get the ngrok HTTPS URL from the ngrok API

set -e

echo "🔍 Getting ngrok URL..."
echo ""

# Wait for ngrok to be ready
for i in {1..10}; do
  URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)
  if [ -n "$URL" ]; then
    echo "✅ ngrok URL found:"
    echo ""
    echo "   $URL"
    echo ""
    echo "Use this in eBay's notification form:"
    echo "   $URL/ebay/notifications"
    echo ""
    exit 0
  fi
  sleep 1
done

echo "❌ ngrok not running or not ready"
echo ""
echo "Make sure ngrok is running:"
echo "   ngrok http 3000"
echo ""
exit 1

