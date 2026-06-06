#!/usr/bin/env bash
# Capture and analyze social service errors
# Pipes results to log file for analysis
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

NS="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"
LOG_DIR="${LOG_DIR:-/tmp/social-service-analysis-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

say "=== Social Service Error Analysis ==="
info "Log directory: $LOG_DIR"

# Get CA certificate for strict TLS
CA_CERT=""
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

K8S_CA_ING=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]]; then
  CA_CERT="/tmp/social-ca-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
fi

strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    curl --cacert "$CA_CERT" "$@"
  else
    curl -k "$@"
  fi
}

# 1. Check social service pod status
say "1. Checking social service pod status..."
SOCIAL_POD=$(_kb -n "$NS" get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$SOCIAL_POD" ]]; then
  ok "Social service pod: $SOCIAL_POD"
  _kb -n "$NS" get pod "$SOCIAL_POD" -o yaml > "$LOG_DIR/pod-status.yaml" 2>&1
  _kb -n "$NS" describe pod "$SOCIAL_POD" > "$LOG_DIR/pod-describe.txt" 2>&1
  _kb -n "$NS" logs "$SOCIAL_POD" --tail=100 > "$LOG_DIR/pod-logs.txt" 2>&1
  ok "Pod status saved to $LOG_DIR/pod-status.yaml"
  ok "Pod logs saved to $LOG_DIR/pod-logs.txt"
else
  warn "No social service pod found"
fi

# 2. Check social service health
say "2. Testing social service health endpoint..."
HEALTH_LOG="$LOG_DIR/health-tests.log"
for i in {1..10}; do
  echo "=== Health check $i ===" >> "$HEALTH_LOG"
  strict_curl -sS -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}\n" \
    --http2 --max-time 5 \
    --resolve "${HOST}:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://${HOST}:${PORT}/api/social/healthz" >> "$HEALTH_LOG" 2>&1 || echo "FAILED" >> "$HEALTH_LOG"
  echo "" >> "$HEALTH_LOG"
  sleep 0.5
done
ok "Health checks saved to $HEALTH_LOG"

# 3. Test social service endpoints that are failing
say "3. Testing social service endpoints..."
ENDPOINT_LOG="$LOG_DIR/endpoint-tests.log"

# Test P2P message endpoint
echo "=== P2P Message Test ===" >> "$ENDPOINT_LOG"
# First get a token
REGISTER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "${HOST}:${PORT}:127.0.0.1" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://${HOST}:${PORT}/api/auth/register" \
  -d '{"email":"test-social-'$(date +%s)'@example.com","password":"test123"}' 2>&1)
TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ -n "$TOKEN" ]]; then
  echo "Token obtained: ${TOKEN:0:20}..." >> "$ENDPOINT_LOG"
  
  # Test send message
  MESSAGE_RESPONSE=$(strict_curl -sS -w "\nHTTP_CODE:%{http_code}\n" --http2 --max-time 10 \
    --resolve "${HOST}:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -X POST "https://${HOST}:${PORT}/api/social/messages" \
    -d '{"recipient_id":"00000000-0000-0000-0000-000000000001","message_type":"direct","subject":"Test","content":"Test message"}' 2>&1)
  echo "$MESSAGE_RESPONSE" >> "$ENDPOINT_LOG"
else
  echo "Failed to get token" >> "$ENDPOINT_LOG"
fi

# 4. Check database connectivity from social service pod
say "4. Checking database connectivity from social service pod..."
if [[ -n "$SOCIAL_POD" ]]; then
  DB_LOG="$LOG_DIR/db-connectivity.log"
  _kb -n "$NS" exec "$SOCIAL_POD" -- sh -c "
    echo '=== Database URL ===' > /tmp/db-check.log
    echo \$POSTGRES_URL_SOCIAL >> /tmp/db-check.log
    echo '' >> /tmp/db-check.log
    echo '=== Testing connection ===' >> /tmp/db-check.log
    timeout 5 psql \$POSTGRES_URL_SOCIAL -c 'SELECT 1;' >> /tmp/db-check.log 2>&1 || echo 'Connection failed' >> /tmp/db-check.log
    cat /tmp/db-check.log
  " > "$DB_LOG" 2>&1 || warn "DB connectivity check failed"
  ok "DB connectivity check saved to $DB_LOG"
fi

# 5. Check Redis connectivity
say "5. Checking Redis connectivity..."
REDIS_LOG="$LOG_DIR/redis-connectivity.log"
if [[ -n "$SOCIAL_POD" ]]; then
  _kb -n "$NS" exec "$SOCIAL_POD" -- sh -c "
    if command -v redis-cli >/dev/null 2>&1; then
      echo '=== Redis URL ===' > /tmp/redis-check.log
      echo \$REDIS_URL >> /tmp/redis-check.log
      echo '' >> /tmp/redis-check.log
      echo '=== Testing connection ===' >> /tmp/redis-check.log
      timeout 5 redis-cli -u \$REDIS_URL ping >> /tmp/redis-check.log 2>&1 || echo 'Connection failed' >> /tmp/redis-check.log
      cat /tmp/redis-check.log
    else
      echo 'redis-cli not available in pod'
    fi
  " > "$REDIS_LOG" 2>&1 || warn "Redis connectivity check failed"
  ok "Redis connectivity check saved to $REDIS_LOG"
fi

# 6. Check API Gateway proxy configuration
say "6. Checking API Gateway configuration..."
GATEWAY_LOG="$LOG_DIR/gateway-config.log"
GATEWAY_POD=$(_kb -n "$NS" get pods -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$GATEWAY_POD" ]]; then
  _kb -n "$NS" logs "$GATEWAY_POD" --tail=50 | grep -i "social" > "$GATEWAY_LOG" 2>&1 || true
  ok "API Gateway logs saved to $GATEWAY_LOG"
fi

# 7. Check for 502 errors in logs
say "7. Analyzing error patterns..."
ERROR_LOG="$LOG_DIR/error-analysis.txt"
{
  echo "=== Social Service Pod Errors ==="
  if [[ -f "$LOG_DIR/pod-logs.txt" ]]; then
    grep -i "error\|fail\|502\|timeout" "$LOG_DIR/pod-logs.txt" | tail -20
  fi
  echo ""
  echo "=== API Gateway Errors ==="
  if [[ -f "$GATEWAY_LOG" ]]; then
    grep -i "social.*error\|502\|upstream" "$GATEWAY_LOG" | tail -20
  fi
  echo ""
  echo "=== Health Check Failures ==="
  if [[ -f "$HEALTH_LOG" ]]; then
    grep -i "fail\|502\|timeout" "$HEALTH_LOG" | tail -10
  fi
} > "$ERROR_LOG"
ok "Error analysis saved to $ERROR_LOG"

# 8. Summary
say "=== Analysis Complete ==="
ok "All logs saved to: $LOG_DIR"
info "Key files:"
info "  - Pod status: $LOG_DIR/pod-status.yaml"
info "  - Pod logs: $LOG_DIR/pod-logs.txt"
info "  - Health tests: $HEALTH_LOG"
info "  - Endpoint tests: $ENDPOINT_LOG"
info "  - Error analysis: $ERROR_LOG"
info "  - DB connectivity: $DB_LOG"
info "  - Redis connectivity: $REDIS_LOG"

# Display error summary
if [[ -f "$ERROR_LOG" ]] && [[ -s "$ERROR_LOG" ]]; then
  say "=== Error Summary ==="
  cat "$ERROR_LOG"
fi

exit 0
