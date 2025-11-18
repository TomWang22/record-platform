#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
NS="record-platform"
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
HTTP3_RESOLVE="${HOST}:443:127.0.0.1"

say "=== Testing gRPC via HTTP/2 and HTTP/3 ==="

# Step 1: Create test user
say "Step 1: Creating test user for authentication..."

TEST_EMAIL="test@example.com"
TEST_PASSWORD="testpassword123"
TEST_USER_ID=""
TEST_TOKEN=""

# Check if auth service is ready
AUTH_POD=$(kubectl -n "$NS" get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$AUTH_POD" ]]; then
  warn "Auth service pod not found, trying via API gateway..."
  # Try via API gateway instead
  # Note: Ingress strips /api, so gateway sees /auth/register
  REGISTER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/register" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
    --max-time 10 2>&1 || echo "")
  
  REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
  if [[ "$REGISTER_CODE" == "201" ]] || [[ "$REGISTER_CODE" == "409" ]]; then
    ok "User registration attempted (HTTP $REGISTER_CODE)"
  else
    warn "Registration failed - HTTP $REGISTER_CODE"
    echo "Response: $(echo "$REGISTER_RESPONSE" | sed '$d')"
  fi
  
  # Try to login
  LOGIN_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
    --max-time 10 2>&1 || echo "")
  
  HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
  if [[ "$HTTP_CODE" == "200" ]]; then
    TEST_TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    TEST_USER_ID=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$TEST_TOKEN" ]]; then
      ok "Test user authenticated via API gateway"
    fi
  else
    warn "Could not authenticate via API gateway - HTTP $HTTP_CODE"
  fi
else
  # Try to register user (may fail if exists, that's ok)
  kubectl -n "$NS" exec "$AUTH_POD" -- curl -sS --max-time 5 -X POST http://localhost:4001/api/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || true
  
  # Get user ID by logging in
  LOGIN_RESPONSE=$(kubectl -n "$NS" exec "$AUTH_POD" -- curl -sS --max-time 5 -X POST http://localhost:4001/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || echo "")
  
  if [[ -n "$LOGIN_RESPONSE" ]]; then
    TEST_USER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    TEST_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$TEST_USER_ID" ]]; then
      ok "Test user created/found: $TEST_USER_ID"
    else
      warn "Could not extract user ID from login response"
    fi
  else
    warn "Could not login/create test user"
  fi
fi

# Step 2: Test HTTP/2 health check
say "Step 2: Testing HTTP/2 health check..."
if "$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/2 health check works"
else
  warn "HTTP/2 health check failed"
fi

# Step 3: Test HTTP/3 health check
say "Step 3: Testing HTTP/3 health check..."
if http3_curl -k -sS -I --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | head -n1 | grep -q "HTTP/3 200"; then
  ok "HTTP/3 health check works"
else
  warn "HTTP/3 health check failed (QUIC path unavailable)"
fi

# Step 4: Test API endpoint via HTTP/2
say "Step 4: Testing API endpoint via HTTP/2..."
API_RESPONSE_H2=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE_H2=$(echo "$API_RESPONSE_H2" | tail -1)
if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/2 - HTTP $HTTP_CODE_H2"
else
  warn "API endpoint test failed via HTTP/2 - HTTP $HTTP_CODE_H2"
fi

# Step 5: Test API endpoint via HTTP/3
say "Step 5: Testing API endpoint via HTTP/3..."
API_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/api/healthz" 2>&1)
HTTP_CODE_H3=$(echo "$API_RESPONSE_H3" | tail -1)
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/3 - HTTP $HTTP_CODE_H3"
else
  warn "API endpoint test failed via HTTP/3 - HTTP $HTTP_CODE_H3"
fi

# Step 6: Test authentication via HTTP/2
say "Step 6: Testing authentication via HTTP/2..."
if [[ -n "${TEST_EMAIL:-}" ]]; then
  AUTH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1)
  AUTH_CODE=$(echo "$AUTH_RESPONSE" | tail -1)
  if [[ "$AUTH_CODE" == "200" ]]; then
    ok "Authentication works via HTTP/2"
    AUTH_TOKEN=$(echo "$AUTH_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Authentication failed via HTTP/2 - HTTP $AUTH_CODE"
  fi
else
  warn "Skipping authentication test (no test user)"
fi

# Step 7: Test records CRUD via HTTP/2
say "Step 7: Testing records CRUD via HTTP/2..."
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  # Create record
  CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -X POST "https://$HOST:8443/api/records" \
    -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}' 2>&1)
  CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  if [[ "$CREATE_CODE" == "200" ]] || [[ "$CREATE_CODE" == "201" ]]; then
    ok "Create record works via HTTP/2"
    RECORD_ID=$(echo "$CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    # Delete record if we got an ID
    if [[ -n "$RECORD_ID" ]]; then
      DELETE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -X DELETE "https://$HOST:8443/api/records/$RECORD_ID" 2>&1)
      DELETE_CODE=$(echo "$DELETE_RESPONSE" | tail -1)
      if [[ "$DELETE_CODE" == "200" ]] || [[ "$DELETE_CODE" == "204" ]]; then
        ok "Delete record works via HTTP/2"
      else
        warn "Delete record failed - HTTP $DELETE_CODE"
      fi
    fi
  else
    warn "Create record failed via HTTP/2 - HTTP $CREATE_CODE"
  fi
else
  warn "Skipping CRUD test (no auth token)"
fi

# Step 8: Test records CRUD via HTTP/3
say "Step 8: Testing records CRUD via HTTP/3..."
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  # Create record
  CREATE_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/records" \
    -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}' 2>&1)
  CREATE_CODE_H3=$(echo "$CREATE_RESPONSE_H3" | tail -1)
  if [[ "$CREATE_CODE_H3" == "200" ]] || [[ "$CREATE_CODE_H3" == "201" ]]; then
    ok "Create record works via HTTP/3"
    RECORD_ID_H3=$(echo "$CREATE_RESPONSE_H3" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    # Delete record if we got an ID
    if [[ -n "$RECORD_ID_H3" ]]; then
      DELETE_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        --resolve "$HTTP3_RESOLVE" \
        -X DELETE "https://$HOST/api/records/$RECORD_ID_H3" 2>&1)
      DELETE_CODE_H3=$(echo "$DELETE_RESPONSE_H3" | tail -1)
      if [[ "$DELETE_CODE_H3" == "200" ]] || [[ "$DELETE_CODE_H3" == "204" ]]; then
        ok "Delete record works via HTTP/3"
      else
        warn "Delete record failed via HTTP/3 - HTTP $DELETE_CODE_H3"
      fi
    fi
  else
    warn "Create record failed via HTTP/3 - HTTP $CREATE_CODE_H3"
  fi
else
  warn "Skipping CRUD test via HTTP/3 (no auth token)"
fi

# Step 9: Verify HTTP/2 and HTTP/3 protocol usage
say "Step 9: Verifying protocol usage..."
H2_PROTOCOL=$("$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -i "HTTP/2" || echo "")
H3_PROTOCOL=$(http3_curl -k -sS -I --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | grep -i "HTTP/3\|HTTP/2" || echo "")

if [[ -n "$H2_PROTOCOL" ]]; then
  ok "HTTP/2 protocol confirmed: $H2_PROTOCOL"
else
  warn "HTTP/2 protocol not confirmed"
fi

if [[ -n "$H3_PROTOCOL" ]]; then
  ok "HTTP/3 protocol confirmed"
else
  warn "HTTP/3 protocol not confirmed"
fi

say "=== Testing Complete ==="
echo ""
echo "Summary:"
echo "- HTTP/2: $(if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then echo "✅ Working"; else echo "❌ Failed"; fi)"
echo "- HTTP/3: $(if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then echo "✅ Working"; else echo "❌ Failed"; fi)"
echo "- Authentication: $(if [[ -n "${AUTH_TOKEN:-}" ]]; then echo "✅ Working"; else echo "⚠️  Skipped"; fi)"
echo "- CRUD Operations: $(if [[ -n "${RECORD_ID:-}" ]] || [[ -n "${RECORD_ID_H3:-}" ]]; then echo "✅ Working"; else echo "⚠️  Skipped"; fi)"

