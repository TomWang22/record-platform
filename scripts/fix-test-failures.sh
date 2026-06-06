#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1 || true
if kind get clusters 2>/dev/null | grep -qx 'h3'; then
  kind get kubeconfig --name h3 > /tmp/kind-h3-kubeconfig.yaml 2>/dev/null && export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
elif [[ -s /tmp/kind-h3-kubeconfig.yaml ]]; then
  export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
fi

echo "=== FIXING TEST FAILURES ==="
echo ""

# Fix 1: Ensure HTTP/3 CA cert exists
echo "1. Fixing HTTP/3 certificate issue..."
if [[ ! -f "/tmp/http3-ca.pem" ]]; then
  K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]]; then
    echo "$K8S_CA" > /tmp/http3-ca.pem
    echo "  ✅ Created /tmp/http3-ca.pem from Kubernetes secret"
  else
    echo "  ⚠️  Could not extract CA from Kubernetes secret"
  fi
else
  echo "  ✅ /tmp/http3-ca.pem already exists"
fi
echo ""

# Fix 2: Check social-service gRPC server
echo "2. Checking social-service gRPC server..."
SOCIAL_POD=$(kubectl -n record-platform get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$SOCIAL_POD" ]]; then
  echo "  Pod: $SOCIAL_POD"
  
  # Check if gRPC server is actually listening
  echo "  Checking if gRPC server is listening (without TLS first)..."
  kubectl -n record-platform exec "$SOCIAL_POD" -- /usr/local/bin/grpc-health-probe \
    -addr=localhost:50056 \
    -service=social.SocialService \
    -connect-timeout=5s \
    -rpc-timeout=5s 2>&1 || echo "    (insecure probe failed - expected if TLS required)"
  
  # Check logs for gRPC server startup
  echo "  Recent gRPC server logs:"
  kubectl -n record-platform logs "$SOCIAL_POD" --tail=50 2>&1 | grep -iE "gRPC|grpc|50056|listening|bind|start" | tail -10 || echo "    (no gRPC logs found)"
  
  # Check if TLS certs are mounted
  echo "  Checking TLS certificate mounts:"
  kubectl -n record-platform exec "$SOCIAL_POD" -- sh -c "ls -la /etc/certs/ 2>/dev/null | head -10" 2>&1 || echo "    (could not check certs)"
else
  echo "  ❌ social-service pod not found"
fi
echo ""

# Fix 3: Check Envoy configuration
echo "3. Checking Envoy gRPC routing..."
ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$ENVOY_POD" ]]; then
  echo "  Envoy pod: $ENVOY_POD"
  echo "  Checking Envoy configuration for social-service routing..."
  kubectl -n envoy-test exec "$ENVOY_POD" -- cat /etc/envoy/envoy.yaml 2>/dev/null | grep -A 5 -B 5 "social" | head -20 || echo "    (could not check config)"
else
  echo "  ❌ Envoy pod not found"
fi
echo ""

# Fix 4: Restart social-service to see if gRPC server starts
echo "4. Attempting to restart social-service..."
if [[ -n "$SOCIAL_POD" ]]; then
  kubectl -n record-platform delete pod "$SOCIAL_POD" --wait=false 2>&1 | head -5 || echo "  (restart failed)"
  echo "  ✅ Pod deletion initiated (new pod will be created)"
  echo "  Waiting 10 seconds for new pod to start..."
  sleep 10
  NEW_POD=$(kubectl -n record-platform get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$NEW_POD" ]]; then
    echo "  New pod: $NEW_POD"
    echo "  Waiting for pod to be ready (max 60s)..."
    kubectl -n record-platform wait --for=condition=ready pod "$NEW_POD" --timeout=60s 2>&1 || echo "    (pod not ready after 60s)"
  fi
else
  echo "  ⚠️  No pod to restart"
fi
echo ""

echo "=== FIXES APPLIED ==="
echo ""
echo "Next steps:"
echo "1. Check social-service logs: kubectl logs -n record-platform -l app=social-service --tail=100"
echo "2. Verify gRPC health: kubectl exec -n record-platform <pod> -- /usr/local/bin/grpc-health-probe -addr=localhost:50056 -service=social.SocialService"
echo "3. Re-run tests: ./scripts/test-microservices-http2-http3.sh"
