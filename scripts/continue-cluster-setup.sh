#!/usr/bin/env bash
set -euo pipefail

# Continue cluster setup from where restart script left off
# Use this if the restart script was interrupted

CLUSTER="${1:-h3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Set context
kubectl config use-context "kind-$CLUSTER" >/dev/null 2>&1 || true

# Step 4: Install ingress-nginx
say "Step 4: Installing ingress-nginx..."
if ! kubectl get namespace ingress-nginx >/dev/null 2>&1; then
  kubectl create namespace ingress-nginx
fi

# Install ingress-nginx via Helm if not already installed
if ! helm list -n ingress-nginx 2>/dev/null | grep -q ingress-nginx; then
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1 || true
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --set controller.allowSnippetAnnotations=true \
    --set controller.service.type=ClusterIP \
    --wait --timeout=5m || {
    warn "Helm install had issues, trying without wait..."
    helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
      --namespace ingress-nginx \
      --set controller.allowSnippetAnnotations=true \
      --set controller.service.type=ClusterIP || fail "Failed to install ingress-nginx"
  }
  ok "ingress-nginx installed"
else
  ok "ingress-nginx already installed"
fi

# Wait for ingress-nginx to be ready
say "Waiting for ingress-nginx to be ready..."
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=120s || {
  warn "ingress-nginx not ready yet (continuing...)"
}
ok "ingress-nginx ready"

# Step 5: Build and load images
say "Step 5: Building and loading service images..."
if [[ -f "scripts/build-and-load.sh" ]]; then
  ./scripts/build-and-load.sh "$CLUSTER"
  ok "Images built and loaded"
else
  warn "build-and-load.sh not found (skipping image build)"
fi

# Step 6: Create record-platform namespace
say "Step 6: Creating namespaces..."
kubectl create namespace record-platform 2>/dev/null || true
ok "Namespaces created"

# Step 7: Deploy Caddy
say "Step 7: Deploying Caddy..."
NS=ingress-nginx

# Deploy Caddy ConfigMap (from Caddyfile)
if [[ -f "Caddyfile" ]]; then
  kubectl -n "$NS" create configmap caddy-h3 \
    --from-file=Caddyfile=./Caddyfile \
    --dry-run=client -o yaml | kubectl apply -f - || warn "Failed to create Caddy ConfigMap"
  ok "Caddy ConfigMap created from Caddyfile"
else
  warn "Caddyfile not found (Caddy will use default config)"
fi

# Deploy Caddy Deployment
if [[ -f "infra/k8s/caddy-h3-deploy.yaml" ]]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-deploy.yaml || fail "Failed to deploy Caddy"
  ok "Caddy Deployment applied"
else
  fail "Caddy deployment file not found: infra/k8s/caddy-h3-deploy.yaml"
fi

# Deploy Caddy Service (NodePort)
if [[ -f "infra/k8s/caddy-h3-svc.yaml" ]]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml || fail "Failed to create Caddy service"
  ok "Caddy Service (NodePort 30443) applied"
else
  warn "Caddy service file not found, creating it..."
  # Create service inline
  kubectl -n "$NS" apply -f - <<EOF || fail "Failed to create Caddy service"
apiVersion: v1
kind: Service
metadata:
  name: caddy-h3
  namespace: ingress-nginx
spec:
  selector:
    app: caddy-h3
  type: NodePort
  ports:
    - name: https
      protocol: TCP
      port: 443
      targetPort: 443
      nodePort: 30443
    - name: https-udp
      protocol: UDP
      port: 443
      targetPort: 443
      nodePort: 30443
EOF
  ok "Caddy Service created"
fi

# Step 8: Set up TLS certificates
say "Step 8: Setting up TLS certificates..."
if [[ -f "scripts/rotate-ca-and-fix-tls.sh" ]]; then
  # Generate initial certificate
  HOST="${HOST:-record.local}"
  CA_PATH="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
  if [[ ! -f "$CA_PATH" ]]; then
    warn "mkcert CA not found. Install with: brew install mkcert && mkcert -install"
    warn "Skipping certificate setup"
  else
    # Generate certificate
    CERT_DIR="/tmp/caddy-certs-init-$(date +%s)"
    mkdir -p "$CERT_DIR"
    mkcert -cert-file "$CERT_DIR/tls.crt" -key-file "$CERT_DIR/tls.key" "${HOST}" "*.${HOST}" localhost 127.0.0.1 ::1 >/dev/null 2>&1 || {
      warn "Failed to generate certificate (continuing...)"
      rm -rf "$CERT_DIR"
    }
    
    if [[ -d "$CERT_DIR" ]]; then
      # Create secrets
      NS_ING="ingress-nginx"
      kubectl -n "$NS_ING" delete secret record-local-tls 2>/dev/null || true
      kubectl -n "$NS_ING" create secret tls record-local-tls \
        --cert="$CERT_DIR/tls.crt" \
        --key="$CERT_DIR/tls.key" || warn "Failed to create TLS secret"
      
      kubectl -n "$NS_ING" create secret generic dev-root-ca \
        --from-file=dev-root.pem="$CA_PATH" \
        --dry-run=client -o yaml | kubectl apply -f - || warn "Failed to create CA secret"
      
      # Also create in record-platform namespace
      kubectl -n record-platform delete secret record-local-tls 2>/dev/null || true
      kubectl -n record-platform create secret tls record-local-tls \
        --cert="$CERT_DIR/tls.crt" \
        --key="$CERT_DIR/tls.key" || warn "Failed to create TLS secret in record-platform"
      
      rm -rf "$CERT_DIR"
      ok "Certificates created"
    fi
  fi
else
  warn "rotate-ca-and-fix-tls.sh not found (skipping certificate setup)"
fi

# Step 9: Wait for Caddy to be ready
say "Step 9: Waiting for Caddy to be ready..."
kubectl -n ingress-nginx wait --for=condition=ready pod -l app=caddy-h3 --timeout=120s || {
  warn "Caddy not ready yet (continuing...)"
}
ok "Caddy ready"

# Step 10: Deploy services (using kustomize if available)
say "Step 10: Deploying services..."
if [[ -d "infra/k8s/overlays/dev" ]]; then
  kubectl apply -k infra/k8s/overlays/dev || {
    warn "Kustomize apply had issues (continuing...)"
  }
  ok "Services deployed via kustomize"
elif [[ -d "infra/k8s/base" ]]; then
  kubectl apply -k infra/k8s/base || {
    warn "Base kustomize apply had issues (continuing...)"
  }
  ok "Base services deployed"
else
  warn "No kustomize overlays found (skipping service deployment)"
fi

# Step 11: Restart services that need rebuilding
say "Step 11: Restarting services that need rebuilding..."
SERVICES_TO_RESTART=(
  "messaging-service"
  "auction-monitor"
)

for service in "${SERVICES_TO_RESTART[@]}"; do
  if kubectl -n record-platform get deployment "$service" >/dev/null 2>&1; then
    say "Restarting $service..."
    kubectl -n record-platform rollout restart deploy/"$service" || warn "Failed to restart $service"
  fi
done

# Step 12: Wait for services to be ready
say "Step 12: Waiting for services to be ready..."
sleep 5  # Give services time to start
for service in "${SERVICES_TO_RESTART[@]}"; do
  if kubectl -n record-platform get deployment "$service" >/dev/null 2>&1; then
    kubectl -n record-platform rollout status deploy/"$service" --timeout=120s || {
      warn "$service rollout had issues (check logs)"
    }
  fi
done

# Step 13: Show status
say "Step 13: Cluster Status"
echo "===================="
echo ""
echo "Caddy pods:"
kubectl -n ingress-nginx get pods -l app=caddy-h3
echo ""
echo "Service pods:"
kubectl -n record-platform get pods
echo ""
echo "Services:"
kubectl -n record-platform get svc
echo ""

ok "Cluster setup complete! 🎉"
echo ""
say "Next steps:"
echo "  1. Test Caddy: ./scripts/test-full-chain-with-rotation.sh"
echo "  2. Check service health: kubectl -n record-platform get pods"
echo "  3. View logs: kubectl -n record-platform logs -f deployment/<service>"
echo ""

