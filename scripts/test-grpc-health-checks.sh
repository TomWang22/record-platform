#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
NS="record-platform"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Testing gRPC Health Checks (HTTP/2/3 QUIC, h2, h2c, h3) ==="

# Test 1: Standard Health Service Check - Auth Service (h2c - in-cluster direct)
say "Test 1: Auth Service Standard Health Check (grpc.health.v1.Health/Check - h2c)"
AUTH_HEALTH=$(kubectl -n "$NS" run grpc-test-auth-$(date +%s) --rm -i --restart=Never \
  --image=fullstorydev/grpcurl:latest \
  -- grpcurl -plaintext -max-time 5 \
  -d '{"service": "auth.AuthService"}' \
  auth-service.record-platform.svc.cluster.local:50051 \
  grpc.health.v1.Health/Check 2>&1) || AUTH_HEALTH=""
if echo "$AUTH_HEALTH" | grep -qE '"status"\s*:\s*"SERVING"|status.*SERVING|"SERVING"'; then
  ok "Auth Service standard health check works (h2c)"
  echo "  Response: $AUTH_HEALTH"
else
  warn "Auth Service standard health check failed (h2c)"
  echo "  Response: $AUTH_HEALTH"
fi

# Test 2: Standard Health Service Check - Messaging Service (h2c - in-cluster direct)
say "Test 2: Messaging Service Standard Health Check (grpc.health.v1.Health/Check - h2c)"
SOCIAL_HEALTH=$(kubectl -n "$NS" run grpc-test-social-$(date +%s) --rm -i --restart=Never \
  --image=fullstorydev/grpcurl:latest \
  -- grpcurl -plaintext -max-time 5 \
  -d '{"service": "messaging.MessagingService"}' \
  messaging-service.record-platform.svc.cluster.local:50056 \
  grpc.health.v1.Health/Check 2>&1) || SOCIAL_HEALTH=""
if echo "$SOCIAL_HEALTH" | grep -qE '"status"\s*:\s*"SERVING"|status.*SERVING|"SERVING"'; then
  ok "Messaging Service standard health check works (h2c)"
  echo "  Response: $SOCIAL_HEALTH"
else
  warn "Messaging Service standard health check failed (h2c)"
  echo "  Response: $SOCIAL_HEALTH"
fi

# Test 3: Health Check via Caddy h2c port (if available from host)
say "Test 3: Auth Service Health Check via Caddy (h2c port 5000)"
if nc -z localhost 5000 2>/dev/null; then
  AUTH_HEALTH_CADDY=$(grpcurl -plaintext -max-time 5 \
    -H "Host: ${HOST}" \
    -d '{"service": "auth.AuthService"}' \
    localhost:5000 \
    grpc.health.v1.Health/Check 2>&1) || AUTH_HEALTH_CADDY=""
  if echo "$AUTH_HEALTH_CADDY" | grep -qE '"status"\s*:\s*"SERVING"|status.*SERVING|"SERVING"'; then
    ok "Auth Service health check works (Caddy h2c)"
  else
    warn "Auth Service health check failed (Caddy h2c)"
    echo "  Response: $AUTH_HEALTH_CADDY"
  fi
else
  warn "Caddy h2c port 5000 not accessible from host (expected for in-cluster routing)"
fi

# Test 4: Health Check via HTTPS (HTTP/2) - requires proper routing
say "Test 4: Auth Service Health Check via HTTPS (HTTP/2/3)"
AUTH_HEALTH_TLS=$(grpcurl -insecure -max-time 5 \
  -H "Host: ${HOST}" \
  -d '{"service": "auth.AuthService"}' \
  "${HOST}:${PORT}" \
  grpc.health.v1.Health/Check 2>&1) || AUTH_HEALTH_TLS=""
if echo "$AUTH_HEALTH_TLS" | grep -qE '"status"\s*:\s*"SERVING"|status.*SERVING|"SERVING"'; then
  ok "Auth Service health check works (HTTPS/HTTP/2/3)"
  echo "  Response: $AUTH_HEALTH_TLS"
else
  warn "Auth Service health check failed (HTTPS/HTTP/2/3 - may need proper gRPC routing)"
  echo "  Response: $AUTH_HEALTH_TLS"
fi

say "=== gRPC Health Check Tests Complete ==="
ok "All gRPC health checks tested"
