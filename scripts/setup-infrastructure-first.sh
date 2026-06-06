#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

echo "=== INFRASTRUCTURE SETUP (Caddy → Envoy → Services → DBs) ==="
echo ""

# Wait for API server
echo "⏳ Waiting for Kubernetes API server..."
for i in {1..30}; do
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    echo "✅ API server ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "⚠️  API server still not ready, restarting control plane..."
    docker restart h3-control-plane
    sleep 5
  else
    sleep 1
  fi
done

echo ""
echo "📦 STEP 1: Creating namespaces..."
kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Namespaces created"

echo ""
echo "🔐 STEP 2: Setting up TLS secrets..."
# Check if secrets exist in record-platform namespace
if ! kubectl get secret service-tls -n record-platform >/dev/null 2>&1; then
  echo "⚠️  service-tls secret not found in record-platform namespace"
  echo "   You may need to create it from certs/"
else
  echo "✅ service-tls secret exists"
fi

if ! kubectl get secret dev-root-ca -n record-platform >/dev/null 2>&1; then
  echo "⚠️  dev-root-ca secret not found in record-platform namespace"
  echo "   You may need to create it from certs/"
else
  echo "✅ dev-root-ca secret exists"
  # Copy to ingress-nginx namespace
  kubectl get secret dev-root-ca -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: ingress-nginx/' | \
    kubectl apply -f -
  # Copy to envoy-test namespace
  kubectl get secret dev-root-ca -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: envoy-test/' | \
    kubectl apply -f -
  echo "✅ Copied dev-root-ca to ingress-nginx and envoy-test"
fi

if ! kubectl get secret record-local-tls -n record-platform >/dev/null 2>&1; then
  echo "⚠️  record-local-tls secret not found in record-platform namespace"
  echo "   You may need to create it from certs/"
else
  echo "✅ record-local-tls secret exists"
  # Copy to ingress-nginx namespace
  kubectl get secret record-local-tls -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: ingress-nginx/' | \
    kubectl apply -f -
  echo "✅ Copied record-local-tls to ingress-nginx"
fi

echo ""
echo "🌐 STEP 3: Setting up Caddy (HTTP/3)..."
# Create Caddy ConfigMap
kubectl create configmap caddy-h3 \
  --from-file=Caddyfile=/Users/tom/record-platform/Caddyfile \
  -n ingress-nginx \
  --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Caddy ConfigMap created"

# Deploy Caddy
kubectl apply -f /Users/tom/record-platform/infra/k8s/caddy-h3-deploy.yaml
echo "✅ Caddy deployment applied"

echo ""
echo "🔄 STEP 4: Setting up Envoy (gRPC/HTTP2)..."
# Deploy Envoy
kubectl apply -f /Users/tom/record-platform/infra/k8s/base/envoy-test/deploy.yaml
echo "✅ Envoy deployment applied"

echo ""
echo "⏳ Waiting for pods to start..."
sleep 5

echo ""
echo "📊 STATUS CHECK:"
echo ""
echo "🌐 Caddy (ingress-nginx):"
kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=10s || echo "  (checking...)"
echo ""
echo "🔄 Envoy (envoy-test):"
kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=10s || echo "  (checking...)"
echo ""
echo "✅ Infrastructure setup complete!"
echo ""
echo "Next steps:"
echo "  1. Wait for Caddy (2/2) and Envoy (1/1) to be Ready"
echo "  2. Build and deploy services"
echo "   (Skipping records-service for now due to build issues)"
