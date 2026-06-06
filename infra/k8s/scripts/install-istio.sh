#!/usr/bin/env bash
set -euo pipefail

# Install Istio service mesh for observability and traffic management
# This script installs Istio CLI and then installs the control plane
# Note: Istio and Linkerd are alternatives - choose one for your cluster

bold() {
  echo -e "\033[1m$1\033[0m"
}

step() {
  echo
  bold ">>> $1"
}

error() {
  echo -e "\033[31m✗ $1\033[0m" >&2
  exit 1
}

warn() {
  echo -e "\033[33m⚠ $1\033[0m"
}

ISTIO_VERSION="${ISTIO_VERSION:-1.21.0}"
NAMESPACE="${NAMESPACE:-istio-system}"

step "Installing Istio service mesh..."

# Check if Istio CLI is installed
if ! command -v istioctl &> /dev/null; then
  step "Installing Istio CLI..."
  curl -sL "https://istio.io/downloadIstio" | ISTIO_VERSION=$ISTIO_VERSION sh -
  export PATH=$PATH:$(pwd)/istio-$ISTIO_VERSION/bin
  echo "Istio CLI installed. Add to PATH: export PATH=\$PATH:$(pwd)/istio-$ISTIO_VERSION/bin"
fi

# Verify CLI is working
if ! istioctl version --remote=false &> /dev/null; then
  error "Istio CLI not working. Please check installation."
fi

# Check if Linkerd is installed
if kubectl get namespace linkerd &> /dev/null; then
  warn "Linkerd is already installed. Istio and Linkerd should not run together."
  warn "Choose one service mesh:"
  warn "  - Linkerd: Lightweight, simpler, better for smaller clusters"
  warn "  - Istio: More features, better for complex routing needs"
  read -p "Continue with Istio installation? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 0
  fi
fi

step "Checking Istio pre-requisites..."
istioctl x precheck || warn "Pre-check found issues. Continuing anyway..."

step "Installing Istio control plane..."
istioctl install \
  --set values.defaultRevision=default \
  --set values.global.proxy.autoInject=disabled \
  -y || error "Failed to install Istio control plane"

step "Waiting for Istio control plane to be ready..."
kubectl wait --for=condition=ready --timeout=300s pod -l app=istiod -n "$NAMESPACE" || true
kubectl wait --for=condition=ready --timeout=300s pod -l app=istio-proxy -n "$NAMESPACE" || true

step "Installing Istio addons (Kiali, Prometheus, Grafana, Jaeger)..."
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/prometheus.yaml || true
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/grafana.yaml || true
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/jaeger.yaml || true
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/kiali.yaml || true

step "Waiting for Istio addons to be ready..."
kubectl wait --for=condition=ready --timeout=300s pod -l app=prometheus -n istio-system || true
kubectl wait --for=condition=ready --timeout=300s pod -l app=grafana -n istio-system || true
kubectl wait --for=condition=ready --timeout=300s pod -l app=jaeger -n istio-system || true

step "Istio installation complete!"
echo
bold "Useful commands:"
echo "  istioctl dashboard kiali              # Open Kiali dashboard"
echo "  istioctl dashboard grafana            # Open Grafana dashboard"
echo "  istioctl dashboard prometheus         # Open Prometheus dashboard"
echo "  istioctl dashboard jaeger             # Open Jaeger dashboard"
echo "  istioctl verify-install               # Verify installation"
echo "  kubectl get pods -n istio-system      # Check control plane"
echo
bold "To enable auto-injection for a namespace:"
echo "  kubectl label namespace <namespace> istio-injection=enabled"
echo
bold "To inject a specific deployment:"
echo "  kubectl get deployment <name> -n <namespace> -o yaml | istioctl kube-inject -f - | kubectl apply -f -"
echo
bold "Access URLs (when using istioctl dashboard):"
echo "  Kiali:       http://localhost:20001"
echo "  Grafana:     http://localhost:3000"
echo "  Prometheus:  http://localhost:9090"
echo "  Jaeger:      http://localhost:16686"

