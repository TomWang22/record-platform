#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1 || true
if kind get clusters 2>/dev/null | grep -qx 'h3'; then
  kind get kubeconfig --name h3 > /tmp/kind-h3-kubeconfig.yaml 2>/dev/null && export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
elif [[ -s /tmp/kind-h3-kubeconfig.yaml ]]; then
  export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml
fi

echo "=== DIAGNOSING TEST FAILURES ==="
echo ""

echo "1. Checking HTTP/3 certificate setup..."
if [[ -f "/tmp/http3-ca.pem" ]]; then
  echo "  ✅ /tmp/http3-ca.pem exists"
  ls -lh /tmp/http3-ca.pem
else
  echo "  ❌ /tmp/http3-ca.pem NOT FOUND"
  echo "  Checking for alternative CA certs..."
  ls -lh /tmp/test-ca-*.pem 2>/dev/null || echo "    No test CA certs found"
  
  # Try to get CA from Kubernetes secret
  echo "  Attempting to extract CA from Kubernetes secret..."
  K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]]; then
    echo "$K8S_CA" > /tmp/http3-ca.pem
    echo "  ✅ Extracted CA from Kubernetes secret to /tmp/http3-ca.pem"
  else
    echo "  ❌ Could not extract CA from Kubernetes secret"
  fi
fi
echo ""

echo "2. Checking social-service pod status..."
SOCIAL_POD=$(kubectl -n record-platform get pods -l app=social-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$SOCIAL_POD" ]]; then
  echo "  Pod: $SOCIAL_POD"
  kubectl -n record-platform get pod "$SOCIAL_POD" -o jsonpath='{.status.phase}' 2>/dev/null | xargs echo "  Status:"
  kubectl -n record-platform get pod "$SOCIAL_POD" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null | xargs echo "  Ready:"
  echo "  Recent logs (errors only):"
  kubectl -n record-platform logs "$SOCIAL_POD" --tail=50 2>&1 | grep -iE "error|failed|refused|50056" | tail -10 || echo "    (no errors found)"
else
  echo "  ❌ social-service pod not found"
fi
echo ""

echo "3. Checking for service at IP 10.43.44.110:50056..."
kubectl get svc -A -o wide 2>/dev/null | grep -E "10\.43\.44|50056" || echo "  No service found at that IP"
kubectl get endpoints -A -o wide 2>/dev/null | grep -E "10\.43\.44|50056" || echo "  No endpoint found at that IP"
echo ""

echo "4. Checking social-service gRPC server status..."
if [[ -n "$SOCIAL_POD" ]]; then
  echo "  Checking if gRPC port 50056 is listening..."
  kubectl -n record-platform exec "$SOCIAL_POD" -- sh -c "netstat -tlnp 2>/dev/null | grep 50056 || ss -tlnp 2>/dev/null | grep 50056 || echo '  (netstat/ss not available)'" 2>/dev/null || echo "  (exec failed)"
  echo "  Checking gRPC health..."
  kubectl -n record-platform exec "$SOCIAL_POD" -- /usr/local/bin/grpc-health-probe -addr=localhost:50056 2>&1 || echo "  (health probe failed)"
fi
echo ""

echo "5. Checking Envoy gRPC routing..."
ENVOY_POD=$(kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$ENVOY_POD" ]]; then
  echo "  Envoy pod: $ENVOY_POD"
  kubectl -n envoy-test get pod "$ENVOY_POD" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null | xargs echo "  Ready:"
  echo "  Checking Envoy logs for gRPC errors..."
  kubectl -n envoy-test logs "$ENVOY_POD" --tail=30 2>&1 | grep -iE "error|failed|grpc" | tail -10 || echo "    (no errors found)"
else
  echo "  ❌ Envoy pod not found"
fi
echo ""

echo "6. Checking HTTP/3 curl helper..."
if [[ -f "scripts/lib/http3.sh" ]]; then
  echo "  ✅ http3.sh exists"
  # Check if HTTP3_CA_CERT is being used correctly
  if grep -q "HTTP3_CA_CERT" scripts/lib/http3.sh; then
    echo "  ✅ HTTP3_CA_CERT support found in http3.sh"
  else
    echo "  ❌ HTTP3_CA_CERT not found in http3.sh"
  fi
else
  echo "  ❌ http3.sh not found"
fi
echo ""

echo "=== DIAGNOSIS COMPLETE ==="
