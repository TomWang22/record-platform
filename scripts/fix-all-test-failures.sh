#!/usr/bin/env bash
# Comprehensive fix for all test failures - enables strict TLS with client cert verification
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

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

cd "$REPO_ROOT"

say "=== FIXING ALL TEST FAILURES ==="
echo ""

# Step 1: Fix HTTP/3 certificate issue
say "Step 1: Fixing HTTP/3 certificate verification..."
if [[ ! -f "/tmp/http3-ca.pem" ]]; then
  K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]]; then
    echo "$K8S_CA" > /tmp/http3-ca.pem
    ok "Created /tmp/http3-ca.pem from Kubernetes secret"
  else
    warn "Could not extract CA from Kubernetes secret"
  fi
else
  ok "/tmp/http3-ca.pem already exists"
fi

# Verify http3.sh mounts the cert correctly
if grep -q "HTTP3_CA_CERT" scripts/lib/http3.sh; then
  ok "http3.sh supports HTTP3_CA_CERT"
else
  warn "http3.sh may not support HTTP3_CA_CERT properly"
fi
echo ""

# Step 2: Enable client certificate verification for all gRPC services
say "Step 2: Enabling strict TLS with client certificate verification (production requirement)..."

SERVICES=(
  "auth-service"
  "records-service"
  "listings-service"
  "messaging-service"
  "shopping-service"
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
)

for service in "${SERVICES[@]}"; do
  deploy_file="infra/k8s/base/$service/deploy.yaml"
  if [[ -f "$deploy_file" ]]; then
    # Check if GRPC_REQUIRE_CLIENT_CERT is already set
    if grep -q "GRPC_REQUIRE_CLIENT_CERT" "$deploy_file"; then
      # Update existing value to true
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' 's/GRPC_REQUIRE_CLIENT_CERT.*false/GRPC_REQUIRE_CLIENT_CERT: "true"/g' "$deploy_file"
        sed -i '' 's/value: "false"  # Disable client cert verification for dev/value: "true"  # Enable client cert verification for production/g' "$deploy_file"
      else
        sed -i 's/GRPC_REQUIRE_CLIENT_CERT.*false/GRPC_REQUIRE_CLIENT_CERT: "true"/g' "$deploy_file"
        sed -i 's/value: "false"  # Disable client cert verification for dev/value: "true"  # Enable client cert verification for production/g' "$deploy_file"
      fi
      ok "Updated $service: GRPC_REQUIRE_CLIENT_CERT=true"
    else
      # Add GRPC_REQUIRE_CLIENT_CERT environment variable
      # Find the env section and add it
      if grep -q "ENABLE_GRPC" "$deploy_file"; then
        # Add after ENABLE_GRPC
        if [[ "$(uname)" == "Darwin" ]]; then
          sed -i '' '/ENABLE_GRPC/a\
            - name: GRPC_REQUIRE_CLIENT_CERT\
              value: "true"  # Enable client cert verification for production
' "$deploy_file"
        else
          sed -i '/ENABLE_GRPC/a\            - name: GRPC_REQUIRE_CLIENT_CERT\n              value: "true"  # Enable client cert verification for production' "$deploy_file"
        fi
        ok "Added GRPC_REQUIRE_CLIENT_CERT=true to $service"
      else
        warn "Could not find ENABLE_GRPC in $deploy_file - manual update needed"
      fi
    fi
  else
    warn "Deployment file not found: $deploy_file"
  fi
done
echo ""

# Step 3: Verify health probes use client certificates correctly
say "Step 3: Verifying health probe configurations..."
for service in "${SERVICES[@]}"; do
  deploy_file="infra/k8s/base/$service/deploy.yaml"
  if [[ -f "$deploy_file" ]]; then
    # Check if health probes use TLS with client certs
    if grep -q "grpc-health-probe.*-tls" "$deploy_file" && grep -q "tls-client-cert" "$deploy_file"; then
      ok "$service: Health probes configured with client certs"
    else
      warn "$service: Health probes may not be using client certs correctly"
    fi
  fi
done
echo ""

# Step 4: Apply updated deployments
say "Step 4: Applying updated deployments..."
for service in "${SERVICES[@]}"; do
  deploy_file="infra/k8s/base/$service/deploy.yaml"
  if [[ -f "$deploy_file" ]]; then
    if kubectl apply -f "$deploy_file" >/dev/null 2>&1; then
      ok "Applied $service deployment"
    else
      warn "Failed to apply $service deployment"
    fi
  fi
done
echo ""

# Step 5: Wait for pods to restart and become ready
say "Step 5: Waiting for pods to restart with new configuration..."
sleep 10
for service in "${SERVICES[@]}"; do
  echo -n "  Checking $service... "
  if kubectl wait --for=condition=ready pod -l app="$service" -n record-platform --timeout=120s >/dev/null 2>&1; then
    ok "$service is ready"
  else
    warn "$service not ready after 120s - check logs"
  fi
done
echo ""

# Step 6: Test gRPC health with client cert verification
say "Step 6: Testing gRPC health with client cert verification..."
for service in "${SERVICES[@]}"; do
  pod=$(kubectl get pods -n record-platform -l app="$service" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]]; then
    # Get gRPC port from deployment
    grpc_port=$(grep -A 5 "name: grpc" "infra/k8s/base/$service/deploy.yaml" 2>/dev/null | grep "containerPort" | awk '{print $2}' || echo "50051")
    if [[ -z "$grpc_port" ]] || [[ "$grpc_port" == "50051" ]]; then
      # Try to detect port from service name
      case "$service" in
        auth-service) grpc_port="50051" ;;
        records-service) grpc_port="50052" ;;
        listings-service) grpc_port="50057" ;;
        messaging-service) grpc_port="50056" ;;
        shopping-service) grpc_port="50058" ;;
        analytics-service) grpc_port="50054" ;;
        auction-monitor) grpc_port="50059" ;;
        python-ai-service) grpc_port="50060" ;;
        *) grpc_port="50051" ;;
      esac
    fi
    
    echo -n "  Testing $service (port $grpc_port)... "
    if kubectl exec -n record-platform "$pod" -- /usr/local/bin/grpc-health-probe \
      -addr=localhost:"$grpc_port" \
      -service="$service" \
      -tls \
      -tls-no-verify=false \
      -tls-ca-cert=/etc/certs/ca.crt \
      -tls-client-cert=/etc/certs/tls.crt \
      -tls-client-key=/etc/certs/tls.key \
      -tls-server-name=record.local \
      -connect-timeout=5s \
      -rpc-timeout=5s >/dev/null 2>&1; then
      ok "$service gRPC health check passed"
    else
      warn "$service gRPC health check failed - may need to check TLS configuration"
    fi
  fi
done
echo ""

say "=== FIXES APPLIED ==="
echo ""
echo "Next steps:"
echo "1. Run test suites: RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh"
echo "2. Check logs if any service fails: kubectl logs -n record-platform -l app=<service>"
echo "3. Verify client cert verification is working: Check service logs for 'Client certificate verification is ENABLED'"
