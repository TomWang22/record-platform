#!/usr/bin/env bash
set -euo pipefail

# Install Linkerd service mesh for observability and traffic management
# This script installs Linkerd CLI and then installs the control plane

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

# Check if linkerd CLI is installed
if ! command -v linkerd &> /dev/null; then
  step "Installing Linkerd CLI..."
  curl -sL https://run.linkerd.io/install-edge | sh
  export PATH=$PATH:$HOME/.linkerd2/bin
fi

# Verify CLI is working
if ! linkerd version --client &> /dev/null; then
  error "Linkerd CLI not working. Please check installation."
fi

step "Checking Linkerd pre-requisites..."
linkerd check --pre || error "Pre-flight checks failed. Please fix issues before continuing."

step "Installing Linkerd control plane..."
linkerd install --crds | kubectl apply -f -
sleep 5
linkerd install | kubectl apply -f -

step "Waiting for Linkerd control plane to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/linkerd-destination -n linkerd
kubectl wait --for=condition=available --timeout=300s deployment/linkerd-identity -n linkerd
kubectl wait --for=condition=available --timeout=300s deployment/linkerd-proxy-injector -n linkerd

step "Checking Linkerd installation..."
linkerd check || error "Linkerd installation check failed"

step "Installing Linkerd Viz (for observability dashboards)..."
linkerd viz install | kubectl apply -f -
sleep 10

step "Waiting for Linkerd Viz to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/metrics-api -n linkerd-viz
kubectl wait --for=condition=available --timeout=300s deployment/web -n linkerd-viz

step "Installing Linkerd Jaeger extension (for distributed tracing)..."
linkerd jaeger install | kubectl apply -f -
sleep 10

step "Linkerd installation complete!"
echo
bold "Useful commands:"
echo "  linkerd dashboard                    # Open Linkerd dashboard"
echo "  linkerd viz dashboard               # Open Linkerd Viz dashboard"
echo "  linkerd check                       # Verify installation"
echo "  kubectl get pods -n linkerd         # Check control plane"
echo
bold "To enable auto-injection for a namespace:"
echo "  kubectl annotate namespace <namespace> linkerd.io/inject=enabled"
echo
bold "To inject a specific deployment:"
echo "  kubectl get deployment <name> -n <namespace> -o yaml | linkerd inject - | kubectl apply -f -"

