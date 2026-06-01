#!/bin/bash
# Quick script to help set up ngrok authentication

echo "🔐 ngrok Authentication Setup"
echo "=============================="
echo ""
echo "ngrok requires a free account to use."
echo ""
echo "Steps:"
echo "1. Sign up at: https://dashboard.ngrok.com/signup"
echo "2. Get your authtoken at: https://dashboard.ngrok.com/get-started/your-authtoken"
echo "3. Run this command with your token:"
echo ""
echo "   ngrok config add-authtoken YOUR_TOKEN_HERE"
echo ""
echo "Then you can run: ngrok http 3000"
echo ""

# Check if already authenticated
if ngrok config check > /dev/null 2>&1; then
  echo "✅ ngrok is already authenticated!"
  echo ""
  echo "You can now run: ngrok http 3000"
else
  echo "❌ ngrok is not authenticated yet."
  echo ""
  echo "Follow the steps above to set it up."
fi

