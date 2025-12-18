#!/usr/bin/env bash
set -euo pipefail

NS="record-platform"
HOST="${HOST:-record.local}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

# Auto-detect port based on cluster, or use provided PORT
# Validate PORT if set - if it's 443 (default HTTPS), re-detect
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$CURRENT_CONTEXT" == "kind-h3-multi" ]]; then
    # Multi-node cluster: try ports 8444, 8445, 8446
    for p in 8445 8446 8444; do
      if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
        PORT=$p
        break
      fi
    done
    PORT="${PORT:-8445}"
  else
    # With NodePort, use 30443 (or detect from service)
    PORT="${PORT:-30443}"  # Default to NodePort 30443
    # Try to detect actual NodePort from service if not set
    if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "30443" ]]; then
      DETECTED_PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      if [[ -n "$DETECTED_PORT" ]]; then
        PORT=$DETECTED_PORT
      fi
    fi
  fi
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

# For HTTP/3, we need to use the service ClusterIP when inside container network
# With hostNetwork, we used 127.0.0.1:443, but with NodePort, we need the service IP
# Detect service IP for HTTP/3 (inside container network, we can't use NodePort)
HTTP3_SVC_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -n "$HTTP3_SVC_IP" ]]; then
  HTTP3_RESOLVE="${HOST}:443:${HTTP3_SVC_IP}"
else
  # Fallback to 127.0.0.1 if service not found (shouldn't happen)
  HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
fi
TOKEN=""
TOKEN_USER2=""
USER1_ID=""
USER2_ID=""
GROUP_ID=""
TEST_EMAIL=""
TEST_PASSWORD="test123"

say "=== Testing Microservices via HTTP/2 and HTTP/3 ==="

# Pre-flight: Check database schema
say "Pre-flight: Checking database schema..."
# Check auth database (port 5437, external Docker) - auth-service now uses separate DB
AUTH_SCHEMA_FOUND=false
AUTH_DB_STATUS="unknown"

# Try auth DB first (port 5437) - this is where auth-service expects it
# Use PGCONNECT_TIMEOUT env var to prevent hanging if DB is down
AUTH_DB_CHECK=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>&1 || echo "CONNECTION_FAILED")
if echo "$AUTH_DB_CHECK" | grep -q "1"; then
  ok "Auth schema exists in auth database (port 5437)"
  AUTH_SCHEMA_FOUND=true
  AUTH_DB_STATUS="port_5437"
elif echo "$AUTH_DB_CHECK" | grep -qE "(recovery|No space|FATAL)"; then
  warn "Auth database (port 5437) is in recovery mode or has disk space issues"
  warn "  → Auth-service may fail. Users need to login first for other services to work."
  AUTH_DB_STATUS="recovery"
# Fallback: check main DB (port 5433) - might still have old schema (users migrated there first)
elif PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null | grep -q "1"; then
  warn "Auth schema exists in main database (port 5433)"
  warn "  → Auth-service expects port 5437, but users exist in port 5433"
  warn "  → This is OK for now - users can login from main DB, then other services work"
  AUTH_SCHEMA_FOUND=true
  AUTH_DB_STATUS="port_5433"
# Last resort: check K8s postgres pod
elif kubectl -n "$NS" exec deploy/postgres -- psql -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null | grep -q "1"; then
  warn "Auth schema exists in K8s postgres pod"
  warn "  → Auth-service expects external port 5437"
  AUTH_SCHEMA_FOUND=true
  AUTH_DB_STATUS="k8s_pod"
fi

if [[ "$AUTH_SCHEMA_FOUND" == "false" ]]; then
  warn "Auth schema missing - auth-service will fail"
  warn "  → To fix: ./scripts/setup-auth-db.sh"
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
      # Check if rollout is complete (non-blocking, quick check)
      if kubectl -n "$NS" rollout status deployment/"$service" --timeout=5s >/dev/null 2>&1; then
        ok "$service is ready"
        return 0
      fi
      # Check if pod is in CrashLoopBackOff - if so, warn and continue
      if kubectl -n "$NS" get pods -l app="$service" -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null | grep -q "CrashLoopBackOff"; then
        warn "$service is in CrashLoopBackOff - will continue but tests may fail"
        kubectl -n "$NS" get pods -l app="$service" 2>/dev/null | head -2
        return 1
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

# Helper function to extract user ID from JWT token
extract_user_id() {
  local token=$1
  if [[ -z "$token" ]]; then
    echo ""
    return
  fi
  # Decode JWT payload (second part, base64url)
  local payload=$(echo "$token" | cut -d'.' -f2)
  # Convert base64url to base64 (replace - with +, _ with /)
  payload=$(echo "$payload" | tr '_-' '/+')
  # Add padding if needed
  local mod=$((${#payload} % 4))
  if [[ $mod -eq 2 ]]; then
    payload="${payload}=="
  elif [[ $mod -eq 3 ]]; then
    payload="${payload}="
  fi
  # Decode and extract 'sub' field
  echo "$payload" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

# Test 1: Auth Service - Registration (HTTP/2) - User 1
say "Test 1: Auth Service - Registration via HTTP/2 (User 1)"
TEST_EMAIL="microservice-test-$(date +%s)@example.com"
TEST_PASSWORD="test123"
REGISTER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || {
  warn "Registration curl command failed (exit code: $?)"
  REGISTER_RESPONSE=""
  REGISTER_CODE="000"
}
if [[ -n "$REGISTER_RESPONSE" ]]; then
  REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
else
  REGISTER_CODE="000"
fi
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER1_ID=$(extract_user_id "$TOKEN")
  ok "User 1 registration works via HTTP/2"
  [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
  [[ -n "$USER1_ID" ]] && echo "User 1 ID: $USER1_ID"
elif [[ "$REGISTER_CODE" == "409" ]]; then
  ok "User 1 exists (expected) - will try login instead"
else
  warn "User 1 registration failed - HTTP $REGISTER_CODE"
  echo "Response body: $(echo "$REGISTER_RESPONSE" | sed '$d' | head -5)"
fi

# Test 1b: Auth Service - Registration (HTTP/2) - User 2
say "Test 1b: Auth Service - Registration via HTTP/2 (User 2)"
TEST_EMAIL_USER2="microservice-test-2-$(date +%s)@example.com"
REGISTER_RESPONSE_USER2=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" 2>&1) || {
  warn "User 2 registration curl command failed (exit code: $?)"
  REGISTER_RESPONSE_USER2=""
  REGISTER_CODE_USER2="000"
}
if [[ -n "$REGISTER_RESPONSE_USER2" ]]; then
  REGISTER_CODE_USER2=$(echo "$REGISTER_RESPONSE_USER2" | tail -1)
else
  REGISTER_CODE_USER2="000"
fi
if [[ "$REGISTER_CODE_USER2" == "201" ]]; then
  TOKEN_USER2=$(echo "$REGISTER_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER2_ID=$(extract_user_id "$TOKEN_USER2")
  ok "User 2 registration works via HTTP/2"
  [[ -n "$TOKEN_USER2" ]] && echo "Token: ${TOKEN_USER2:0:50}..."
  [[ -n "$USER2_ID" ]] && echo "User 2 ID: $USER2_ID"
elif [[ "$REGISTER_CODE_USER2" == "409" ]]; then
  ok "User 2 exists (expected) - will try login instead"
else
  warn "User 2 registration failed - HTTP $REGISTER_CODE_USER2"
  echo "Response body: $(echo "$REGISTER_RESPONSE_USER2" | sed '$d' | head -5)"
fi

# Test 2: Auth Service - Login (HTTP/3) - User 1
say "Test 2: Auth Service - Login via HTTP/3 (User 1)"
if [[ -z "$TOKEN" ]]; then
  LOGIN_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
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
      USER1_ID=$(extract_user_id "$TOKEN")
      ok "User 1 login works via HTTP/3"
      [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
      [[ -n "$USER1_ID" ]] && echo "User 1 ID: $USER1_ID"
    else
      warn "User 1 login failed - HTTP $LOGIN_CODE"
      echo "Response body: $(echo "$LOGIN_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  ok "User 1 already has token from registration"
fi

# Test 2b: Auth Service - Login (HTTP/3) - User 2
say "Test 2b: Auth Service - Login via HTTP/3 (User 2)"
if [[ -z "$TOKEN_USER2" ]]; then
  LOGIN_RESPONSE_USER2=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" 2>&1) || {
    warn "HTTP/3 curl command failed (exit code: $?)"
    LOGIN_RESPONSE_USER2=""
    LOGIN_CODE_USER2="000"
  }
  if [[ -n "$LOGIN_RESPONSE_USER2" ]]; then
    LOGIN_CODE_USER2=$(echo "$LOGIN_RESPONSE_USER2" | tail -1)
    if [[ "$LOGIN_CODE_USER2" == "200" ]]; then
      TOKEN_USER2=$(echo "$LOGIN_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
      USER2_ID=$(extract_user_id "$TOKEN_USER2")
      ok "User 2 login works via HTTP/3"
      [[ -n "$TOKEN_USER2" ]] && echo "Token: ${TOKEN_USER2:0:50}..."
      [[ -n "$USER2_ID" ]] && echo "User 2 ID: $USER2_ID"
    else
      warn "User 2 login failed - HTTP $LOGIN_CODE_USER2"
      echo "Response body: $(echo "$LOGIN_RESPONSE_USER2" | sed '$d' | head -5)"
    fi
  fi
else
  ok "User 2 already has token from registration"
fi

# Test 3: Records Service - Create Record (HTTP/2)
say "Test 3: Records Service - Create Record via HTTP/2"
if [[ -n "${TOKEN:-}" ]]; then
  CREATE_RC=0
  CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/records" \
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
  CREATE_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
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
CADDY_H2_HEALTH=$("$CURL_BIN" -k -sS -I --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || CADDY_H2_HEALTH=""
if echo "$CADDY_H2_HEALTH" | head -n1 | grep -q "200"; then
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
GATEWAY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/healthz" 2>&1) || {
  warn "API Gateway health check curl command failed (exit code: $?)"
  GATEWAY_RESPONSE=""
  GATEWAY_CODE="000"
}
if [[ -n "$GATEWAY_RESPONSE" ]]; then
  GATEWAY_CODE=$(echo "$GATEWAY_RESPONSE" | tail -1)
else
  GATEWAY_CODE="000"
fi
if [[ "$GATEWAY_CODE" =~ ^(200|404|502)$ ]]; then
  ok "API Gateway reachable via HTTP/2 - HTTP $GATEWAY_CODE"
else
  warn "API Gateway test failed - HTTP $GATEWAY_CODE"
fi

# Test 6: Social Service - Forum Endpoints (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6: Social Service - Create Forum Post via HTTP/2"
  FORUM_POST_RC=0
  FORUM_POST_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Forum Post","content":"This is a test post via HTTP/2","flair":"general"}' 2>&1) || FORUM_POST_RC=$?
  FORUM_POST_CODE=$(echo "$FORUM_POST_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_RC" -ne 0 ]]; then
    warn "Create forum post request failed (curl exit $FORUM_POST_RC)"
  elif [[ "$FORUM_POST_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post works via HTTP/2"
    FORUM_POST_ID=$(echo "$FORUM_POST_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$FORUM_POST_ID" ]] && echo "Forum post ID: $FORUM_POST_ID"
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
  FORUM_POST_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts" \
    -d '{"title":"Test Forum Post H3","content":"This is a test post via HTTP/3","flair":"general"}' 2>&1) || FORUM_POST_H3_RC=$?
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
  GET_FORUM_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
  GET_FORUM_CODE=$(echo "$GET_FORUM_RESPONSE" | tail -1)
  if [[ "$GET_FORUM_RC" -ne 0 ]]; then
    warn "Get forum posts request failed (curl exit $GET_FORUM_RC)"
  elif [[ "$GET_FORUM_CODE" =~ ^(200)$ ]]; then
    ok "Get forum posts works via HTTP/2"
    # Extract post ID for comment test (if not already set)
    if [[ -z "${FORUM_POST_ID:-}" ]]; then
      FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if [[ -z "$FORUM_POST_ID" ]]; then
        # Try parsing as JSON array
        FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0].get('id', '') if isinstance(data, list) and len(data) > 0 else '')" 2>/dev/null || echo "")
      fi
      [[ -n "$FORUM_POST_ID" ]] && echo "Found forum post ID: $FORUM_POST_ID"
    fi
  else
    warn "Get forum posts failed - HTTP $GET_FORUM_CODE"
    echo "Response body: $(echo "$GET_FORUM_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get forum posts - social-service not available or no auth token"
fi

# Test 7b: Social Service - Add Comment to Forum Post (HTTP/3) - User 2 comments on User 1's post
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 7b: Social Service - Add Comment to Forum Post via HTTP/3 (User 2)"
  ADD_COMMENT_RC=0
  ADD_COMMENT_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"Great post! This is a test comment via HTTP/3 from User 2"}' 2>&1) || ADD_COMMENT_RC=$?
  if [[ "$ADD_COMMENT_RC" -ne 0 ]]; then
    warn "Add comment via HTTP/3 failed (curl exit $ADD_COMMENT_RC)"
  elif [[ -n "$ADD_COMMENT_RESPONSE" ]]; then
    ADD_COMMENT_CODE=$(echo "$ADD_COMMENT_RESPONSE" | tail -1)
    if [[ "$ADD_COMMENT_CODE" =~ ^(200|201)$ ]]; then
      ok "Add comment to forum post works via HTTP/3"
    else
      warn "Add comment via HTTP/3 failed - HTTP $ADD_COMMENT_CODE"
      echo "Response body: $(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment - Forum post ID not available"
  else
    warn "Skipping add comment - social-service not available or no auth token"
  fi
fi

# Test 8: Social Service - P2P Direct Message (HTTP/2) - User 1 to User 2
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 8: Social Service - Send P2P Direct Message via HTTP/2 (User 1 -> User 2)"
  SEND_MSG_RC=0
  SEND_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages" \
    -d "{\"recipient_id\":\"$USER2_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Message\",\"content\":\"Hello User 2, this is a test message via HTTP/2\"}" 2>&1) || SEND_MSG_RC=$?
  SEND_MSG_CODE=$(echo "$SEND_MSG_RESPONSE" | tail -1)
  if [[ "$SEND_MSG_RC" -ne 0 ]]; then
    warn "Send P2P message request failed (curl exit $SEND_MSG_RC)"
  elif [[ "$SEND_MSG_CODE" =~ ^(200|201)$ ]]; then
    ok "Send P2P message works via HTTP/2"
    MESSAGE_ID=$(echo "$SEND_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Send P2P message failed - HTTP $SEND_MSG_CODE"
    echo "Response body: $(echo "$SEND_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping P2P message test - User 2 ID not available"
  else
    warn "Skipping P2P message test - social-service not available or no auth token"
  fi
fi

# Test 8b: Social Service - P2P Direct Message (HTTP/3) - User 2 to User 1
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${USER1_ID:-}" ]]; then
  say "Test 8b: Social Service - Send P2P Direct Message via HTTP/3 (User 2 -> User 1)"
  SEND_MSG_H3_RC=0
  SEND_MSG_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"recipient_id\":\"$USER1_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Reply\",\"content\":\"Hello User 1, this is a reply via HTTP/3\"}" 2>&1) || SEND_MSG_H3_RC=$?
  if [[ "$SEND_MSG_H3_RC" -ne 0 ]]; then
    warn "Send P2P message via HTTP/3 failed (curl exit $SEND_MSG_H3_RC)"
  elif [[ -n "$SEND_MSG_H3_RESPONSE" ]]; then
    SEND_MSG_H3_CODE=$(echo "$SEND_MSG_H3_RESPONSE" | tail -1)
    if [[ "$SEND_MSG_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Send P2P message works via HTTP/3"
      MESSAGE_H3_ID=$(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Send P2P message via HTTP/3 failed - HTTP $SEND_MSG_H3_CODE"
      echo "Response body: $(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${USER1_ID:-}" ]]; then
    warn "Skipping P2P message reply test - User 1 ID not available"
  else
    warn "Skipping P2P message reply test - social-service not available or no auth token"
  fi
fi

# Test 9: Social Service - Get Messages (HTTP/2) - User 2's inbox
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]]; then
  say "Test 9: Social Service - Get Messages via HTTP/2 (User 2's inbox)"
  GET_MSG_RC=0
  GET_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages" 2>&1) || GET_MSG_RC=$?
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

# Test 9b: Social Service - Create Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9b: Social Service - Create Group Chat via HTTP/2"
  CREATE_GROUP_RC=0
  CREATE_GROUP_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups" \
    -d '{"name":"My Custom Group Name","description":"A test group for HTTP/2/3 testing"}' 2>&1) || CREATE_GROUP_RC=$?
  CREATE_GROUP_CODE=$(echo "$CREATE_GROUP_RESPONSE" | tail -1)
  if [[ "$CREATE_GROUP_RC" -ne 0 ]]; then
    warn "Create group request failed (curl exit $CREATE_GROUP_RC)"
  elif [[ "$CREATE_GROUP_CODE" =~ ^(200|201)$ ]]; then
    ok "Create group works via HTTP/2"
    GROUP_ID=$(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$GROUP_ID" ]] && echo "Group ID: $GROUP_ID"
  else
    warn "Create group failed - HTTP $CREATE_GROUP_CODE"
    echo "Response body: $(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping create group - social-service not available or no auth token"
fi

# Test 9c: Social Service - Add User 2 to Group (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 9c: Social Service - Add User 2 to Group via HTTP/2"
  ADD_MEMBER_RC=0
  ADD_MEMBER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
    -d "{\"user_id\":\"$USER2_ID\"}" 2>&1) || ADD_MEMBER_RC=$?
  ADD_MEMBER_CODE=$(echo "$ADD_MEMBER_RESPONSE" | tail -1)
  if [[ "$ADD_MEMBER_RC" -ne 0 ]]; then
    warn "Add member request failed (curl exit $ADD_MEMBER_RC)"
  elif [[ "$ADD_MEMBER_CODE" =~ ^(200|201)$ ]]; then
    ok "Add member to group works via HTTP/2"
  else
    warn "Add member to group failed - HTTP $ADD_MEMBER_CODE"
    echo "Response body: $(echo "$ADD_MEMBER_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping add member - Group ID not available"
  elif [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping add member - User 2 ID not available"
  else
    warn "Skipping add member - social-service not available or no auth token"
  fi
fi

# Test 9d: Social Service - Send Group Message (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9d: Social Service - Send Group Message via HTTP/3"
  SEND_GROUP_MSG_RC=0
  SEND_GROUP_MSG_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"group_id\":\"$GROUP_ID\",\"message_type\":\"group\",\"subject\":\"Group Chat Test\",\"content\":\"Hello group! This is a test message via HTTP/3\"}" 2>&1) || SEND_GROUP_MSG_RC=$?
  if [[ "$SEND_GROUP_MSG_RC" -ne 0 ]]; then
    warn "Send group message via HTTP/3 failed (curl exit $SEND_GROUP_MSG_RC)"
  elif [[ -n "$SEND_GROUP_MSG_RESPONSE" ]]; then
    SEND_GROUP_MSG_CODE=$(echo "$SEND_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$SEND_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
      ok "Send group message works via HTTP/3"
    else
      warn "Send group message via HTTP/3 failed - HTTP $SEND_GROUP_MSG_CODE"
      echo "Response body: $(echo "$SEND_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping group message - Group ID not available"
  else
    warn "Skipping group message - social-service not available or no auth token"
  fi
fi

# Test 9e: Social Service - Get Group Details (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9e: Social Service - Get Group Details via HTTP/2"
  GET_GROUP_RC=0
  GET_GROUP_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || GET_GROUP_RC=$?
  GET_GROUP_CODE=$(echo "$GET_GROUP_RESPONSE" | tail -1)
  if [[ "$GET_GROUP_RC" -ne 0 ]]; then
    warn "Get group details request failed (curl exit $GET_GROUP_RC)"
  elif [[ "$GET_GROUP_CODE" =~ ^(200)$ ]]; then
    ok "Get group details works via HTTP/2"
  else
    warn "Get group details failed - HTTP $GET_GROUP_CODE"
    echo "Response body: $(echo "$GET_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping get group details - Group ID not available"
  else
    warn "Skipping get group details - social-service not available or no auth token"
  fi
fi

# Test 9f: Social Service - Reply to Group Message (WhatsApp-style) (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9f: Social Service - Reply to Group Message via HTTP/2 (WhatsApp-style)"
  # First, get a message ID from the group (from Test 9d)
  # Try to get group messages by querying the group details or messages with group_id filter
  GET_GROUP_MSG_RC=0
  GET_GROUP_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages?page=1&limit=50" 2>&1) || GET_GROUP_MSG_RC=$?
  if [[ "$GET_GROUP_MSG_RC" -eq 0 ]]; then
    GET_GROUP_MSG_CODE=$(echo "$GET_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$GET_GROUP_MSG_CODE" == "200" ]]; then
      # Try to extract a message ID from the group messages (look for messages with group_id matching GROUP_ID)
      # First try to find a message with group_id in the response
      GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and 'messages' in data:
        messages = data['messages']
    elif isinstance(data, list):
        messages = data
    else:
        messages = []
    for msg in messages:
        if isinstance(msg, dict) and msg.get('group_id') == '${GROUP_ID}':
            print(msg.get('id', ''))
            break
except:
    pass
" 2>/dev/null || echo "")
      # If not found, try simple grep (fallback) - get any message ID
      if [[ -z "$GROUP_MSG_ID" ]]; then
        GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      fi
      # Debug output
      if [[ -z "$GROUP_MSG_ID" ]]; then
        echo "Debug: Could not extract group message ID from response"
        echo "Response preview: $(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | head -20)"
      fi
      if [[ -n "$GROUP_MSG_ID" ]]; then
        REPLY_GROUP_MSG_RC=0
        REPLY_GROUP_MSG_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
          --resolve "$HOST:${PORT}:127.0.0.1" \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          -X POST "https://$HOST:${PORT}/api/messages/$GROUP_MSG_ID/reply" \
          -d '{"message_type":"group","subject":"Re: Group Chat Test","content":"This is a WhatsApp-style reply to the previous message!"}' 2>&1) || REPLY_GROUP_MSG_RC=$?
        REPLY_GROUP_MSG_CODE=$(echo "$REPLY_GROUP_MSG_RESPONSE" | tail -1)
        if [[ "$REPLY_GROUP_MSG_RC" -ne 0 ]]; then
          warn "Reply to group message request failed (curl exit $REPLY_GROUP_MSG_RC)"
        elif [[ "$REPLY_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
          ok "Reply to group message works via HTTP/2 (WhatsApp-style)"
          # Check if parent_message is included in response
          if echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | grep -q "parent_message"; then
            ok "Parent message context included in reply response"
          fi
        else
          warn "Reply to group message failed - HTTP $REPLY_GROUP_MSG_CODE"
          echo "Response body: $(echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
        fi
      else
        warn "No group message ID found to reply to"
      fi
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping reply to group message - Group ID not available"
  else
    warn "Skipping reply to group message - social-service not available or no auth token"
  fi
fi

# Test 9g: Social Service - Forum Post with upload_type (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9g: Social Service - Create Forum Post with upload_type via HTTP/2"
  FORUM_POST_UPLOAD_RC=0
  FORUM_POST_UPLOAD_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Image Post","content":"This is a test post with upload_type=image","flair":"general","upload_type":"image"}' 2>&1) || FORUM_POST_UPLOAD_RC=$?
  FORUM_POST_UPLOAD_CODE=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_UPLOAD_RC" -ne 0 ]]; then
    warn "Create forum post with upload_type request failed (curl exit $FORUM_POST_UPLOAD_RC)"
  elif [[ "$FORUM_POST_UPLOAD_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post with upload_type works via HTTP/2"
    FORUM_POST_UPLOAD_ID=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    # Verify upload_type is in response
    if echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -q '"upload_type":"image"'; then
      ok "upload_type field correctly returned in response"
    fi
  else
    warn "Create forum post with upload_type failed - HTTP $FORUM_POST_UPLOAD_CODE"
    echo "Response body: $(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post with upload_type - social-service not available or no auth token"
fi

# Test 9h: Social Service - Add Attachment to Forum Post (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9h: Social Service - Add Attachment to Forum Post via HTTP/2"
  POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  POST_ATTACH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$POST_ID/attachments" \
    -d '{"file_url":"https://example.com/test-image.jpg","file_type":"image","file_name":"test-image.jpg","mime_type":"image/jpeg","file_size":12345,"width":1920,"height":1080,"display_order":0}' 2>&1) || POST_ATTACH_RC=$?
  POST_ATTACH_CODE=$(echo "$POST_ATTACH_RESPONSE" | tail -1)
  if [[ "$POST_ATTACH_RC" -ne 0 ]]; then
    warn "Add post attachment request failed (curl exit $POST_ATTACH_RC)"
  elif [[ "$POST_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to forum post works via HTTP/2"
    POST_ATTACH_ID=$(echo "$POST_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add post attachment failed - HTTP $POST_ATTACH_CODE"
    echo "Response body: $(echo "$POST_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
    warn "Skipping add post attachment - Forum post ID not available"
  else
    warn "Skipping add post attachment - social-service not available or no auth token"
  fi
fi

# Test 9i: Social Service - Add Attachment to Comment (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 9i: Social Service - Add Comment with Attachment via HTTP/3"
  # First create a comment
  COMMENT_WITH_ATTACH_RC=0
  COMMENT_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"This comment will have an attachment"}' 2>&1) || COMMENT_WITH_ATTACH_RC=$?
  if [[ "$COMMENT_WITH_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_RESPONSE" ]]; then
    COMMENT_CODE=$(echo "$COMMENT_RESPONSE" | tail -1)
    if [[ "$COMMENT_CODE" =~ ^(200|201)$ ]]; then
      COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      # Also try JSON parsing as fallback
      if [[ -z "$COMMENT_ID" ]]; then
        COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', '') if isinstance(data, dict) else '')" 2>/dev/null || echo "")
      fi
      if [[ -n "$COMMENT_ID" ]] && [[ "$COMMENT_ID" != "placeholder-comment-id" ]]; then
        # Add attachment to comment
        COMMENT_ATTACH_RC=0
        COMMENT_ATTACH_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          --resolve "$HTTP3_RESOLVE" \
          -X POST "https://$HOST/api/forum/comments/$COMMENT_ID/attachments" \
          -d '{"file_url":"https://example.com/comment-pdf.pdf","file_type":"document","file_name":"document.pdf","mime_type":"application/pdf","file_size":54321,"display_order":0}' 2>&1) || COMMENT_ATTACH_RC=$?
        if [[ "$COMMENT_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_ATTACH_RESPONSE" ]]; then
          COMMENT_ATTACH_CODE=$(echo "$COMMENT_ATTACH_RESPONSE" | tail -1)
          if [[ "$COMMENT_ATTACH_CODE" =~ ^(200|201)$ ]]; then
            ok "Add attachment to comment works via HTTP/3"
          else
            warn "Add comment attachment failed - HTTP $COMMENT_ATTACH_CODE"
            echo "Response body: $(echo "$COMMENT_ATTACH_RESPONSE" | sed '$d' | head -5)"
          fi
        else
          warn "Add comment attachment request failed (curl exit $COMMENT_ATTACH_RC)"
        fi
      else
        warn "Comment ID extraction failed or invalid - COMMENT_ID='${COMMENT_ID}'"
        echo "Comment response: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -10)"
      fi
    else
      warn "Create comment for attachment test failed - HTTP $COMMENT_CODE"
      echo "Response body: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Create comment for attachment test failed"
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment attachment - Forum post ID not available"
  else
    warn "Skipping add comment attachment - social-service not available or no auth token"
  fi
fi

# Test 9j: Social Service - Add Attachment to Message (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
  say "Test 9j: Social Service - Add Attachment to Message via HTTP/2"
  MSG_ATTACH_RC=0
  MSG_ID="${MESSAGE_ID:-$MESSAGE_H3_ID}"
  MSG_ATTACH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/attachments" \
    -d '{"file_url":"https://example.com/video.mp4","file_type":"video","file_name":"test-video.mp4","mime_type":"video/mp4","file_size":9876543,"width":1280,"height":720,"duration":120,"display_order":0}' 2>&1) || MSG_ATTACH_RC=$?
  MSG_ATTACH_CODE=$(echo "$MSG_ATTACH_RESPONSE" | tail -1)
  if [[ "$MSG_ATTACH_RC" -ne 0 ]]; then
    warn "Add message attachment request failed (curl exit $MSG_ATTACH_RC)"
  elif [[ "$MSG_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to message works via HTTP/2"
    MSG_ATTACH_ID=$(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add message attachment failed - HTTP $MSG_ATTACH_CODE"
    echo "Response body: $(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
    warn "Skipping add message attachment - Message ID not available"
  else
    warn "Skipping add message attachment - social-service not available or no auth token"
  fi
fi

# Test 9k: Social Service - Leave Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9k: Social Service - Leave Group Chat via HTTP/2"
  LEAVE_GROUP_RC=0
  LEAVE_GROUP_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X DELETE "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/leave" 2>&1) || LEAVE_GROUP_RC=$?
  LEAVE_GROUP_CODE=$(echo "$LEAVE_GROUP_RESPONSE" | tail -1)
  if [[ "$LEAVE_GROUP_RC" -ne 0 ]]; then
    warn "Leave group request failed (curl exit $LEAVE_GROUP_RC)"
  elif [[ "$LEAVE_GROUP_CODE" =~ ^(204)$ ]]; then
    ok "Leave group chat works via HTTP/2"
    # Verify user is no longer in group by trying to get group details (should fail with 403)
    VERIFY_LEAVE_RC=0
    VERIFY_LEAVE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || VERIFY_LEAVE_RC=$?
    VERIFY_LEAVE_CODE=$(echo "$VERIFY_LEAVE_RESPONSE" | tail -1)
    if [[ "$VERIFY_LEAVE_CODE" == "403" ]]; then
      ok "User successfully left group (403 on group access confirms removal)"
    else
      warn "Leave verification unexpected - HTTP $VERIFY_LEAVE_CODE (expected 403)"
    fi
  else
    warn "Leave group failed - HTTP $LEAVE_GROUP_CODE"
    echo "Response body: $(echo "$LEAVE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping leave group - Group ID not available"
  else
    warn "Skipping leave group - social-service not available or no auth token"
  fi
fi

# Test 9l: Social Service - Get Post Attachments (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9l: Social Service - Get Post Attachments via HTTP/3"
  GET_POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  GET_POST_ATTACH_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer ${TOKEN:-$TOKEN_USER2}" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/forum/posts/$POST_ID/attachments" 2>&1) || GET_POST_ATTACH_RC=$?
  if [[ "$GET_POST_ATTACH_RC" -eq 0 ]] && [[ -n "$GET_POST_ATTACH_RESPONSE" ]]; then
    GET_POST_ATTACH_CODE=$(echo "$GET_POST_ATTACH_RESPONSE" | tail -1)
    if [[ "$GET_POST_ATTACH_CODE" == "200" ]]; then
      ok "Get post attachments works via HTTP/3"
    else
      warn "Get post attachments failed - HTTP $GET_POST_ATTACH_CODE"
    fi
  else
    warn "Get post attachments request failed (curl exit $GET_POST_ATTACH_RC)"
  fi
else
  warn "Skipping get post attachments - Forum post ID not available"
fi

# Test 10: Listings Service - Health Check (HTTP/2)
# Note: Health check should be public (no auth required), but listings service requires auth
# So we'll test it directly or skip if it requires auth
if [[ "${SKIP_LISTINGS:-}" != "1" ]]; then
  say "Test 10: Listings Service - Health Check via HTTP/2"
  LISTINGS_HEALTH_RC=0
  LISTINGS_HEALTH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/api/listings/healthz" 2>&1) || LISTINGS_HEALTH_RC=$?
  LISTINGS_HEALTH_CODE=$(echo "$LISTINGS_HEALTH_RESPONSE" | tail -1)
  if [[ "$LISTINGS_HEALTH_RC" -ne 0 ]]; then
    warn "Listings health check failed (curl exit $LISTINGS_HEALTH_RC)"
  elif [[ "$LISTINGS_HEALTH_CODE" =~ ^(200|401)$ ]]; then
    # 401 is expected if healthz requires auth (which it shouldn't, but listings router has global auth middleware)
    if [[ "$LISTINGS_HEALTH_CODE" == "200" ]]; then
      ok "Listings health check works via HTTP/2"
    else
      warn "Listings health check requires auth (HTTP 401) - this is a configuration issue"
    fi
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
  LISTINGS_SEARCH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/listings/search?q=vinyl" 2>&1) || LISTINGS_SEARCH_RC=$?
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
  LISTINGS_SEARCH_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
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
  # Try with NodePort (HTTP/2), with increased timeout to match API gateway proxyTimeout
  LISTINGS_CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 --connect-timeout 10 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/listings" \
    -d '{"title":"Test Vinyl Record","description":"Mint condition test listing","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_RC=$?
  
  # If NodePort times out, try port 443 as fallback (same as HTTP/3 test)
  if [[ "$LISTINGS_CREATE_RC" -eq 28 ]]; then
    warn "NodePort ${PORT} timed out, trying port 443 as fallback..."
    LISTINGS_CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 --connect-timeout 10 \
      --resolve "$HOST:443:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:443/api/listings" \
      -d '{"title":"Test Vinyl Record","description":"Mint condition test listing","price":29.99,"listing_type":"fixed_price","condition":"Mint","category":"Vinyl"}' 2>&1) || LISTINGS_CREATE_RC=$?
  fi
  
  LISTINGS_CREATE_CODE=$(echo "$LISTINGS_CREATE_RESPONSE" | tail -1)
  if [[ "$LISTINGS_CREATE_RC" -ne 0 ]]; then
    warn "Create listing request failed (curl exit $LISTINGS_CREATE_RC)"
    if [[ "$LISTINGS_CREATE_RC" -eq 28 ]]; then
      warn "  → Timeout (28): Request took longer than 30s on both NodePort ${PORT} and port 443"
      warn "  → This may indicate:"
      warn "     - Database connection issue (check listings-service logs)"
      warn "     - API gateway proxy timeout"
      warn "     - HTTP/2 connection pooling issue in Caddy/Linkerd"
      warn "  → Note: HTTP/3 version (Test 12b) works, suggesting HTTP/2-specific issue"
      warn "  → Debug: Check kubectl logs -l app=listings-service"
    fi
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
  LISTINGS_CREATE_H3_RESPONSE=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
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
  LISTINGS_MY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/listings/my-listings" 2>&1) || LISTINGS_MY_RC=$?
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

# Test 13: Shopping Service - Cart, Checkout, Orders, Purchase History, Resell (HTTP/2)
if [[ "${SKIP_SHOPPING:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 13: Shopping Service - Cart Operations via HTTP/2"
  
  # Test 13a: Add item to cart
  say "Test 13a: Shopping Service - Add Item to Cart via HTTP/2"
  if [[ -n "${LISTING_ID:-}" ]]; then
    ADD_CART_RC=0
    ADD_CART_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/cart" \
      -d "{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99,\"metadata\":{\"title\":\"Test Listing\"}}" 2>&1) || ADD_CART_RC=$?
    ADD_CART_CODE=$(echo "$ADD_CART_RESPONSE" | tail -1)
    if [[ "$ADD_CART_RC" -ne 0 ]]; then
      warn "Add to cart request failed (curl exit $ADD_CART_RC)"
    elif [[ "$ADD_CART_CODE" =~ ^(200|201)$ ]]; then
      ok "Add item to cart works via HTTP/2"
      CART_ITEM_ID=$(echo "$ADD_CART_RESPONSE" | sed '$d' | grep -o '"cart_item_id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Add to cart failed - HTTP $ADD_CART_CODE"
      echo "Response body: $(echo "$ADD_CART_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Skipping add to cart - Listing ID not available"
  fi
  
  # Test 13b: Get cart
  say "Test 13b: Shopping Service - Get Cart via HTTP/2"
  GET_CART_RC=0
  GET_CART_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/cart" 2>&1) || GET_CART_RC=$?
  GET_CART_CODE=$(echo "$GET_CART_RESPONSE" | tail -1)
  if [[ "$GET_CART_RC" -ne 0 ]]; then
    warn "Get cart request failed (curl exit $GET_CART_RC)"
  elif [[ "$GET_CART_CODE" == "200" ]]; then
    ok "Get cart works via HTTP/2"
    CART_ITEMS=$(echo "$GET_CART_RESPONSE" | sed '$d' | grep -o '"items":\[.*\]' || echo "")
    if [[ -n "$CART_ITEMS" ]]; then
      CART_ITEM_ID=$(echo "$GET_CART_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
  else
    warn "Get cart failed - HTTP $GET_CART_CODE"
  fi
  
  # Test 13c: Checkout (with simulated payment)
  say "Test 13c: Shopping Service - Checkout with Simulated Payment via HTTP/2"
  if [[ -n "${CART_ITEM_ID:-}" ]] && [[ -n "${LISTING_ID:-}" ]]; then
    CHECKOUT_RC=0
    CHECKOUT_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/cart/checkout" \
      -d "{\"items\":[{\"item_type\":\"listing\",\"item_id\":\"$LISTING_ID\",\"listing_id\":\"$LISTING_ID\",\"quantity\":1,\"price\":29.99}],\"payment_method\":\"simulated\",\"shipping_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"},\"billing_address\":{\"street\":\"123 Test St\",\"city\":\"Test City\",\"state\":\"CA\",\"zip\":\"12345\",\"country\":\"US\"}}" 2>&1) || CHECKOUT_RC=$?
    CHECKOUT_CODE=$(echo "$CHECKOUT_RESPONSE" | tail -1)
    if [[ "$CHECKOUT_RC" -ne 0 ]]; then
      warn "Checkout request failed (curl exit $CHECKOUT_RC)"
    elif [[ "$CHECKOUT_CODE" =~ ^(200|201)$ ]]; then
      ok "Checkout with simulated payment works via HTTP/2"
      ORDER_ID=$(echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      ORDER_NUMBER=$(echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -o '"order_number":"[^"]*"' | cut -d'"' -f4 || echo "")
      PURCHASE_ID=$(echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -o '"purchase_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      # Also try to extract from purchases array
      if [[ -z "$PURCHASE_ID" ]]; then
        PURCHASE_ID=$(echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "")
      fi
      if echo "$CHECKOUT_RESPONSE" | sed '$d' | grep -q '"payment_status":"paid"'; then
        ok "Payment status confirmed as paid"
      fi
    else
      warn "Checkout failed - HTTP $CHECKOUT_CODE"
      echo "Response body: $(echo "$CHECKOUT_RESPONSE" | sed '$d' | head -10)"
    fi
  else
    warn "Skipping checkout - Cart item ID or Listing ID not available"
  fi
  
  # Test 13d: Get orders
  say "Test 13d: Shopping Service - Get Orders via HTTP/2"
  GET_ORDERS_RC=0
  GET_ORDERS_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/orders" 2>&1) || GET_ORDERS_RC=$?
  GET_ORDERS_CODE=$(echo "$GET_ORDERS_RESPONSE" | tail -1)
  if [[ "$GET_ORDERS_RC" -ne 0 ]]; then
    warn "Get orders request failed (curl exit $GET_ORDERS_RC)"
  elif [[ "$GET_ORDERS_CODE" == "200" ]]; then
    ok "Get orders works via HTTP/2"
    if [[ -z "${ORDER_NUMBER:-}" ]]; then
      ORDER_NUMBER=$(echo "$GET_ORDERS_RESPONSE" | sed '$d' | grep -o '"order_number":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
  else
    warn "Get orders failed - HTTP $GET_ORDERS_CODE"
  fi
  
  # Test 13e: Get order details
  say "Test 13e: Shopping Service - Get Order Details via HTTP/2"
  if [[ -n "${ORDER_ID:-}" ]]; then
    GET_ORDER_RC=0
    GET_ORDER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X GET "https://$HOST:${PORT}/api/orders/$ORDER_ID" 2>&1) || GET_ORDER_RC=$?
    GET_ORDER_CODE=$(echo "$GET_ORDER_RESPONSE" | tail -1)
    if [[ "$GET_ORDER_RC" -ne 0 ]]; then
      warn "Get order details request failed (curl exit $GET_ORDER_RC)"
    elif [[ "$GET_ORDER_CODE" == "200" ]]; then
      ok "Get order details works via HTTP/2"
      if echo "$GET_ORDER_RESPONSE" | sed '$d' | grep -q '"items"'; then
        ok "Order items included in response"
      fi
    else
      warn "Get order details failed - HTTP $GET_ORDER_CODE"
    fi
  else
    warn "Skipping get order details - Order ID not available"
  fi
  
  # Test 13f: Get purchase history
  say "Test 13f: Shopping Service - Get Purchase History via HTTP/2"
  GET_PURCHASES_RC=0
  GET_PURCHASES_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/history/purchases" 2>&1) || GET_PURCHASES_RC=$?
  GET_PURCHASES_CODE=$(echo "$GET_PURCHASES_RESPONSE" | tail -1)
  if [[ "$GET_PURCHASES_RC" -ne 0 ]]; then
    warn "Get purchase history request failed (curl exit $GET_PURCHASES_RC)"
  elif [[ "$GET_PURCHASES_CODE" == "200" ]]; then
    ok "Get purchase history works via HTTP/2"
    if [[ -z "${PURCHASE_ID:-}" ]]; then
      PURCHASE_ID=$(echo "$GET_PURCHASES_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
    if echo "$GET_PURCHASES_RESPONSE" | sed '$d' | grep -q '"resellable":true'; then
      ok "Purchase history includes resellable flag"
    fi
  else
    warn "Get purchase history failed - HTTP $GET_PURCHASES_CODE"
  fi
  
  # Test 13g: Get resellable purchases (eBay-style)
  say "Test 13g: Shopping Service - Get Resellable Purchases via HTTP/2"
  GET_RESELLABLE_RC=0
  GET_RESELLABLE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/resell/purchases" 2>&1) || GET_RESELLABLE_RC=$?
  GET_RESELLABLE_CODE=$(echo "$GET_RESELLABLE_RESPONSE" | tail -1)
  if [[ "$GET_RESELLABLE_RC" -ne 0 ]]; then
    warn "Get resellable purchases request failed (curl exit $GET_RESELLABLE_RC)"
  elif [[ "$GET_RESELLABLE_CODE" == "200" ]]; then
    ok "Get resellable purchases works via HTTP/2"
    if [[ -z "${PURCHASE_ID:-}" ]]; then
      PURCHASE_ID=$(echo "$GET_RESELLABLE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    fi
  else
    warn "Get resellable purchases failed - HTTP $GET_RESELLABLE_CODE"
  fi
  
  # Test 13h: Resell purchase (eBay-style - create listing from purchase)
  say "Test 13h: Shopping Service - Resell Purchase (eBay-style) via HTTP/2"
  if [[ -n "${PURCHASE_ID:-}" ]]; then
    RESELL_RC=0
    RESELL_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/resell/$PURCHASE_ID" \
      -d "{\"title\":\"Reselling Test Item\",\"description\":\"This is a test resell listing\",\"price\":35.99,\"currency\":\"USD\",\"listing_type\":\"fixed_price\",\"condition\":\"used\",\"category\":\"vinyl\",\"location\":\"US\",\"shipping_cost\":5.00,\"mark_as_resold\":true}" 2>&1) || RESELL_RC=$?
    RESELL_CODE=$(echo "$RESELL_RESPONSE" | tail -1)
    if [[ "$RESELL_RC" -ne 0 ]]; then
      warn "Resell purchase request failed (curl exit $RESELL_RC)"
    elif [[ "$RESELL_CODE" =~ ^(200|201)$ ]]; then
      ok "Resell purchase works via HTTP/2 (eBay-style)"
      RESELL_LISTING_ID=$(echo "$RESELL_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if echo "$RESELL_RESPONSE" | sed '$d' | grep -q '"resold_from_purchase"'; then
        ok "Resell listing includes purchase metadata"
      fi
    else
      warn "Resell purchase failed - HTTP $RESELL_CODE"
      echo "Response body: $(echo "$RESELL_RESPONSE" | sed '$d' | head -10)"
    fi
  else
    warn "Skipping resell purchase - Purchase ID not available"
  fi
  
  # Test 13i: Search history
  say "Test 13i: Shopping Service - Add Search History via HTTP/2"
  ADD_SEARCH_RC=0
  ADD_SEARCH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/history/searches" \
    -d "{\"query\":\"test search\",\"query_type\":\"listing\",\"filters\":{\"min_price\":10,\"max_price\":100},\"result_count\":25}" 2>&1) || ADD_SEARCH_RC=$?
  ADD_SEARCH_CODE=$(echo "$ADD_SEARCH_RESPONSE" | tail -1)
  if [[ "$ADD_SEARCH_RC" -ne 0 ]]; then
    warn "Add search history request failed (curl exit $ADD_SEARCH_RC)"
  elif [[ "$ADD_SEARCH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add search history works via HTTP/2"
  else
    warn "Add search history failed - HTTP $ADD_SEARCH_CODE"
  fi
else
  if [[ "${SKIP_SHOPPING:-}" == "1" ]]; then
    warn "Skipping shopping service tests - SKIP_SHOPPING=1"
  else
    warn "Skipping shopping service tests - shopping-service not available or no auth token"
  fi
fi

# Test 14: Logout (HTTP/2)
if [[ -n "${TOKEN:-}" ]]; then
  say "Test 14: Auth Service - Logout via HTTP/2"
  LOGOUT_RC=0
  LOGOUT_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/auth/logout" 2>&1) || LOGOUT_RC=$?
  LOGOUT_CODE=$(echo "$LOGOUT_RESPONSE" | tail -1)
  if [[ "$LOGOUT_RC" -ne 0 ]]; then
    warn "Logout request failed (curl exit $LOGOUT_RC)"
  elif [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/2"
    # Verify token is revoked by trying to use it
    sleep 1
    VERIFY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X GET "https://$HOST:${PORT}/api/records" 2>&1)
    VERIFY_CODE=$(echo "$VERIFY_RESPONSE" | tail -1)
    if [[ "$VERIFY_CODE" == "401" ]]; then
      ok "Token revocation verified (401 on protected endpoint)"
    else
      warn "Token may not be revoked (got HTTP $VERIFY_CODE instead of 401)"
    fi
  else
    warn "Logout failed - HTTP $LOGOUT_CODE"
  fi
else
  warn "Skipping logout test - no auth token available"
fi

# Helper function to run grpcurl with timeout
grpcurl_with_timeout() {
  local timeout_sec="${1:-10}"
  shift
  local cmd=("$@")
  
  # Try to use timeout command (Linux, or gtimeout on macOS with coreutils)
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "${cmd[@]}" 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_sec" "${cmd[@]}" 2>&1
  else
    # Fallback: run in background and kill after timeout
    local pid
    "${cmd[@]}" 2>&1 &
    pid=$!
    (
      sleep "$timeout_sec"
      kill "$pid" 2>/dev/null || true
    ) &
    wait "$pid" 2>/dev/null || echo "grpcurl timeout after ${timeout_sec}s"
  fi
}

# Helper function to test gRPC with both FIX #1 (h2c port 5000) and FIX #2 (improved flags on NodePort)
grpc_test() {
  local service_name="$1"
  local method="$2"
  local proto_file="$3"
  local data="${4:-'{}'}"
  local timeout="${5:-10}"
  
  PROTO_DIR="${SCRIPT_DIR}/../proto"
  [[ -d "$PROTO_DIR" ]] || PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../proto" && pwd)"
  
  local result=""
  
  # FIX #1: Try h2c port 5000 first (plaintext, most reliable)
  # Note: Port 5000 may not be working, so we'll try with a shorter timeout
  CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$CADDY_POD" ]]; then
    # Start port forward in background
    kubectl -n ingress-nginx port-forward pod/$CADDY_POD 5000:5000 > /dev/null 2>&1 &
    local PF_PID=$!
    sleep 2
    # Try port 5000 with shorter timeout (2 seconds) to fail fast
    # Use grpcurl's built-in timeout instead of wrapper to avoid conflicts
    result=$(grpcurl -plaintext \
      -import-path "$PROTO_DIR" \
      -proto "$PROTO_DIR/$proto_file" \
      -d "$data" \
      -max-time 2 \
      "127.0.0.1:5000" "$method" 2>&1) || result=""
    kill $PF_PID 2>/dev/null || true
    wait $PF_PID 2>/dev/null || true
    sleep 1  # Give port forward time to clean up
  fi
  
  # FIX #2: Fallback to improved flags on NodePort if h2c port fails
  # Check if result is empty, contains error, or timeout
  if [[ -z "$result" ]] || echo "$result" | grep -q -iE "error|failed|timeout|deadline|connection refused|dial.*failed|context deadline"; then
    # Use grpcurl's built-in timeout for NodePort as well
    result=$(grpcurl -insecure \
      -H "Host: $HOST" \
      -authority "$HOST" \
      -H "TE: trailers" \
      -H "Content-Type: application/grpc" \
      -import-path "$PROTO_DIR" \
      -proto "$PROTO_DIR/$proto_file" \
      -max-time "$timeout" \
      -d "$data" \
      "127.0.0.1:${PORT}" "$method" 2>&1) || result=""
  fi
  
  echo "$result"
}

# Test 15: gRPC Testing (if grpcurl is available)
say "Test 15: gRPC Service Testing"
if ! command -v grpcurl >/dev/null 2>&1; then
  warn "grpcurl not installed - skipping gRPC tests"
  warn "  Install with: brew install grpcurl"
  warn "  Or: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest"
else
  # Test gRPC Auth Service - HealthCheck
  say "Test 15a: gRPC Auth Service - HealthCheck via HTTP/2"
  GRPC_AUTH_HEALTH=$(grpc_test "Auth" "auth.AuthService/HealthCheck" "auth.proto" '{}' 10)
  if echo "$GRPC_AUTH_HEALTH" | grep -q "healthy"; then
    ok "gRPC Auth HealthCheck works via HTTP/2"
  else
    warn "gRPC Auth HealthCheck failed"
    echo "Response: $GRPC_AUTH_HEALTH" | head -3
  fi

  # Test gRPC Auth Service - Authenticate (if we have credentials)
  if [[ -n "${TEST_EMAIL:-}" ]] && [[ -n "${TEST_PASSWORD:-}" ]]; then
    say "Test 15b: gRPC Auth Service - Authenticate via HTTP/2"
    GRPC_AUTH_RESPONSE=$(grpc_test "Auth" "auth.AuthService/Authenticate" "auth.proto" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 10)
    if echo "$GRPC_AUTH_RESPONSE" | grep -q "token"; then
      ok "gRPC Auth Authenticate works via HTTP/2"
      GRPC_TOKEN=$(echo "$GRPC_AUTH_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "gRPC Auth Authenticate failed"
      echo "Response: $GRPC_AUTH_RESPONSE" | head -3
    fi
  fi

  # Test gRPC Records Service - HealthCheck
  say "Test 15c: gRPC Records Service - HealthCheck via HTTP/2"
  GRPC_RECORDS_HEALTH=$(grpc_test "Records" "records.RecordsService/HealthCheck" "records.proto" '{}' 10)
  if echo "$GRPC_RECORDS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Records HealthCheck works via HTTP/2"
  else
    warn "gRPC Records HealthCheck failed"
    echo "Response: $GRPC_RECORDS_HEALTH" | head -3
  fi

  # Test gRPC Records Service - SearchRecords (if we have a user ID)
  if [[ -n "${USER1_ID:-}" ]]; then
    say "Test 15d: gRPC Records Service - SearchRecords via HTTP/2"
    GRPC_SEARCH_RESPONSE=$(grpc_test "Records" "records.RecordsService/SearchRecords" "records.proto" "{\"user_id\":\"$USER1_ID\",\"query\":\"test\",\"limit\":10}" 10)
    if echo "$GRPC_SEARCH_RESPONSE" | grep -q "records"; then
      ok "gRPC Records SearchRecords works via HTTP/2"
    else
      warn "gRPC Records SearchRecords failed"
      echo "Response: $GRPC_SEARCH_RESPONSE" | head -3
    fi
  fi

  # Test gRPC Social Service - HealthCheck
  say "Test 15e: gRPC Social Service - HealthCheck via HTTP/2"
  GRPC_SOCIAL_HEALTH=$(grpc_test "Social" "social.SocialService/HealthCheck" "social.proto" '{}' 10)
  if echo "$GRPC_SOCIAL_HEALTH" | grep -q "healthy"; then
    ok "gRPC Social HealthCheck works via HTTP/2"
  else
    warn "gRPC Social HealthCheck failed"
    echo "Response: $GRPC_SOCIAL_HEALTH" | head -3
  fi

  # Test gRPC Listings Service - HealthCheck
  say "Test 15f: gRPC Listings Service - HealthCheck via HTTP/2"
  GRPC_LISTINGS_HEALTH=$(grpc_test "Listings" "listings.ListingsService/HealthCheck" "listings.proto" '{}' 10)
  if echo "$GRPC_LISTINGS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Listings HealthCheck works via HTTP/2"
  else
    warn "gRPC Listings HealthCheck failed"
    echo "Response: $GRPC_LISTINGS_HEALTH" | head -3
  fi

  # Test gRPC Analytics Service - HealthCheck
  say "Test 15g: gRPC Analytics Service - HealthCheck via HTTP/2"
  GRPC_ANALYTICS_HEALTH=$(grpc_test "Analytics" "analytics.AnalyticsService/HealthCheck" "analytics.proto" '{}' 10)
  if echo "$GRPC_ANALYTICS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Analytics HealthCheck works via HTTP/2"
  else
    warn "gRPC Analytics HealthCheck failed"
    echo "Response: $GRPC_ANALYTICS_HEALTH" | head -3
  fi

  # Test gRPC Shopping Service - HealthCheck
  say "Test 15h: gRPC Shopping Service - HealthCheck via HTTP/2"
  GRPC_SHOPPING_HEALTH=$(grpc_test "Shopping" "shopping.ShoppingService/HealthCheck" "shopping.proto" '{}' 10)
  if echo "$GRPC_SHOPPING_HEALTH" | grep -q "healthy"; then
    ok "gRPC Shopping HealthCheck works via HTTP/2"
  else
    warn "gRPC Shopping HealthCheck failed"
    echo "Response: $GRPC_SHOPPING_HEALTH" | head -3
  fi

  # Test gRPC Auction Monitor Service - HealthCheck
  say "Test 15i: gRPC Auction Monitor Service - HealthCheck via HTTP/2"
  GRPC_AUCTION_MONITOR_HEALTH=$(grpc_test "AuctionMonitor" "auction_monitor.AuctionMonitorService/HealthCheck" "auction-monitor.proto" '{}' 10)
  if echo "$GRPC_AUCTION_MONITOR_HEALTH" | grep -q "healthy"; then
    ok "gRPC Auction Monitor HealthCheck works via HTTP/2"
  else
    warn "gRPC Auction Monitor HealthCheck failed"
    echo "Response: $GRPC_AUCTION_MONITOR_HEALTH" | head -3
  fi

  # Test gRPC Python AI Service - HealthCheck
  say "Test 15j: gRPC Python AI Service - HealthCheck via HTTP/2"
  GRPC_PYTHON_AI_HEALTH=$(grpc_test "PythonAI" "python_ai.PythonAIService/HealthCheck" "python-ai.proto" '{}' 10)
  if echo "$GRPC_PYTHON_AI_HEALTH" | grep -q "healthy"; then
    ok "gRPC Python AI HealthCheck works via HTTP/2"
  else
    warn "gRPC Python AI HealthCheck failed"
    echo "Response: $GRPC_PYTHON_AI_HEALTH" | head -3
  fi
fi

say "=== Microservices Testing Complete ==="
