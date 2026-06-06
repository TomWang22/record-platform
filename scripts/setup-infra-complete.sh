#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

echo "=== COMPLETE INFRASTRUCTURE SETUP ==="
echo "Order: Namespaces → Secrets → Caddy → Envoy → Services → DBs"
echo ""

# Wait for API server
echo "⏳ Waiting for Kubernetes API server..."
for i in {1..60}; do
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    echo "✅ API server ready"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "❌ API server not ready after 5 minutes"
    echo "   Try: docker restart h3-control-plane && sleep 30"
    exit 1
  fi
  sleep 5
done

echo ""
echo "📦 STEP 1: Creating namespaces..."
kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Namespaces ready"

echo ""
echo "🔐 STEP 2: Setting up TLS secrets..."
# Check and copy secrets from record-platform to other namespaces
if kubectl get secret dev-root-ca -n record-platform >/dev/null 2>&1; then
  echo "✅ dev-root-ca exists in record-platform"
  kubectl get secret dev-root-ca -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: ingress-nginx/' | \
    kubectl apply -f -
  kubectl get secret dev-root-ca -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: envoy-test/' | \
    kubectl apply -f -
  echo "✅ Copied dev-root-ca to ingress-nginx and envoy-test"
else
  echo "⚠️  dev-root-ca not found - you may need to create it from certs/"
fi

if kubectl get secret record-local-tls -n record-platform >/dev/null 2>&1; then
  echo "✅ record-local-tls exists in record-platform"
  kubectl get secret record-local-tls -n record-platform -o yaml | \
    sed 's/namespace: record-platform/namespace: ingress-nginx/' | \
    kubectl apply -f -
  echo "✅ Copied record-local-tls to ingress-nginx"
else
  echo "⚠️  record-local-tls not found - you may need to create it from certs/"
fi

echo ""
echo "🌐 STEP 3: Setting up Caddy (HTTP/3) in ingress-nginx namespace..."
# Create Caddy ConfigMap
kubectl create configmap caddy-h3 \
  --from-file=Caddyfile=/Users/tom/record-platform/Caddyfile \
  -n ingress-nginx \
  --dry-run=client -o yaml | kubectl apply -f -
echo "✅ Caddy ConfigMap created"

# Deploy Caddy
kubectl apply -f /Users/tom/record-platform/infra/k8s/caddy-h3-deploy.yaml
echo "✅ Caddy deployment applied (target: 2/2 pods)"

echo ""
echo "🔄 STEP 4: Setting up Envoy (gRPC/HTTP2) in envoy-test namespace..."
# Deploy Envoy
kubectl apply -f /Users/tom/record-platform/infra/k8s/base/envoy-test/deploy.yaml
echo "✅ Envoy deployment applied (target: 1/1 pod)"

echo ""
echo "⏳ Waiting 10 seconds for pods to initialize..."
sleep 10

echo ""
echo "📊 FINAL STATUS:"
echo ""
echo "🌐 Caddy (ingress-nginx namespace):"
kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=10s || echo "  (checking...)"
echo ""
echo "🔄 Envoy (envoy-test namespace):"
kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=10s || echo "  (checking...)"
echo ""
echo "✅ Infrastructure setup complete!"
echo ""
echo "Next: Build and deploy services (skipping records-service for now)"
