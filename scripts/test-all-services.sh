#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
NS_ING="${NS_ING:-ingress-nginx}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Testing All Services Readiness ==="

# Test 1: Check all pods are running
say "Test 1: Checking pod status"
PODS_NOT_READY=$(kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l | tr -d '[:space:]' || echo "0")
if [[ "$PODS_NOT_READY" == "0" ]]; then
  ok "All pods are running"
else
  warn "$PODS_NOT_READY pod(s) not ready"
  kubectl -n "$NS" get pods | grep -v "Running\|Completed" || true
fi

# Test 2: Check service endpoints
say "Test 2: Checking service endpoints"
SERVICES=(
  "api-gateway:4000"
  "auth-service:4001"
  "records-service:4002"
  "listings-service:4003"
  "analytics-service:4004"
  "messaging-service:4006"
  "shopping-service:4007"
  "auction-monitor:4008"
  "python-ai-service:5005"
  "webapp:3001"
)

ALL_ENDPOINTS_OK=true
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  ENDPOINTS=$(kubectl -n "$NS" get endpoints "$svc" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
  if [[ -n "$ENDPOINTS" ]]; then
    ok "$svc has endpoints"
  else
    warn "$svc has NO endpoints (service may not be ready)"
    ALL_ENDPOINTS_OK=false
  fi
done

# Test 3: Health check endpoints
say "Test 3: Testing health check endpoints"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"

# Test Caddy
say "Testing Caddy health..."
CADDY_HEALTH=$(kubectl -n "$NS_ING" run curl-test-caddy --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
  curl -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz" 2>/dev/null || echo "")
CADDY_CODE=$(echo "$CADDY_HEALTH" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$CADDY_CODE" == "200" ]]; then
  ok "Caddy health check: HTTP $CADDY_CODE"
else
  warn "Caddy health check: HTTP $CADDY_CODE"
fi

# Test API Gateway
say "Testing API Gateway health..."
API_GW_HEALTH=$(kubectl -n "$NS" run curl-test-gw --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
  curl -sS -w "\n%{http_code}" "http://api-gateway.record-platform.svc.cluster.local:4000/api/healthz" 2>/dev/null || echo "")
API_GW_CODE=$(echo "$API_GW_HEALTH" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$API_GW_CODE" == "200" ]]; then
  ok "API Gateway health check: HTTP $API_GW_CODE"
else
  warn "API Gateway health check: HTTP $API_GW_CODE"
fi

# Test each service health endpoint
say "Testing service health endpoints..."
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  
  # Skip webapp (no /healthz endpoint)
  if [[ "$svc" == "webapp" ]]; then
    continue
  fi
  
  HEALTH=$(kubectl -n "$NS" run "curl-test-${svc}" --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
    curl -sS -w "\n%{http_code}" "http://${svc}.record-platform.svc.cluster.local:${port}/healthz" 2>/dev/null || echo "")
  HTTP_CODE=$(echo "$HEALTH" | tail -1 | tr -d '[:space:]' || echo "000")
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "$svc health check: HTTP $HTTP_CODE"
  elif [[ "$HTTP_CODE" == "503" ]]; then
    warn "$svc health check: HTTP $HTTP_CODE (service degraded or DB connection issue)"
  else
    warn "$svc health check: HTTP $HTTP_CODE"
  fi
done

# Test 4: Webapp accessibility
say "Test 4: Testing webapp accessibility"
WEBAPP_HEALTH=$(kubectl -n "$NS" run curl-test-webapp --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
  curl -sS -w "\n%{http_code}" "http://webapp.record-platform.svc.cluster.local:3001/" 2>/dev/null || echo "")
WEBAPP_CODE=$(echo "$WEBAPP_HEALTH" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$WEBAPP_CODE" =~ ^[23] ]]; then
  ok "Webapp accessible: HTTP $WEBAPP_CODE"
else
  warn "Webapp accessible: HTTP $WEBAPP_CODE"
fi

# Test 5: Nginx service (port 8080)
say "Test 5: Testing nginx service (port 8080)"
NGINX_HEALTH=$(kubectl -n "$NS" run curl-test-nginx --rm -i --restart=Never --image=curlimages/curl --timeout=10s --quiet -- \
  curl -sS -w "\n%{http_code}" "http://nginx.record-platform.svc.cluster.local:8080/healthz" 2>/dev/null || echo "")
NGINX_CODE=$(echo "$NGINX_HEALTH" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$NGINX_CODE" == "200" ]]; then
  ok "Nginx health check: HTTP $NGINX_CODE"
else
  warn "Nginx health check: HTTP $NGINX_CODE"
fi

# Test 6: Check for CrashLoopBackOff pods
say "Test 6: Checking for CrashLoopBackOff pods"
CRASHING_PODS=$(kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -c "CrashLoopBackOff" || echo "0")
if [[ "$CRASHING_PODS" == "0" ]]; then
  ok "No CrashLoopBackOff pods"
else
  warn "$CRASHING_PODS pod(s) in CrashLoopBackOff:"
  kubectl -n "$NS" get pods | grep "CrashLoopBackOff" || true
fi

# Test 7: Database connectivity (from ConfigMap)
say "Test 7: Verifying database configuration"
if kubectl -n "$NS" get configmap app-config >/dev/null 2>&1; then
  DB_COUNT=$(kubectl -n "$NS" get configmap app-config -o jsonpath='{.data}' 2>/dev/null | grep -o "POSTGRES_URL" | wc -l | tr -d '[:space:]' || echo "0")
  ok "Database configuration found ($DB_COUNT POSTGRES_URL entries)"
else
  warn "app-config ConfigMap not found"
fi

# Test 8: Kafka connectivity
say "Test 8: Testing Kafka service"
if kubectl -n "$NS" get svc kafka-external >/dev/null 2>&1; then
  KAFKA_ENDPOINTS=$(kubectl -n "$NS" get endpoints kafka-external -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
  if [[ -n "$KAFKA_ENDPOINTS" ]]; then
    ok "Kafka service has endpoints"
  else
    warn "Kafka service has NO endpoints"
  fi
else
  warn "Kafka service not found"
fi

say "=== Test Summary ==="
if [[ "$ALL_ENDPOINTS_OK" == "true" ]] && [[ "$CRASHING_PODS" == "0" ]]; then
  ok "All services appear to be ready!"
else
  warn "Some services may need attention"
fi

say "=== Next Steps ==="
echo "1. Run k6 load tests: ./scripts/load/all-in-one-k6.js"
echo "2. Test full chain: ./scripts/test-full-chain-with-rotation.sh"
echo "3. Check specific service logs: kubectl -n $NS logs -l app=<service-name>"
echo "4. Port-forward webapp: kubectl -n $NS port-forward svc/webapp 3001:3001"
echo "5. Port-forward nginx: kubectl -n $NS port-forward svc/nginx 8080:8080"

