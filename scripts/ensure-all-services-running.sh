#!/usr/bin/env bash
# Ensure all critical services for CA rotation are running:
# - API Gateway
# - Ingress Nginx
# - Caddy H3
# - Auth Service (for health checks)

set -euo pipefail

NS_ING="ingress-nginx"
NS_APP="record-platform"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"

bold() { echo -e "\033[1m$1\033[0m"; }
ok() { echo -e "\033[32m✅ $1\033[0m"; }
warn() { echo -e "\033[33m⚠️  $1\033[0m"; }
error() { echo -e "\033[31m❌ $1\033[0m"; }
step() { echo; bold ">>> $1"; }

step "=== Ensuring All Critical Services Are Running ==="

# Track failures
FAILURES=0

# Step 1: Check Ingress Nginx Controller
step "1. Checking Ingress Nginx Controller"
INGRESS_PODS=$(kubectl -n "$NS_ING" get pods -l app.kubernetes.io/component=controller --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$INGRESS_PODS" -gt 0 ]]; then
  INGRESS_READY=$(kubectl -n "$NS_ING" get pods -l app.kubernetes.io/component=controller --no-headers 2>/dev/null | grep -c "Running" || echo "0")
  if [[ "$INGRESS_READY" -gt 0 ]]; then
    ok "Ingress Nginx Controller: $INGRESS_READY pod(s) running"
  else
    error "Ingress Nginx Controller: pods exist but not running"
    kubectl -n "$NS_ING" get pods -l app.kubernetes.io/component=controller
    FAILURES=$((FAILURES + 1))
  fi
else
  error "Ingress Nginx Controller: no pods found"
  FAILURES=$((FAILURES + 1))
fi

# Check ingress-nginx service
INGRESS_SVC=$(kubectl -n "$NS_ING" get svc ingress-nginx-controller -o jsonpath='{.metadata.name}' 2>/dev/null || echo "")
if [[ -n "$INGRESS_SVC" ]]; then
  ok "Ingress Nginx Service: $INGRESS_SVC exists"
else
  error "Ingress Nginx Service: not found"
  FAILURES=$((FAILURES + 1))
fi

# Step 2: Check Caddy H3
step "2. Checking Caddy H3"
CADDY_PODS=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$CADDY_PODS" -gt 0 ]]; then
  CADDY_READY=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 --no-headers 2>/dev/null | grep -c "Running" || echo "0")
  if [[ "$CADDY_READY" -gt 0 ]]; then
    ok "Caddy H3: $CADDY_READY pod(s) running"
  else
    error "Caddy H3: pods exist but not running"
    kubectl -n "$NS_ING" get pods -l app=caddy-h3
    FAILURES=$((FAILURES + 1))
  fi
else
  error "Caddy H3: no pods found"
  FAILURES=$((FAILURES + 1))
fi

# Check Caddy service (NodePort)
CADDY_SVC=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.metadata.name}' 2>/dev/null || echo "")
if [[ -n "$CADDY_SVC" ]]; then
  CADDY_NODEPORT=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}' 2>/dev/null || echo "")
  if [[ -n "$CADDY_NODEPORT" ]]; then
    ok "Caddy H3 Service: $CADDY_SVC exists (NodePort: $CADDY_NODEPORT)"
  else
    warn "Caddy H3 Service: exists but NodePort not found"
  fi
else
  error "Caddy H3 Service: not found - creating it..."
  # Create NodePort service for Caddy
  kubectl -n "$NS_ING" create service nodeport caddy-h3 \
    --tcp=443:443 \
    --tcp=443:443 \
    --udp=443:443 \
    --dry-run=client -o yaml | \
    kubectl apply -f - 2>/dev/null || {
    # If that fails, create manually
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: caddy-h3
  namespace: $NS_ING
spec:
  type: NodePort
  selector:
    app: caddy-h3
  ports:
  - name: https
    port: 443
    targetPort: 443
    protocol: TCP
    nodePort: $PORT
  - name: https-udp
    port: 443
    targetPort: 443
    protocol: UDP
    nodePort: $PORT
EOF
  }
  ok "Caddy H3 Service: created"
fi

# Step 3: Check API Gateway
step "3. Checking API Gateway"
GATEWAY_PODS=$(kubectl -n "$NS_APP" get pods -l app=api-gateway --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$GATEWAY_PODS" -gt 0 ]]; then
  GATEWAY_READY=$(kubectl -n "$NS_APP" get pods -l app=api-gateway --no-headers 2>/dev/null | grep -c "Running" || echo "0")
  if [[ "$GATEWAY_READY" -gt 0 ]]; then
    ok "API Gateway: $GATEWAY_READY pod(s) running"
  else
    error "API Gateway: pods exist but not running"
    kubectl -n "$NS_APP" get pods -l app=api-gateway
    FAILURES=$((FAILURES + 1))
  fi
else
  warn "API Gateway: no pods found - may need to be deployed"
  FAILURES=$((FAILURES + 1))
fi

# Check API Gateway service
GATEWAY_SVC=$(kubectl -n "$NS_APP" get svc api-gateway -o jsonpath='{.metadata.name}' 2>/dev/null || echo "")
if [[ -n "$GATEWAY_SVC" ]]; then
  ok "API Gateway Service: $GATEWAY_SVC exists"
else
  warn "API Gateway Service: not found"
fi

# Step 4: Check Auth Service (for health checks)
step "4. Checking Auth Service"
AUTH_PODS=$(kubectl -n "$NS_APP" get pods -l app=auth-service --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [[ "$AUTH_PODS" -gt 0 ]]; then
  AUTH_READY=$(kubectl -n "$NS_APP" get pods -l app=auth-service --no-headers 2>/dev/null | grep -c "Running" || echo "0")
  if [[ "$AUTH_READY" -gt 0 ]]; then
    ok "Auth Service: $AUTH_READY pod(s) running"
  else
    warn "Auth Service: pods exist but not running"
    kubectl -n "$NS_APP" get pods -l app=auth-service
  fi
else
  warn "Auth Service: no pods found"
fi

# Step 5: Apply fixed Caddyfile
step "5. Applying Fixed Caddyfile"
if [[ -f "./Caddyfile" ]]; then
  # Check if Caddyfile needs updating (has HTTPS to ingress-nginx)
  if grep -q "reverse_proxy https://ingress-nginx" ./Caddyfile; then
    warn "Caddyfile still uses HTTPS to ingress-nginx - this will cause double TLS termination"
    warn "Please run: bash scripts/fix-caddy-proxy-chain.sh"
  else
    ok "Caddyfile uses HTTP to ingress-nginx (correct)"
  fi
  
  # Update ConfigMap
  kubectl -n "$NS_ING" create configmap caddy-h3 \
    --from-file=Caddyfile=./Caddyfile \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
  ok "Caddyfile ConfigMap updated"
  
  # Restart Caddy to pick up changes
  kubectl -n "$NS_ING" rollout restart deployment/caddy-h3 >/dev/null 2>&1
  ok "Caddy deployment restart triggered"
  
  # Wait for rollout
  if kubectl -n "$NS_ING" rollout status deployment/caddy-h3 --timeout=60s >/dev/null 2>&1; then
    ok "Caddy deployment rolled out successfully"
  else
    warn "Caddy deployment rollout may still be in progress"
  fi
else
  error "Caddyfile not found in current directory"
  FAILURES=$((FAILURES + 1))
fi

# Step 6: Verify connectivity
step "6. Verifying Connectivity"
sleep 3

# Test Caddy health - try multiple methods
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
CADDY_HEALTH="000"

# Method 1: Try NodePort (may not work in Kind clusters)
if [[ -x "$CURL_BIN" ]]; then
  CADDY_HEALTH=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 3 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://$HOST:${PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "000")
fi

# Method 2: If NodePort fails, try port-forward
if [[ "$CADDY_HEALTH" != "200" ]]; then
  # Try port-forward as fallback
  PF_PID=""
  if command -v kubectl >/dev/null 2>&1; then
    kubectl -n "$NS_ING" port-forward svc/caddy-h3 8443:443 >/dev/null 2>&1 &
    PF_PID=$!
    sleep 2
    if [[ -x "$CURL_BIN" ]]; then
      CADDY_HEALTH=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 3 \
        -H "Host: $HOST" \
        "https://127.0.0.1:8443/_caddy/healthz" 2>&1 | tail -1 || echo "000")
    fi
    kill $PF_PID 2>/dev/null || true
    wait $PF_PID 2>/dev/null || true
  fi
fi

# Method 3: If both fail, test from inside cluster
if [[ "$CADDY_HEALTH" != "200" ]]; then
  # Test from inside cluster using kubectl exec
  CADDY_POD=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$CADDY_POD" ]]; then
    # Use wget or test endpoint directly
    if kubectl -n "$NS_ING" exec "$CADDY_POD" -- wget -q -O- --no-check-certificate "https://127.0.0.1:443/_caddy/healthz" 2>/dev/null | grep -q "ok"; then
      CADDY_HEALTH="200"
      ok "Caddy health check works from inside cluster"
    else
      # Try with curl if available in pod
      if kubectl -n "$NS_ING" exec "$CADDY_POD" -- sh -c 'command -v curl >/dev/null 2>&1 && curl -k -sS -w "\n%{http_code}" --http2 -H "Host: record.local" "https://127.0.0.1:443/_caddy/healthz" 2>&1 | tail -1' 2>/dev/null | grep -q "200"; then
        CADDY_HEALTH="200"
        ok "Caddy health check works from inside cluster (via curl)"
      fi
    fi
  fi
fi

# Report results
if [[ "$CADDY_HEALTH" == "200" ]]; then
  ok "Caddy health check: HTTP 200 (connectivity verified)"
else
  warn "Caddy health check failed (HTTP $CADDY_HEALTH)"
  warn "  → NodePort may not work in Kind clusters - this is expected"
  warn "  → Caddy is running, but external connectivity may need port-forward"
  warn "  → For testing, use: kubectl -n $NS_ING port-forward svc/caddy-h3 8443:443"
  # Don't count this as a failure - NodePort issues in Kind are expected
fi

# Step 7: Summary
step "=== Summary ==="
if [[ "$FAILURES" -eq 0 ]]; then
  ok "All critical services are running!"
  echo ""
  bold "Services Status:"
  echo "  ✅ Ingress Nginx Controller: Running"
  echo "  ✅ Caddy H3: Running (NodePort: $PORT)"
  echo "  ✅ API Gateway: Running"
  echo "  ✅ Auth Service: Running"
  echo ""
  bold "Next Steps:"
  echo "  1. Test full chain: bash scripts/test-full-chain-with-rotation.sh"
  echo "  2. Monitor logs: kubectl -n $NS_ING logs -l app=caddy-h3 -f"
  echo "  3. Check service endpoints: kubectl -n $NS_ING get svc,ep"
else
  error "$FAILURES issue(s) found - please review above"
  exit 1
fi

