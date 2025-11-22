#!/usr/bin/env bash
set -euo pipefail

NS="record-platform"
HOST="${HOST:-record.local}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
TOKEN=""

say "=== Testing Microservices via HTTP/2 and HTTP/3 ==="

# Pre-flight: Check database schema
say "Pre-flight: Checking database schema..."
if kubectl -n "$NS" exec deploy/postgres -- psql -U postgres -d records -c "\dt auth.*" 2>/dev/null | grep -q "auth.users"; then
  ok "Auth schema exists"
else
  warn "Auth schema missing - auth-service will fail"
  warn "  → To fix: ./scripts/init-auth-schema.sh"
  warn "  → Or run: kubectl apply -k infra/k8s/overlays/dev (to run seed jobs)"
fi

# Service readiness checks
say "Checking service readiness..."
check_service_ready() {
  local service=$1
  local max_wait=${2:-60}
  local waited=0
  
  say "Waiting for $service to be ready..."
  while [[ $waited -lt $max_wait ]]; do
    if kubectl -n "$NS" get deployment "$service" >/dev/null 2>&1; then
      if kubectl -n "$NS" rollout status deployment/"$service" --timeout=10s >/dev/null 2>&1; then
        ok "$service is ready"
        return 0
      fi
    fi
    sleep 2
    waited=$((waited + 2))
  done
  
  warn "$service may not be ready (waited ${max_wait}s)"
  kubectl -n "$NS" get pods -l app="$service" 2>/dev/null || true
  return 1
}

# Check critical services
check_service_ready "auth-service" 30 || warn "auth-service readiness check failed, continuing anyway..."
check_service_ready "records-service" 30 || warn "records-service readiness check failed, continuing anyway..."
check_service_ready "api-gateway" 30 || warn "api-gateway readiness check failed, continuing anyway..."

# Check social-service if it exists
if kubectl -n "$NS" get deployment "social-service" >/dev/null 2>&1; then
  check_service_ready "social-service" 30 || warn "social-service readiness check failed, continuing anyway..."
else
  warn "social-service deployment not found, skipping social-service tests"
  # Check if deployment files exist but just need to be applied
  if [[ -f "infra/k8s/base/social-service/deploy.yaml" ]]; then
    warn "  → Deployment files exist at infra/k8s/base/social-service/deploy.yaml"
    warn "  → To deploy: kubectl apply -k infra/k8s/overlays/dev"
  fi
  SKIP_SOCIAL=1
fi

# Check listings-service if it exists
if kubectl -n "$NS" get deployment "listings-service" >/dev/null 2>&1; then
  check_service_ready "listings-service" 30 || warn "listings-service readiness check failed, continuing anyway..."
else
  warn "listings-service deployment not found, skipping listings-service tests"
  SKIP_LISTINGS=1
fi

# Test 1: Auth Service - Registration (HTTP/2)
say "Test 1: Auth Service - Registration via HTTP/2"
TEST_EMAIL="microservice-test-$(date +%s)@example.com"
REGISTER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:8443/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1)
REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  ok "Registration works via HTTP/2"
  [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
elif [[ "$REGISTER_CODE" == "409" ]]; then
  ok "User exists (expected) - will try login instead"
else
  warn "Registration failed - HTTP $REGISTER_CODE"
  echo "Response body: $(echo "$REGISTER_RESPONSE" | sed '$d' | head -5)"
fi

# Test 2: Auth Service - Login (HTTP/3)
say "Test 2: Auth Service - Login via HTTP/3"
LOGIN_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  --resolve "$HTTP3_RESOLVE" \
  -X POST "https://$HOST/api/auth/login" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  echo "This may indicate HTTP/3 connectivity issues. Check http3_curl helper."
  LOGIN_RESPONSE=""
  LOGIN_CODE="000"
}
if [[ -n "$LOGIN_RESPONSE" ]]; then
  LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
  if [[ "$LOGIN_CODE" == "200" ]]; then
    TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    ok "Login works via HTTP/3"
    [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
  else
    warn "Login failed - HTTP $LOGIN_CODE"
    echo "Response body: $(echo "$LOGIN_RESPONSE" | sed '$d' | head -5)"
  fi
fi

# Test 3: Records Service - Create Record (HTTP/2)
say "Test 3: Records Service - Create Record via HTTP/2"
if [[ -n "${TOKEN:-}" ]]; then
  CREATE_RC=0
  CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:8443/api/records" \
    -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}' 2>&1) || CREATE_RC=$?
  CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  if [[ "$CREATE_RC" -ne 0 ]]; then
    warn "Create record request failed (curl exit $CREATE_RC)"
  elif [[ "$CREATE_CODE" =~ ^(200|201)$ ]]; then
    ok "Create record works via HTTP/2"
    RECORD_ID=$(echo "$CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Create record failed - HTTP $CREATE_CODE"
    echo "Response body: $(echo "$CREATE_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping record creation - no auth token available"
fi

# Test 3b: Records Service - Create Record (HTTP/3)
say "Test 3b: Records Service - Create Record via HTTP/3"
if [[ -n "${TOKEN:-}" ]]; then
  CREATE_H3_RC=0
  CREATE_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/records" \
    -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}' 2>&1) || CREATE_H3_RC=$?
  if [[ "$CREATE_H3_RC" -ne 0 ]]; then
    warn "Create record via HTTP/3 failed (curl exit $CREATE_H3_RC)"
  elif [[ -n "$CREATE_H3_RESPONSE" ]]; then
    CREATE_H3_CODE=$(echo "$CREATE_H3_RESPONSE" | tail -1)
    if [[ "$CREATE_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create record works via HTTP/3"
      RECORD_H3_ID=$(echo "$CREATE_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Create record via HTTP/3 failed - HTTP $CREATE_H3_CODE"
      echo "Response body: $(echo "$CREATE_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping record creation via HTTP/3 - no auth token available"
fi

# Test 4: Health Checks (HTTP/2 and HTTP/3)
say "Test 4: Health Checks"
if "$CURL_BIN" -k -sS -I --http2 --max-time 10 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "Caddy health check works via HTTP/2"
else
  warn "Caddy health check failed via HTTP/2"
fi

if http3_curl -k -sS -I --http3-only --max-time 10 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | head -n1 | grep -q "HTTP/3 200"; then
  ok "Caddy health check works via HTTP/3"
else
  warn "Caddy health check failed via HTTP/3"
fi

# Test 5: API Gateway Health
say "Test 5: API Gateway Health"
GATEWAY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
GATEWAY_CODE=$(echo "$GATEWAY_RESPONSE" | tail -1)
if [[ "$GATEWAY_CODE" =~ ^(200|404|502)$ ]]; then
  ok "API Gateway reachable via HTTP/2 - HTTP $GATEWAY_CODE"
else
  warn "API Gateway test failed - HTTP $GATEWAY_CODE"
fi

# Test 6: Social Service - Forum Endpoints (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6: Social Service - Create Forum Post via HTTP/2"
  FORUM_POST_RC=0
  FORUM_POST_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:8443/api/forum/posts" \
    -d '{"title":"Test Forum Post","content":"This is a test post via HTTP/2","category":"general"}' 2>&1) || FORUM_POST_RC=$?
  FORUM_POST_CODE=$(echo "$FORUM_POST_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_RC" -ne 0 ]]; then
    warn "Create forum post request failed (curl exit $FORUM_POST_RC)"
  elif [[ "$FORUM_POST_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post works via HTTP/2"
    FORUM_POST_ID=$(echo "$FORUM_POST_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Create forum post failed - HTTP $FORUM_POST_CODE"
    echo "Response body: $(echo "$FORUM_POST_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post creation - social-service not available or no auth token"
fi

# Test 6b: Social Service - Forum Endpoints (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6b: Social Service - Create Forum Post via HTTP/3"
  FORUM_POST_H3_RC=0
  FORUM_POST_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts" \
    -d '{"title":"Test Forum Post H3","content":"This is a test post via HTTP/3","category":"general"}' 2>&1) || FORUM_POST_H3_RC=$?
  if [[ "$FORUM_POST_H3_RC" -ne 0 ]]; then
    warn "Create forum post via HTTP/3 failed (curl exit $FORUM_POST_H3_RC)"
  elif [[ -n "$FORUM_POST_H3_RESPONSE" ]]; then
    FORUM_POST_H3_CODE=$(echo "$FORUM_POST_H3_RESPONSE" | tail -1)
    if [[ "$FORUM_POST_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create forum post works via HTTP/3"
      FORUM_POST_H3_ID=$(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Create forum post via HTTP/3 failed - HTTP $FORUM_POST_H3_CODE"
      echo "Response body: $(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping forum post creation via HTTP/3 - social-service not available or no auth token"
fi

# Test 7: Social Service - Get Forum Posts (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 7: Social Service - Get Forum Posts via HTTP/2"
  GET_FORUM_RC=0
  GET_FORUM_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:8443/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
  GET_FORUM_CODE=$(echo "$GET_FORUM_RESPONSE" | tail -1)
  if [[ "$GET_FORUM_RC" -ne 0 ]]; then
    warn "Get forum posts request failed (curl exit $GET_FORUM_RC)"
  elif [[ "$GET_FORUM_CODE" =~ ^(200)$ ]]; then
    ok "Get forum posts works via HTTP/2"
  else
    warn "Get forum posts failed - HTTP $GET_FORUM_CODE"
    echo "Response body: $(echo "$GET_FORUM_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get forum posts - social-service not available or no auth token"
fi

# Test 8: Social Service - Messages Endpoints (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 8: Social Service - Send Message via HTTP/2"
  # Note: This assumes we have a recipient user ID - using a placeholder
  SEND_MSG_RC=0
  SEND_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:8443/api/messages" \
    -d '{"recipient_id":"test-recipient","content":"Test message via HTTP/2"}' 2>&1) || SEND_MSG_RC=$?
  SEND_MSG_CODE=$(echo "$SEND_MSG_RESPONSE" | tail -1)
  if [[ "$SEND_MSG_RC" -ne 0 ]]; then
    warn "Send message request failed (curl exit $SEND_MSG_RC)"
  elif [[ "$SEND_MSG_CODE" =~ ^(200|201|400|404)$ ]]; then
    # 400/404 might be expected if recipient doesn't exist
    if [[ "$SEND_MSG_CODE" =~ ^(200|201)$ ]]; then
      ok "Send message works via HTTP/2"
      MESSAGE_ID=$(echo "$SEND_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Send message returned HTTP $SEND_MSG_CODE (may be expected if recipient doesn't exist)"
    fi
  else
    warn "Send message failed - HTTP $SEND_MSG_CODE"
    echo "Response body: $(echo "$SEND_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping send message - social-service not available or no auth token"
fi

# Test 8b: Social Service - Messages Endpoints (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 8b: Social Service - Send Message via HTTP/3"
  SEND_MSG_H3_RC=0
  SEND_MSG_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d '{"recipient_id":"test-recipient","content":"Test message via HTTP/3"}' 2>&1) || SEND_MSG_H3_RC=$?
  if [[ "$SEND_MSG_H3_RC" -ne 0 ]]; then
    warn "Send message via HTTP/3 failed (curl exit $SEND_MSG_H3_RC)"
  elif [[ -n "$SEND_MSG_H3_RESPONSE" ]]; then
    SEND_MSG_H3_CODE=$(echo "$SEND_MSG_H3_RESPONSE" | tail -1)
    if [[ "$SEND_MSG_H3_CODE" =~ ^(200|201|400|404)$ ]]; then
      if [[ "$SEND_MSG_H3_CODE" =~ ^(200|201)$ ]]; then
        ok "Send message works via HTTP/3"
        MESSAGE_H3_ID=$(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      else
        warn "Send message via HTTP/3 returned HTTP $SEND_MSG_H3_CODE (may be expected if recipient doesn't exist)"
      fi
    else
      warn "Send message via HTTP/3 failed - HTTP $SEND_MSG_H3_CODE"
      echo "Response body: $(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping send message via HTTP/3 - social-service not available or no auth token"
fi

# Test 9: Social Service - Get Messages (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9: Social Service - Get Messages via HTTP/2"
  GET_MSG_RC=0
  GET_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:8443/api/messages" 2>&1) || GET_MSG_RC=$?
  GET_MSG_CODE=$(echo "$GET_MSG_RESPONSE" | tail -1)
  if [[ "$GET_MSG_RC" -ne 0 ]]; then
    warn "Get messages request failed (curl exit $GET_MSG_RC)"
  elif [[ "$GET_MSG_CODE" =~ ^(200)$ ]]; then
    ok "Get messages works via HTTP/2"
  else
    warn "Get messages failed - HTTP $GET_MSG_CODE"
    echo "Response body: $(echo "$GET_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get messages - social-service not available or no auth token"
fi

# Test 10: Listings Service - Health Check (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]]; then
  say "Test 10: Listings Service - Health Check via HTTP/2"
  LISTINGS_HEALTH_RC=0
  LISTINGS_HEALTH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    "https://$HOST:8443/api/listings/healthz" 2>&1) || LISTINGS_HEALTH_RC=$?
  LISTINGS_HEALTH_CODE=$(echo "$LISTINGS_HEALTH_RESPONSE" | tail -1)
  if [[ "$LISTINGS_HEALTH_RC" -ne 0 ]]; then
    warn "Listings health check failed (curl exit $LISTINGS_HEALTH_RC)"
  elif [[ "$LISTINGS_HEALTH_CODE" =~ ^(200)$ ]]; then
    ok "Listings health check works via HTTP/2"
  else
    warn "Listings health check failed - HTTP $LISTINGS_HEALTH_CODE"
  fi
else
  warn "Skipping listings health check - listings-service not available"
fi

# Test 10b: Listings Service - Health Check (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]]; then
  say "Test 10b: Listings Service - Health Check via HTTP/3"
  LISTINGS_HEALTH_H3_RC=0
  LISTINGS_HEALTH_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 10 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/listings/healthz" 2>&1) || LISTINGS_HEALTH_H3_RC=$?
  if [[ "$LISTINGS_HEALTH_H3_RC" -ne 0 ]]; then
    warn "Listings health check via HTTP/3 failed (curl exit $LISTINGS_HEALTH_H3_RC)"
  elif [[ -n "$LISTINGS_HEALTH_H3_RESPONSE" ]]; then
    LISTINGS_HEALTH_H3_CODE=$(echo "$LISTINGS_HEALTH_H3_RESPONSE" | tail -1)
    if [[ "$LISTINGS_HEALTH_H3_CODE" =~ ^(200)$ ]]; then
      ok "Listings health check works via HTTP/3"
    else
      warn "Listings health check via HTTP/3 failed - HTTP $LISTINGS_HEALTH_H3_CODE"
    fi
  fi
else
  warn "Skipping listings health check via HTTP/3 - listings-service not available"
fi

# Test 11: Listings Service - Search Listings (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 11: Listings Service - Search Listings via HTTP/2"
  LISTINGS_SEARCH_RC=0
  LISTINGS_SEARCH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:8443/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_RC=$?
  LISTINGS_SEARCH_CODE=$(echo "$LISTINGS_SEARCH_RESPONSE" | tail -1)
  if [[ "$LISTINGS_SEARCH_RC" -ne 0 ]]; then
    warn "Search listings request failed (curl exit $LISTINGS_SEARCH_RC)"
  elif [[ "$LISTINGS_SEARCH_CODE" =~ ^(200)$ ]]; then
    ok "Search listings works via HTTP/2"
  else
    warn "Search listings failed - HTTP $LISTINGS_SEARCH_CODE"
    echo "Response body: $(echo "$LISTINGS_SEARCH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping search listings - listings-service not available or no auth token"
fi

# Test 11b: Listings Service - Search Listings (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 11b: Listings Service - Search Listings via HTTP/3"
  LISTINGS_SEARCH_H3_RC=0
  LISTINGS_SEARCH_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_H3_RC=$?
  if [[ "$LISTINGS_SEARCH_H3_RC" -ne 0 ]]; then
    warn "Search listings via HTTP/3 failed (curl exit $LISTINGS_SEARCH_H3_RC)"
  elif [[ -n "$LISTINGS_SEARCH_H3_RESPONSE" ]]; then
    LISTINGS_SEARCH_H3_CODE=$(echo "$LISTINGS_SEARCH_H3_RESPONSE" | tail -1)
    if [[ "$LISTINGS_SEARCH_H3_CODE" =~ ^(200)$ ]]; then
      ok "Search listings works via HTTP/3"
    else
      warn "Search listings via HTTP/3 failed - HTTP $LISTINGS_SEARCH_H3_CODE"
      echo "Response body: $(echo "$LISTINGS_SEARCH_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping search listings via HTTP/3 - listings-service not available or no auth token"
fi

# Test 12: Listings Service - Create Listing (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 12: Listings Service - Create Listing via HTTP/2"
  LISTINGS_CREATE_RC=0
  LISTINGS_CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:8443/api/listings" \
    -d '{"title":"Test Vinyl Record","description":"Mint condition test listing","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_RC=$?
  LISTINGS_CREATE_CODE=$(echo "$LISTINGS_CREATE_RESPONSE" | tail -1)
  if [[ "$LISTINGS_CREATE_RC" -ne 0 ]]; then
    warn "Create listing request failed (curl exit $LISTINGS_CREATE_RC)"
  elif [[ "$LISTINGS_CREATE_CODE" =~ ^(200|201)$ ]]; then
    ok "Create listing works via HTTP/2"
    LISTING_ID=$(echo "$LISTINGS_CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Create listing failed - HTTP $LISTINGS_CREATE_CODE"
    echo "Response body: $(echo "$LISTINGS_CREATE_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping create listing - listings-service not available or no auth token"
fi

# Test 12b: Listings Service - Create Listing (HTTP/3)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 12b: Listings Service - Create Listing via HTTP/3"
  LISTINGS_CREATE_H3_RC=0
  LISTINGS_CREATE_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/listings" \
    -d '{"title":"Test Vinyl Record H3","description":"Mint condition test listing via HTTP/3","price":34.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_H3_RC=$?
  if [[ "$LISTINGS_CREATE_H3_RC" -ne 0 ]]; then
    warn "Create listing via HTTP/3 failed (curl exit $LISTINGS_CREATE_H3_RC)"
  elif [[ -n "$LISTINGS_CREATE_H3_RESPONSE" ]]; then
    LISTINGS_CREATE_H3_CODE=$(echo "$LISTINGS_CREATE_H3_RESPONSE" | tail -1)
    if [[ "$LISTINGS_CREATE_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create listing works via HTTP/3"
      LISTING_H3_ID=$(echo "$LISTINGS_CREATE_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Create listing via HTTP/3 failed - HTTP $LISTINGS_CREATE_H3_CODE"
      echo "Response body: $(echo "$LISTINGS_CREATE_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping create listing via HTTP/3 - listings-service not available or no auth token"
fi

# Test 13: Listings Service - Get My Listings (HTTP/2)
if [[ "${SKIP_LISTINGS:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 13: Listings Service - Get My Listings via HTTP/2"
  LISTINGS_MY_RC=0
  LISTINGS_MY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 15 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:8443/api/listings/my-listings" 2>&1) || LISTINGS_MY_RC=$?
  LISTINGS_MY_CODE=$(echo "$LISTINGS_MY_RESPONSE" | tail -1)
  if [[ "$LISTINGS_MY_RC" -ne 0 ]]; then
    warn "Get my listings request failed (curl exit $LISTINGS_MY_RC)"
  elif [[ "$LISTINGS_MY_CODE" =~ ^(200)$ ]]; then
    ok "Get my listings works via HTTP/2"
  else
    warn "Get my listings failed - HTTP $LISTINGS_MY_CODE"
    echo "Response body: $(echo "$LISTINGS_MY_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get my listings - listings-service not available or no auth token"
fi

say "=== Microservices Testing Complete ==="
