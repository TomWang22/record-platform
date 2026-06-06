#!/bin/bash
# Check if required services are running before k6 tests
#
# Usage:
#   ./scripts/load/check-services.sh

set -e

ANALYTICS_URL="${ANALYTICS_URL:-http://localhost:4004}"
AUCTION_MONITOR_URL="${AUCTION_MONITOR_URL:-http://localhost:4008}"

echo "🔍 Checking service health before k6 tests..."
echo ""

# Check Analytics Service
echo "Checking Analytics Service (${ANALYTICS_URL})..."
if curl -s -f --max-time 2 "${ANALYTICS_URL}/healthz" > /dev/null 2>&1; then
  echo "  ✅ Analytics Service is running"
else
  echo "  ❌ Analytics Service is NOT running at ${ANALYTICS_URL}"
  echo "     Start it with: cd services/analytics-service && npm start"
  exit 1
fi

# Check Auction Monitor Service
echo "Checking Auction Monitor Service (${AUCTION_MONITOR_URL})..."
if curl -s -f --max-time 2 "${AUCTION_MONITOR_URL}/healthz" > /dev/null 2>&1; then
  echo "  ✅ Auction Monitor Service is running"
else
  echo "  ⚠️  Auction Monitor Service is NOT running at ${AUCTION_MONITOR_URL}"
  echo "     (This is optional for some tests)"
fi

echo ""
echo "✅ Services are ready for k6 testing!"

