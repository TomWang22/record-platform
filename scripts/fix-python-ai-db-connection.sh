#!/usr/bin/env bash
set -euo pipefail

# Script to fix Python AI database connection string by removing unsupported parameters
# Usage: ./scripts/fix-python-ai-db-connection.sh

NS="${NS:-record-platform}"

echo "🔧 Fixing Python AI Database Connection"
echo "======================================"
echo ""

# Check current POSTGRES_URL_PYTHON_AI
echo "📋 Current database URL configuration..."
CURRENT_URL=$(kubectl -n "$NS" get configmap app-config -o jsonpath='{.data.POSTGRES_URL_PYTHON_AI}' 2>&1 || echo "")

if [ -z "$CURRENT_URL" ]; then
  echo "⚠️  POSTGRES_URL_PYTHON_AI not found in app-config ConfigMap"
  echo "   Checking secrets..."
  CURRENT_URL=$(kubectl -n "$NS" get secret app-secrets -o jsonpath='{.data.POSTGRES_URL_PYTHON_AI}' 2>&1 | base64 -d 2>/dev/null || echo "")
fi

if [ -z "$CURRENT_URL" ]; then
  echo "❌ Could not find POSTGRES_URL_PYTHON_AI in ConfigMap or Secrets"
  echo "   Please check your configuration manually"
  exit 1
fi

echo "Current URL: ${CURRENT_URL:0:50}..." # Show first 50 chars for security

# Check if it contains connect_timeout
if echo "$CURRENT_URL" | grep -q "connect_timeout"; then
  echo ""
  echo "⚠️  Found 'connect_timeout' parameter (not supported by asyncpg)"
  echo "   Removing it from connection string..."
  
  # Remove connect_timeout parameter
  FIXED_URL=$(echo "$CURRENT_URL" | sed -E 's/[&?]connect_timeout=[^&]*//g')
  
  echo "Fixed URL: ${FIXED_URL:0:50}..."
  echo ""
  echo "💡 To apply this fix:"
  echo "   1. Update the ConfigMap or Secret with the fixed URL"
  echo "   2. Restart the Python AI service pods"
  echo ""
  echo "   Example (if in ConfigMap):"
  echo "   kubectl -n $NS patch configmap app-config --type merge -p '{\"data\":{\"POSTGRES_URL_PYTHON_AI\":\"$FIXED_URL\"}}'"
  echo ""
  echo "   Example (if in Secret):"
  echo "   kubectl -n $NS create secret generic app-secrets --from-literal=POSTGRES_URL_PYTHON_AI=\"$FIXED_URL\" --dry-run=client -o yaml | kubectl apply -f -"
else
  echo ""
  echo "✅ No 'connect_timeout' parameter found - connection string looks good"
fi

