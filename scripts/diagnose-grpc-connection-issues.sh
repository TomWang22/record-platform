#!/usr/bin/env bash
# Diagnose gRPC connection issues (ECONNREFUSED on port 50051)
# This script checks service discovery, endpoints, and pod readiness

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/kubectl-helper.sh" 2>/dev/null || true

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Diagnosing gRPC Connection Issues ==="

# Check cluster connectivity
if ! kctl cluster-info >/dev/null 2>&1; then
  fail "Kubernetes cluster is not accessible"
  exit 1
fi

say "=== 1. Checking Service Discovery ==="
echo "Checking auth-service ClusterIP..."
AUTH_CLUSTERIP=$(kctl get svc auth-service -n record-platform -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -n "$AUTH_CLUSTERIP" ]]; then
  ok "auth-service ClusterIP: $AUTH_CLUSTERIP"
else
  warn "auth-service ClusterIP not found"
fi

say "=== 2. Checking Service Endpoints ==="
echo "Checking auth-service endpoints..."
AUTH_ENDPOINTS=$(kctl get endpoints auth-service -n record-platform -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
if [[ -n "$AUTH_ENDPOINTS" ]]; then
  ok "auth-service endpoints: $AUTH_ENDPOINTS"
else
  warn "auth-service has no endpoints (pods not ready or service not configured)"
fi

say "=== 3. Checking Pod Status ==="
echo "Checking auth-service pods..."
AUTH_PODS=$(kctl get pods -n record-platform -l app=auth-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$AUTH_PODS" ]]; then
  ok "auth-service pods: $AUTH_PODS"
  for pod in $AUTH_PODS; do
    echo "  Checking pod $pod..."
    READY=$(kctl get pod "$pod" -n record-platform -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
    if [[ "$READY" == "True" ]]; then
      ok "    Pod $pod is Ready"
    else
      warn "    Pod $pod is NOT Ready (status: $READY)"
    fi
    
    # Check if pod is listening on port 50051
    echo "    Checking if pod is listening on port 50051..."
    if kctl exec -n record-platform "$pod" -- sh -c "netstat -tuln 2>/dev/null | grep 50051 || ss -tuln 2>/dev/null | grep 50051 || lsof -i :50051 2>/dev/null" >/dev/null 2>&1; then
      ok "    Pod $pod is listening on port 50051"
    else
      warn "    Pod $pod is NOT listening on port 50051"
      echo "    Checking pod logs for gRPC server startup..."
      kctl logs -n record-platform "$pod" --tail=20 2>/dev/null | grep -iE "grpc|50051|listening|error" | tail -5 || echo "      No relevant logs found"
    fi
  done
else
  warn "No auth-service pods found"
fi

say "=== 4. Checking API Gateway Configuration ==="
echo "Checking API Gateway environment variables..."
API_GW_POD=$(kctl get pods -n record-platform -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$API_GW_POD" ]]; then
  ok "API Gateway pod: $API_GW_POD"
  AUTH_TARGET=$(kctl exec -n record-platform "$API_GW_POD" -- sh -c 'echo "$AUTH_GRPC_TARGET"' 2>/dev/null || echo "")
  if [[ -n "$AUTH_TARGET" ]]; then
    ok "AUTH_GRPC_TARGET: $AUTH_TARGET"
  else
    warn "AUTH_GRPC_TARGET not set (using default: auth-service:50051)"
  fi
  
  echo "Checking API Gateway logs for connection errors..."
  kctl logs -n record-platform "$API_GW_POD" --tail=30 2>/dev/null | grep -iE "ECONNREFUSED|50051|auth-service|grpc.*error" | tail -10 || echo "  No connection errors found in recent logs"
else
  warn "API Gateway pod not found"
fi

say "=== 5. Testing Service Connectivity ==="
if [[ -n "$AUTH_CLUSTERIP" ]] && [[ -n "$AUTH_ENDPOINTS" ]]; then
  echo "Testing connectivity to $AUTH_CLUSTERIP:50051 from API Gateway..."
  if [[ -n "$API_GW_POD" ]]; then
    if kctl exec -n record-platform "$API_GW_POD" -- sh -c "nc -zv $AUTH_CLUSTERIP 50051 2>&1 || timeout 2 bash -c '</dev/tcp/$AUTH_CLUSTERIP/50051' 2>&1" >/dev/null 2>&1; then
      ok "Connection to $AUTH_CLUSTERIP:50051 successful"
    else
      warn "Connection to $AUTH_CLUSTERIP:50051 failed"
      echo "  This indicates the service is not listening or network policy is blocking"
    fi
  fi
else
  warn "Cannot test connectivity - service or endpoints not found"
fi

say "=== 6. Checking Service Port Configuration ==="
echo "Checking auth-service port configuration..."
AUTH_PORTS=$(kctl get svc auth-service -n record-platform -o jsonpath='{.spec.ports[*].port}' 2>/dev/null || echo "")
if [[ -n "$AUTH_PORTS" ]]; then
  ok "auth-service ports: $AUTH_PORTS"
  if echo "$AUTH_PORTS" | grep -q "50051"; then
    ok "Port 50051 is configured in service"
  else
    warn "Port 50051 is NOT configured in service"
  fi
else
  warn "No ports configured for auth-service"
fi

say "=== Summary ==="
echo "If you see ECONNREFUSED errors:"
echo "  1. Check that auth-service pods are Ready"
echo "  2. Check that auth-service pods are listening on port 50051"
echo "  3. Check that auth-service endpoints are populated"
echo "  4. Check that the service port 50051 is correctly configured"
echo "  5. Check API Gateway logs for detailed error messages"
