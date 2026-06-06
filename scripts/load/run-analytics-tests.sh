#!/bin/bash
# Run Analytics Pipeline k6 Load Tests
#
# Tests the analytics pipeline with real data patterns using k6
#
# Usage:
#   ./scripts/load/run-analytics-tests.sh
#   BASE_URL=http://localhost:4008 ANALYTICS_URL=http://localhost:4004 ./scripts/load/run-analytics-tests.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:4008}"
ANALYTICS_URL="${ANALYTICS_URL:-http://localhost:4004}"
AUCTION_MONITOR_URL="${AUCTION_MONITOR_URL:-http://localhost:4008}"

echo "🚀 Analytics Pipeline k6 Load Tests"
echo "===================================="
echo ""
echo "Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Analytics URL: $ANALYTICS_URL"
echo "  Auction Monitor URL: $AUCTION_MONITOR_URL"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
  echo "❌ k6 is not installed. Install it with:"
  echo "   brew install k6  # macOS"
  echo "   or visit https://k6.io/docs/getting-started/installation/"
  exit 1
fi

echo "✅ k6 found: $(k6 version)"
echo ""

# Check if services are running
if [ "${SKIP_SERVICE_CHECK:-false}" != "true" ]; then
  echo "🔍 Checking service health..."
  if ! ./scripts/load/check-services.sh; then
    echo ""
    echo "⚠️  Services are not running. Start them first:"
    echo "   cd services/analytics-service && npm start"
    echo "   cd services/auction-monitor && npm start"
    echo ""
    echo "   Or skip check with: SKIP_SERVICE_CHECK=true ./scripts/load/run-analytics-tests.sh"
    exit 1
  fi
  echo ""
fi

# Test 0: Real Data Pipeline (eBay/Discogs APIs)
echo "📊 Test 0: Real Data Pipeline (eBay/Discogs APIs)"
echo "--------------------------------------------------"
echo "Testing with REAL API data from eBay and Discogs..."
echo ""
k6 run \
  --vus 5 \
  --duration 120s \
  --env BASE_URL="$BASE_URL" \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --summary-export=scripts/load/results/analytics-real-data-$(date +%s).json \
  scripts/load/k6-analytics-real-data.js

echo ""
echo ""

# Test 1: Ingestion Pipeline Test
echo "📊 Test 1: Analytics Ingestion Pipeline"
echo "----------------------------------------"
k6 run \
  --vus 10 \
  --duration 60s \
  --env BASE_URL="$BASE_URL" \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --summary-export=scripts/load/results/analytics-ingestion-$(date +%s).json \
  scripts/load/k6-analytics-ingestion.js

echo ""
echo ""

# Test 2: Data Quality Validation
echo "🔍 Test 2: Data Quality Validation"
echo "-----------------------------------"
k6 run \
  --vus 5 \
  --duration 30s \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --env AUCTION_MONITOR_URL="$AUCTION_MONITOR_URL" \
  --summary-export=scripts/load/results/analytics-data-quality-$(date +%s).json \
  scripts/load/k6-analytics-data-quality.js

echo ""
echo ""

# Test 2b: Database Validation (queries processed data)
echo "🗄️  Test 2b: Database Validation"
echo "--------------------------------"
k6 run \
  --vus 5 \
  --duration 30s \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --summary-export=scripts/load/results/analytics-db-validation-$(date +%s).json \
  scripts/load/k6-analytics-db-validation.js

echo ""
echo ""

# Test 3: Load Ramp Test (starts at 1K VU, scales up)
echo "📈 Test 3: Load Ramp Test (1K → 5K VU)"
echo "--------------------------------------"
echo "⚠️  This test starts at 1000 VU and ramps up to find breaking point"
echo "   Press Ctrl+C to skip or wait for it to complete..."
sleep 3

k6 run \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --env AUCTION_MONITOR_URL="$AUCTION_MONITOR_URL" \
  --env START_VUS=1000 \
  --env MAX_VUS=5000 \
  --env STEP_VUS=500 \
  --env STEP_DURATION=2m \
  --summary-export=scripts/load/results/analytics-load-ramp-$(date +%s).json \
  scripts/load/k6-analytics-load-ramp.js

echo ""
echo ""

# Test 4: Read-Heavy Test (starts at 1K VU)
echo "📖 Test 4: Read-Heavy Test (1K → 3K VU)"
echo "---------------------------------------"
echo "⚠️  This test focuses on read operations (90% read, 10% write)"
echo "   Press Ctrl+C to skip or wait for it to complete..."
sleep 3

k6 run \
  --env ANALYTICS_URL="$ANALYTICS_URL" \
  --env START_VUS=1000 \
  --env MAX_VUS=3000 \
  --env DURATION=10m \
  --summary-export=scripts/load/results/analytics-read-heavy-$(date +%s).json \
  scripts/load/k6-analytics-read-heavy.js

echo ""
echo ""

# Test 5: Soak Test (long duration, steady load)
if [ "${SKIP_SOAK:-false}" != "true" ]; then
  echo "💧 Test 5: Soak Test (Long Duration)"
  echo "------------------------------------"
  echo "⚠️  This test runs for 30 minutes with steady load to find memory leaks"
  echo "   Press Ctrl+C to skip or wait for it to complete..."
  sleep 3
  
  k6 run \
    --vus 50 \
    --duration 30m \
    --env ANALYTICS_URL="$ANALYTICS_URL" \
    --env AUCTION_MONITOR_URL="$AUCTION_MONITOR_URL" \
    --summary-export=scripts/load/results/analytics-soak-$(date +%s).json \
    scripts/load/k6-analytics-soak.js
else
  echo "⏭️  Test 5: Soak Test (skipped)"
fi

echo ""
echo ""

# Test 6: Stress Test (optional, can be skipped)
if [ "${SKIP_STRESS:-false}" != "true" ]; then
  echo "🔥 Test 6: Stress Test (High Load)"
  echo "-----------------------------------"
  echo "⚠️  This test runs for 5 minutes with 50 concurrent users"
  echo "   Press Ctrl+C to skip or wait for it to complete..."
  sleep 3
  
  k6 run \
    --vus 50 \
    --duration 5m \
    --env ANALYTICS_URL="$ANALYTICS_URL" \
    --env AUCTION_MONITOR_URL="$AUCTION_MONITOR_URL" \
    --summary-export=scripts/load/results/analytics-stress-$(date +%s).json \
    scripts/load/k6-analytics-stress.js
else
  echo "⏭️  Test 6: Stress Test (skipped)"
fi

echo ""
echo "✅ All tests completed!"
echo ""
echo "📊 Results saved in: scripts/load/results/"
echo "   View with: cat scripts/load/results/analytics-*.json | jq"

