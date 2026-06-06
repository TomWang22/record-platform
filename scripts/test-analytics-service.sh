#!/usr/bin/env bash
set -euo pipefail

# Analytics Service Test Script
# Tests all analytics endpoints and database connectivity

HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
NS="record-platform"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

CURL_BIN="/opt/homebrew/opt/curl/bin/curl"

say "=== Analytics Service Test Suite ==="

# Test 1: Health Check
say "Test 1: Health Check"
HEALTH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/analytics/healthz" 2>&1)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
if [[ "$HTTP_CODE" == "200" ]]; then
  ok "Health check passed - HTTP $HTTP_CODE"
  echo "$HEALTH_RESPONSE" | sed '$d' | jq . 2>/dev/null || echo "$HEALTH_RESPONSE" | sed '$d'
else
  warn "Health check returned HTTP $HTTP_CODE"
fi

# Test 2: Database Connectivity (from health response)
say "Test 2: Database Connectivity"
if echo "$HEALTH_RESPONSE" | grep -q '"db":"connected"'; then
  ok "Analytics database connected"
else
  warn "Analytics database connection issue"
fi
if echo "$HEALTH_RESPONSE" | grep -q '"listings":"ok"'; then
  ok "Listings database connected"
else
  warn "Listings database connection issue"
fi

# Test 3: Trending Searches
say "Test 3: Trending Searches"
TRENDING_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/analytics/trending" 2>&1)
TRENDING_CODE=$(echo "$TRENDING_RESPONSE" | tail -1)
if [[ "$TRENDING_CODE" == "200" ]]; then
  ok "Trending searches endpoint works - HTTP $TRENDING_CODE"
  TRENDING_COUNT=$(echo "$TRENDING_RESPONSE" | sed '$d' | jq '. | length' 2>/dev/null || echo "0")
  echo "  Found $TRENDING_COUNT trending searches"
else
  warn "Trending searches returned HTTP $TRENDING_CODE"
fi

# Test 4: User Search History
say "Test 4: User Search History"
# Use a test user ID (UUID format)
TEST_USER_ID="00000000-0000-0000-0000-000000000000"
HISTORY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/analytics/user/${TEST_USER_ID}/history" 2>&1)
HISTORY_CODE=$(echo "$HISTORY_RESPONSE" | tail -1)
if [[ "$HISTORY_CODE" == "200" ]]; then
  ok "User search history endpoint works - HTTP $HISTORY_CODE"
  HISTORY_COUNT=$(echo "$HISTORY_RESPONSE" | sed '$d' | jq '. | length' 2>/dev/null || echo "0")
  echo "  Found $HISTORY_COUNT search history entries"
else
  warn "User search history returned HTTP $HISTORY_CODE"
fi

# Test 5: Similar Searches
say "Test 5: Similar Searches"
SIMILAR_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  "https://$HOST:${PORT}/api/analytics/recommendations/similar?q=test" 2>&1)
SIMILAR_CODE=$(echo "$SIMILAR_RESPONSE" | tail -1)
if [[ "$SIMILAR_CODE" == "200" ]]; then
  ok "Similar searches endpoint works - HTTP $SIMILAR_CODE"
  SIMILAR_COUNT=$(echo "$SIMILAR_RESPONSE" | sed '$d' | jq '. | length' 2>/dev/null || echo "0")
  echo "  Found $SIMILAR_COUNT similar searches"
else
  warn "Similar searches returned HTTP $SIMILAR_CODE"
fi

# Test 6: Log Search (POST)
say "Test 6: Log Search"
LOG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  -X POST \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -d '{"query":"test search","source":"test","results":10}' \
  "https://$HOST:${PORT}/api/analytics/log-search" 2>&1)
LOG_CODE=$(echo "$LOG_RESPONSE" | tail -1)
if [[ "$LOG_CODE" == "200" ]] || [[ "$LOG_CODE" == "201" ]]; then
  ok "Log search endpoint works - HTTP $LOG_CODE"
else
  warn "Log search returned HTTP $LOG_CODE"
fi

# Test 7: Price Prediction
say "Test 7: Price Prediction"
PREDICT_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
  -X POST \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -d '{"items":[{"price":50,"recordGrade":"VG+","sleeveGrade":"VG"}]}' \
  "https://$HOST:${PORT}/api/analytics/predict-price" 2>&1)
PREDICT_CODE=$(echo "$PREDICT_RESPONSE" | tail -1)
if [[ "$PREDICT_CODE" == "200" ]]; then
  ok "Price prediction endpoint works - HTTP $PREDICT_CODE"
  PREDICTIONS=$(echo "$PREDICT_RESPONSE" | sed '$d' | jq '.predictions | length' 2>/dev/null || echo "0")
  echo "  Generated $PREDICTIONS price predictions"
else
  warn "Price prediction returned HTTP $PREDICT_CODE"
fi

# Test 8: Fuzzy Search
say "Test 8: Fuzzy Search"
FUZZY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  "https://$HOST:${PORT}/api/analytics/fuzzy-search?q=test" 2>&1)
FUZZY_CODE=$(echo "$FUZZY_RESPONSE" | tail -1)
if [[ "$FUZZY_CODE" == "200" ]]; then
  ok "Fuzzy search endpoint works - HTTP $FUZZY_CODE"
else
  warn "Fuzzy search returned HTTP $FUZZY_CODE"
fi

# Test 9: Kafka Connectivity (from service logs)
say "Test 9: Kafka Connectivity"
POD=$(kubectl get pod -n "$NS" -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$POD" ]]; then
  KAFKA_LOGS=$(kubectl logs -n "$NS" "$POD" --tail=50 2>&1 | grep -i kafka | tail -3)
  if echo "$KAFKA_LOGS" | grep -qi "connected\|ready"; then
    ok "Kafka connection appears healthy (from logs)"
  elif echo "$KAFKA_LOGS" | grep -qi "error\|failed"; then
    warn "Kafka connection issues detected (from logs)"
    echo "$KAFKA_LOGS"
  else
    warn "Could not determine Kafka status from logs"
  fi
else
  warn "Could not find analytics-service pod"
fi

say "=== Analytics Service Tests Complete ==="

