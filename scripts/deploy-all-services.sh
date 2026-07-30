#!/usr/bin/env bash
# Deploy all services to Kubernetes cluster using kustomize
# This script deploys all services and infrastructure components

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Configuration
NAMESPACE="${NAMESPACE:-record-platform}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-}"
KUSTOMIZE_OVERLAY="${KUSTOMIZE_OVERLAY:-dev}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
  echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prereqs() {
  log_info "Checking prerequisites..."
  
  if ! command -v kubectl &> /dev/null; then
    log_error "kubectl is not installed or not in PATH"
    exit 1
  fi
  
  if ! command -v kustomize &> /dev/null; then
    log_warn "kustomize is not installed, will use 'kubectl kustomize' instead"
    USE_KUBECTL_KUSTOMIZE=true
  else
    USE_KUBECTL_KUSTOMIZE=false
  fi
  
  # Test kubectl connection
  if [ -n "$KUBECTL_CONTEXT" ]; then
    kubectl config use-context "$KUBECTL_CONTEXT" || {
      log_error "Failed to switch to context: $KUBECTL_CONTEXT"
      exit 1
    }
  fi
  
  if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster"
    exit 1
  fi
  
  log_info "Prerequisites check passed"
}

# Ensure namespace exists
ensure_namespace() {
  log_step "Ensuring namespace '${NAMESPACE}' exists..."
  
  if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    log_info "Creating namespace '${NAMESPACE}'..."
    kubectl create namespace "$NAMESPACE"
  else
    log_info "Namespace '${NAMESPACE}' already exists"
  fi
}

# Deploy base resources
deploy_base() {
  log_step "Deploying base resources..."
  
  local base_dir="infra/k8s/base"
  
  if [ ! -d "$base_dir" ]; then
    log_error "Base directory not found: $base_dir"
    exit 1
  fi
  
  if [ "$USE_KUBECTL_KUSTOMIZE" = "true" ]; then
    kubectl kustomize "$base_dir" | kubectl apply -f -
  else
    kustomize build "$base_dir" | kubectl apply -f -
  fi
  
  log_info "✓ Base resources deployed"
}

# Deploy overlay
deploy_overlay() {
  log_step "Deploying overlay '${KUSTOMIZE_OVERLAY}'..."
  
  local overlay_dir="infra/k8s/overlays/${KUSTOMIZE_OVERLAY}"
  
  if [ ! -d "$overlay_dir" ]; then
    log_error "Overlay directory not found: $overlay_dir"
    exit 1
  fi
  
  if [ "$USE_KUBECTL_KUSTOMIZE" = "true" ]; then
    kubectl kustomize "$overlay_dir" | kubectl apply -f -
  else
    kustomize build "$overlay_dir" | kubectl apply -f -
  fi
  
  log_info "✓ Overlay '${KUSTOMIZE_OVERLAY}' deployed"
}

# Wait for deployments to be ready
wait_for_deployments() {
  log_step "Waiting for deployments to be ready..."
  
  local timeout="${DEPLOYMENT_TIMEOUT:-600}" # 10 minutes default
  local deployments=(
    "api-gateway"
    "auth-service"
    "analytics-service"
    "messaging-service"
    "listings-service"
    "shopping-service"
    "auction-monitor"
    "python-ai-service"
  )
  
  for deployment in "${deployments[@]}"; do
    log_info "Waiting for ${deployment}..."
    if kubectl wait --for=condition=available \
      --timeout="${timeout}s" \
      deployment/"${deployment}" \
      -n "$NAMESPACE" &> /dev/null; then
      log_info "✓ ${deployment} is ready"
    else
      log_warn "⚠ ${deployment} did not become ready within timeout"
    fi
  done
}

# Show deployment status
show_status() {
  log_step "Deployment status:"
  echo ""
  
  kubectl get deployments -n "$NAMESPACE"
  echo ""
  
  kubectl get pods -n "$NAMESPACE" -o wide
  echo ""
  
  log_info "Services:"
  kubectl get services -n "$NAMESPACE"
  echo ""
}

# Main execution
main() {
  log_info "Starting deployment process..."
  log_info "Namespace: ${NAMESPACE}"
  log_info "Overlay: ${KUSTOMIZE_OVERLAY}"
  [ -n "$KUBECTL_CONTEXT" ] && log_info "Context: ${KUBECTL_CONTEXT}"
  
  check_prereqs
  ensure_namespace
  deploy_base
  deploy_overlay
  
  if [ "${WAIT_FOR_READY:-true}" = "true" ]; then
    wait_for_deployments
  fi
  
  show_status
  
  log_info "✓ Deployment completed!"
}

# Run main function
main "$@"
