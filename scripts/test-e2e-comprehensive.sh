#!/usr/bin/env bash
set -euo pipefail

NS="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper to extract JSON values
extract_json() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d'"' -f4 || echo ""
}

# Helper to extract user ID from JWT
extract_user_id() {
  local token=$1
  if [[ -z "$token" ]]; then echo ""; return; fi
  local payload=$(echo "$token" | cut -d'.' -f2)
  payload=$(echo "$payload" | tr '_-' '/+')
  local mod=$((${#payload} % 4))
  if [[ $mod -eq 2 ]]; then payload="${payload}=="; elif [[ $mod -eq 3 ]]; then payload="${payload}="; fi
  echo "$payload" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

say "=== Comprehensive E2E Platform Test ==="
say "Testing: Auth → Listings → Social → Pipeline (Analytics → Python AI) → Shopping → Records → Logout"

# Test 1: Auth - Registration
say "Test 1: Auth Service - User Registration"
TEST_EMAIL="e2e-test-$(date +%s)@example.com"
REGISTER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || REGISTER_RESPONSE=""
REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(extract_json "$REGISTER_RESPONSE" "token")
  USER_ID=$(extract_user_id "$TOKEN")
  ok "User registration successful"
  ((TESTS_PASSED++))
else
  warn "Registration failed - HTTP $REGISTER_CODE"
  REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | sed '$d' | head -3)
  echo "Response: $REGISTER_BODY"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  fail "Cannot continue without authentication"
fi

# Test 2: Auth - Login
say "Test 2: Auth Service - User Login"
LOGIN_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/login" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || LOGIN_RESPONSE=""
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
if [[ "$LOGIN_CODE" == "200" ]]; then
  TOKEN=$(extract_json "$LOGIN_RESPONSE" "token")
  ok "User login successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Login failed - HTTP $LOGIN_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 3: Listings - Search
say "Test 3: Listings Service - Search Listings"
LISTINGS_SEARCH=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Authorization: Bearer $TOKEN" \
  "https://$HOST:${PORT}/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH=""
LISTINGS_CODE=$(echo "$LISTINGS_SEARCH" | tail -1)
if [[ "$LISTINGS_CODE" == "200" ]]; then
  ok "Listings search successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Listings search failed - HTTP $LISTINGS_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 4: Listings - Create Listing
say "Test 4: Listings Service - Create Listing"
CREATE_LISTING=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/listings" \
  -d '{"title":"E2E Test Vinyl","description":"Test listing for e2e","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || CREATE_LISTING=""
LISTING_CODE=$(echo "$CREATE_LISTING" | tail -1)
if [[ "$LISTING_CODE" =~ ^(200|201)$ ]]; then
  LISTING_ID=$(extract_json "$CREATE_LISTING" "id")
  ok "Listing creation successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Listing creation failed - HTTP $LISTING_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 5: Social - Create Forum Post
say "Test 5: Social Service - Create Forum Post"
FORUM_POST=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/forum/posts" \
  -d '{"title":"E2E Test Post","content":"Testing social service","flair":"general"}' 2>&1) || FORUM_POST=""
FORUM_CODE=$(echo "$FORUM_POST" | tail -1)
if [[ "$FORUM_CODE" =~ ^(200|201)$ ]]; then
  FORUM_POST_ID=$(extract_json "$FORUM_POST" "id")
  ok "Forum post creation successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Forum post creation failed - HTTP $FORUM_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 6: Pipeline - Analytics Ingestion
say "Test 6: Analytics Service - Data Ingestion (Pipeline)"
ANALYTICS_INGEST=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/analytics/ingest" \
  -d "{\"event_type\":\"listing_view\",\"listing_id\":\"${LISTING_ID:-test-123}\",\"user_id\":\"$USER_ID\"}" 2>&1) || ANALYTICS_INGEST=""
ANALYTICS_CODE=$(echo "$ANALYTICS_INGEST" | tail -1)
if [[ "$ANALYTICS_CODE" =~ ^(200|201|202)$ ]]; then
  ok "Analytics ingestion successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Analytics ingestion failed - HTTP $ANALYTICS_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 7: Pipeline - Python AI Service
say "Test 7: Python AI Service - Get Advice (Pipeline)"
sleep 2  # Wait for analytics to process
AI_ADVICE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/ai/advice/selling" \
  -d "{\"listing_id\":\"${LISTING_ID:-test-123}\"}" 2>&1) || AI_ADVICE=""
AI_CODE=$(echo "$AI_ADVICE" | tail -1)
if [[ "$AI_CODE" =~ ^(200)$ ]]; then
  ok "Python AI advice successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Python AI advice failed - HTTP $AI_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 8: Shopping - Add to Cart
say "Test 8: Shopping Service - Add to Cart"
if [[ -n "${LISTING_ID:-}" ]]; then
  ADD_CART=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/cart" \
    -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}" 2>&1) || ADD_CART=""
  CART_CODE=$(echo "$ADD_CART" | tail -1)
  if [[ "$CART_CODE" =~ ^(200|201)$ ]]; then
    ok "Add to cart successful"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    warn "Add to cart failed - HTTP $CART_CODE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  warn "Skipping cart test - no listing ID"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 9: Records - Create Record
say "Test 9: Records Service - Create Record"
CREATE_RECORD=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/records" \
  -d '{"artist":"E2E Test Artist","name":"E2E Test Record","format":"LP","catalog_number":"E2E-001"}' 2>&1) || CREATE_RECORD=""
RECORD_CODE=$(echo "$CREATE_RECORD" | tail -1)
if [[ "$RECORD_CODE" =~ ^(200|201)$ ]]; then
  RECORD_ID=$(extract_json "$CREATE_RECORD" "id")
  ok "Record creation successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Record creation failed - HTTP $RECORD_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 10: Auth - Logout
say "Test 10: Auth Service - Logout"
LOGOUT=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/auth/logout" 2>&1) || LOGOUT=""
LOGOUT_CODE=$(echo "$LOGOUT" | tail -1)
if [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then
  ok "Logout successful"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  warn "Logout failed - HTTP $LOGOUT_CODE"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Summary
say "=== E2E Test Summary ==="
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
if [[ $TESTS_FAILED -eq 0 ]]; then
  ok "All E2E tests passed!"
  exit 0
else
  warn "Some tests failed"
  exit 1
fi
