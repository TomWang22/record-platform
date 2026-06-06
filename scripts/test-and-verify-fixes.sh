#!/usr/bin/env bash
# Test suite runner with comprehensive verification and documentation
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1 || true
if kind get clusters 2>/dev/null | grep -qx 'h3'; then
  kind get kubeconfig --name h3 > /tmp/kind-h3-kubeconfig.yaml 2>/dev/null && export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
elif [[ -s /tmp/kind-h3-kubeconfig.yaml ]]; then
  export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG_FILE="/tmp/test-verification-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== TEST SUITE VERIFICATION AND FIXES ==="
echo "Log file: $LOG_FILE"
echo ""

# Step 1: Pre-flight checks
say "Step 1: Pre-flight checks..."

# Check Colima
if colima status >/dev/null 2>&1; then
  ok "Colima is running"
else
  fail "Colima is not running"
  exit 1
fi

# Check Kubernetes cluster
if kubectl get nodes >/dev/null 2>&1; then
  ok "Kubernetes cluster is reachable"
else
  fail "Kubernetes cluster is not reachable"
  exit 1
fi

# Check HTTP/3 CA cert
if [[ -f "/tmp/http3-ca.pem" ]]; then
  ok "HTTP/3 CA cert exists: /tmp/http3-ca.pem"
else
  warn "HTTP/3 CA cert not found, extracting from Kubernetes..."
  K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]]; then
    echo "$K8S_CA" > /tmp/http3-ca.pem
    ok "Extracted HTTP/3 CA cert from Kubernetes secret"
  else
    warn "Could not extract CA cert - HTTP/3 tests may fail"
  fi
fi
echo ""

# Step 2: Check service status
say "Step 2: Checking service pod status..."
SERVICES=(
  "auth-service"
  "records-service"
  "listings-service"
  "social-service"
  "shopping-service"
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
)

READY_COUNT=0
TOTAL_COUNT=${#SERVICES[@]}

for service in "${SERVICES[@]}"; do
  ready=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
  status=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "Unknown")
  
  if [[ "$ready" == "true" ]]; then
    ok "$service: Ready ($status)"
    READY_COUNT=$((READY_COUNT + 1))
  else
    warn "$service: Not Ready ($status)"
    # Show recent logs for failed services
    pod=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$pod" ]]; then
      echo "  Recent logs:"
      kubectl logs -n record-platform "$pod" --tail=10 2>&1 | sed 's/^/    /' || true
    fi
  fi
done

echo ""
if [[ $READY_COUNT -eq $TOTAL_COUNT ]]; then
  ok "All $TOTAL_COUNT services are Ready"
else
  warn "Only $READY_COUNT/$TOTAL_COUNT services are Ready"
fi
echo ""

# Step 3: Verify client cert verification is enabled
say "Step 3: Verifying strict TLS configuration..."
for service in "${SERVICES[@]}"; do
  pod=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]]; then
    # Check if GRPC_REQUIRE_CLIENT_CERT is set to true
    env_val=$(kubectl exec -n record-platform "$pod" -- env 2>/dev/null | grep "GRPC_REQUIRE_CLIENT_CERT" || echo "")
    if echo "$env_val" | grep -q "true"; then
      ok "$service: GRPC_REQUIRE_CLIENT_CERT=true"
    else
      warn "$service: GRPC_REQUIRE_CLIENT_CERT not set to true"
    fi
    
    # Check logs for client cert verification message
    if kubectl logs -n record-platform "$pod" --tail=50 2>&1 | grep -q "Client certificate verification is ENABLED"; then
      ok "$service: Client cert verification enabled in logs"
    else
      warn "$service: Client cert verification message not found in logs"
    fi
  fi
done
echo ""

# Step 4: Test gRPC health with client certs
say "Step 4: Testing gRPC health with client certificate verification..."
GRPC_PORTS=(
  "auth-service:50051:auth.AuthService"
  "records-service:50052:records.RecordsService"
  "listings-service:50057:listings.ListingsService"
  "social-service:50056:social.SocialService"
  "shopping-service:50058:shopping.ShoppingService"
  "analytics-service:50054:analytics.AnalyticsService"
  "auction-monitor:50059:auction_monitor.AuctionMonitorService"
  "python-ai-service:50060:python_ai.PythonAIService"
)

HEALTH_PASSED=0
HEALTH_TOTAL=${#GRPC_PORTS[@]}

for entry in "${GRPC_PORTS[@]}"; do
  IFS=':' read -r service port service_name <<< "$entry"
  pod=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -n "$pod" ]]; then
    echo -n "  Testing $service (port $port)... "
    if kubectl exec -n record-platform "$pod" -- /usr/local/bin/grpc-health-probe \
      -addr=localhost:"$port" \
      -service="$service_name" \
      -tls \
      -tls-no-verify=false \
      -tls-ca-cert=/etc/certs/ca.crt \
      -tls-client-cert=/etc/certs/tls.crt \
      -tls-client-key=/etc/certs/tls.key \
      -tls-server-name=record.local \
      -connect-timeout=5s \
      -rpc-timeout=5s >/dev/null 2>&1; then
      ok "$service gRPC health check passed"
      HEALTH_PASSED=$((HEALTH_PASSED + 1))
    else
      warn "$service gRPC health check failed"
    fi
  fi
done

echo ""
if [[ $HEALTH_PASSED -eq $HEALTH_TOTAL ]]; then
  ok "All $HEALTH_TOTAL gRPC health checks passed"
else
  warn "Only $HEALTH_PASSED/$HEALTH_TOTAL gRPC health checks passed"
fi
echo ""

# Step 5: Run test suite
say "Step 5: Running test suite..."
echo "This will run the baseline test suite to verify all fixes work."
echo ""

# Ensure HTTP/3 CA cert is set
export HTTP3_CA_CERT="/tmp/http3-ca.pem"

# Run baseline test suite
if [[ -f "$SCRIPT_DIR/test-microservices-http2-http3.sh" ]]; then
  say "Running baseline test suite (test-microservices-http2-http3.sh)..."
  if "$SCRIPT_DIR/test-microservices-http2-http3.sh" 2>&1 | tee -a "$LOG_FILE"; then
    ok "Baseline test suite completed"
  else
    RC=$?
    warn "Baseline test suite failed with exit code $RC"
    echo ""
    echo "Last 50 lines of test output:"
    tail -50 "$LOG_FILE" | sed 's/^/  /'
  fi
else
  warn "Test script not found: $SCRIPT_DIR/test-microservices-http2-http3.sh"
fi
echo ""

# Step 6: Summary
say "=== VERIFICATION SUMMARY ==="
echo ""
echo "Service Status: $READY_COUNT/$TOTAL_COUNT Ready"
echo "gRPC Health: $HEALTH_PASSED/$HEALTH_TOTAL Passed"
echo "Log file: $LOG_FILE"
echo ""
echo "Next steps:"
echo "1. Review log file: $LOG_FILE"
echo "2. Check service logs if any failures: kubectl logs -n record-platform -l app=<service>"
echo "3. Run full test suite: RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh"
