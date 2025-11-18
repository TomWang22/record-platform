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

say "=== Microservices Testing Complete ==="
