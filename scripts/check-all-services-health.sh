#!/usr/bin/env bash
# Comprehensive health check for all services (gRPC, HTTP/2, HTTP/3)
# This script should be run BEFORE e2e tests to ensure all services are healthy

set -euo pipefail

NS="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

say() { printf "\n${GREEN}=== %s ===${NC}\n" "$*"; }
ok() { printf "${GREEN}✅ %s${NC}\n" "$*"; }
warn() { printf "${YELLOW}⚠️  %s${NC}\n" "$*"; }
fail() { printf "${RED}❌ %s${NC}\n" "$*"; }

# Track results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
ERROR_TYPES=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

PROTO_DIR="${SCRIPT_DIR}/../proto"

say "Comprehensive Service Health Check"
echo "Host: $HOST"
echo "Port: $PORT"
echo "Namespace: $NS"
echo ""

# Helper: Check gRPC health using health.proto
check_grpc_health() {
  local service_name="$1"
  local service_address="$2"
  local service_port="${3:-50051}"
  local full_address="${service_address}:${service_port}"
  
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  
  if ! command -v grpcurl >/dev/null 2>&1; then
    warn "grpcurl not installed - skipping gRPC health check for $service_name"
    return 1
  fi
  
  # Try to check health using standard gRPC health checking protocol
  local result
  result=$(grpcurl -insecure \
    -import-path "$PROTO_DIR" \
    -proto "health.proto" \
    -d '{"service": ""}' \
    -max-time 5 \
    "$full_address" \
    grpc.health.v1.Health/Check 2>&1) || true
  
  if echo "$result" | grep -q "status.*SERVING"; then
    ok "gRPC Health: $service_name ($full_address) - SERVING"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  elif echo "$result" | grep -q "status.*NOT_SERVING"; then
    fail "gRPC Health: $service_name ($full_address) - NOT_SERVING"
    ERROR_TYPES+=("gRPC_NOT_SERVING:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  elif echo "$result" | grep -qE "(connection refused|dial.*failed|context deadline|timeout)"; then
    fail "gRPC Health: $service_name ($full_address) - Connection failed"
    ERROR_TYPES+=("gRPC_CONNECTION_FAILED:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    echo "  Error: $result" | head -3
    return 1
  else
    warn "gRPC Health: $service_name ($full_address) - Unknown status"
    echo "  Response: $result" | head -3
    ERROR_TYPES+=("gRPC_UNKNOWN:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Helper: Check HTTP health endpoint
check_http_health() {
  local service_name="$1"
  local endpoint="$2"
  local expected_status="${3:-200}"
  
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  
  local response
  response=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}${endpoint}" 2>&1) || {
    fail "HTTP Health: $service_name ($endpoint) - Request failed"
    ERROR_TYPES+=("HTTP_REQUEST_FAILED:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  }
  
  local code
  code=$(echo "$response" | tail -1)
  if [[ "$code" == "$expected_status" ]]; then
    ok "HTTP Health: $service_name ($endpoint) - HTTP $code"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  else
    fail "HTTP Health: $service_name ($endpoint) - HTTP $code (expected $expected_status)"
    ERROR_TYPES+=("HTTP_WRONG_STATUS:$service_name:$code")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Helper: Check HTTP/3 health
check_http3_health() {
  local service_name="$1"
  local endpoint="$2"
  local expected_status="${3:-200}"
  
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  
  HTTP3_SVC_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [[ -n "$HTTP3_SVC_IP" ]]; then
    HTTP3_RESOLVE="${HOST}:443:${HTTP3_SVC_IP}"
  else
    HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
  fi
  
  local response
  response=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 10 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST${endpoint}" 2>&1) || {
    warn "HTTP/3 Health: $service_name ($endpoint) - Request failed (HTTP/3 may not be available)"
    ERROR_TYPES+=("HTTP3_REQUEST_FAILED:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  }
  
  local code
  code=$(echo "$response" | tail -1)
  if [[ "$code" == "$expected_status" ]]; then
    ok "HTTP/3 Health: $service_name ($endpoint) - HTTP $code"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  else
    warn "HTTP/3 Health: $service_name ($endpoint) - HTTP $code (expected $expected_status)"
    ERROR_TYPES+=("HTTP3_WRONG_STATUS:$service_name:$code")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Helper: Check service pod status
check_pod_status() {
  local service_name="$1"
  
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  
  local status
  status=$(kubectl -n "$NS" get pods -l app="$service_name" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "NOT_FOUND")
  
  if [[ "$status" == "Running" ]]; then
    ok "Pod Status: $service_name - Running"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  elif [[ "$status" == "NOT_FOUND" ]]; then
    fail "Pod Status: $service_name - Not found"
    ERROR_TYPES+=("POD_NOT_FOUND:$service_name")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  else
    fail "Pod Status: $service_name - $status"
    ERROR_TYPES+=("POD_NOT_RUNNING:$service_name:$status")
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Check all services
say "1. Checking Pod Status"
check_pod_status "auth-service"
check_pod_status "records-service"
check_pod_status "social-service"
check_pod_status "listings-service"
check_pod_status "shopping-service"
check_pod_status "analytics-service"
check_pod_status "python-ai-service"
check_pod_status "api-gateway"

say "2. Checking HTTP Health Endpoints"
check_http_health "API Gateway" "/api/healthz" "200"
check_http_health "Auth Service" "/api/auth/healthz" "200"
check_http_health "Records Service" "/api/records/healthz" "200"
check_http_health "Social Service" "/api/social/healthz" "200"
check_http_health "Listings Service" "/api/listings/healthz" "200"
check_http_health "Shopping Service" "/api/shopping/healthz" "200"
check_http_health "Analytics Service" "/api/analytics/healthz" "200"
check_http_health "Python AI Service" "/api/ai/healthz" "200"

say "3. Checking gRPC Health (using health.proto)"
# Get service IPs from Kubernetes
AUTH_SVC_IP=$(kubectl -n "$NS" get svc auth-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
RECORDS_SVC_IP=$(kubectl -n "$NS" get svc records-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
SOCIAL_SVC_IP=$(kubectl -n "$NS" get svc social-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
LISTINGS_SVC_IP=$(kubectl -n "$NS" get svc listings-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
SHOPPING_SVC_IP=$(kubectl -n "$NS" get svc shopping-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
ANALYTICS_SVC_IP=$(kubectl -n "$NS" get svc analytics-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
PYTHON_AI_SVC_IP=$(kubectl -n "$NS" get svc python-ai-service -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")

if [[ -n "$AUTH_SVC_IP" ]]; then
  check_grpc_health "Auth Service" "$AUTH_SVC_IP" "50051"
fi
if [[ -n "$RECORDS_SVC_IP" ]]; then
  check_grpc_health "Records Service" "$RECORDS_SVC_IP" "50051"
fi
if [[ -n "$SOCIAL_SVC_IP" ]]; then
  check_grpc_health "Social Service" "$SOCIAL_SVC_IP" "50056"
fi
if [[ -n "$LISTINGS_SVC_IP" ]]; then
  check_grpc_health "Listings Service" "$LISTINGS_SVC_IP" "50057"
fi
if [[ -n "$SHOPPING_SVC_IP" ]]; then
  check_grpc_health "Shopping Service" "$SHOPPING_SVC_IP" "50058"
fi
if [[ -n "$ANALYTICS_SVC_IP" ]]; then
  check_grpc_health "Analytics Service" "$ANALYTICS_SVC_IP" "50052"
fi
if [[ -n "$PYTHON_AI_SVC_IP" ]]; then
  check_grpc_health "Python AI Service" "$PYTHON_AI_SVC_IP" "50060"
fi

say "4. Checking HTTP/3 Health"
check_http3_health "Caddy" "/_caddy/healthz" "200"
check_http3_health "API Gateway" "/api/healthz" "200"

say "5. Checking Python AI Service Endpoints"
# Check if Python AI endpoints exist
check_http_health "Python AI - Selling Advice" "/api/ai/selling-advice" "400"  # 400 is OK (missing body)
check_http_health "Python AI - Buying Advice" "/api/ai/buying-advice" "400"
check_http_health "Python AI - Negotiation Advice" "/api/ai/negotiation-advice" "400"
check_http_health "Python AI - Bidding Advice" "/api/ai/bidding-advice" "400"

# Summary
say "Health Check Summary"
echo "Total Checks: $TOTAL_CHECKS"
echo "Passed: $PASSED_CHECKS"
echo "Failed: $FAILED_CHECKS"
echo ""

if [[ $FAILED_CHECKS -eq 0 ]]; then
  ok "All health checks passed! Services are ready for e2e testing."
  exit 0
else
  fail "Some health checks failed. Do not run e2e tests until issues are resolved."
  echo ""
  say "Error Type Breakdown:"
  printf '%s\n' "${ERROR_TYPES[@]}" | sort | uniq -c | sort -rn
  echo ""
  exit 1
fi

