#!/bin/bash
# One-command bootstrap script for Record Platform
# This script sets up and deploys the entire platform using Terraform + Ansible
# Usage: ./scripts/bootstrap-platform.sh [--destroy] [--skip-build] [--dry-run]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
KIND_CLUSTER="${KIND_CLUSTER:-h3}"
NAMESPACE="${NAMESPACE:-record-platform}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
SKIP_BUILD="${SKIP_BUILD:-false}"
DRY_RUN="${DRY_RUN:-false}"
DESTROY="${DESTROY:-false}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --destroy)
      DESTROY=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --cluster)
      KIND_CLUSTER="$2"
      shift 2
      ;;
    --env)
      ENVIRONMENT="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: $0 [--destroy] [--skip-build] [--dry-run] [--cluster NAME] [--env ENV]"
      exit 1
      ;;
  esac
done

# Helper functions
say() { echo -e "\n${BLUE}▶${NC} $*"; }
ok() { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️${NC} $*"; }
err() { echo -e "${RED}❌${NC} $*" >&2; }

# Check prerequisites
check_prerequisites() {
  say "Checking prerequisites..."
  
  local missing=()
  
  for cmd in terraform ansible kubectl kind docker; do
    if ! command -v "$cmd" &> /dev/null; then
      missing+=("$cmd")
    else
      ok "$cmd found"
    fi
  done
  
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required tools: ${missing[*]}"
    echo ""
    echo "Install missing tools:"
    for cmd in "${missing[@]}"; do
      case $cmd in
        terraform) echo "  brew install terraform" ;;
        ansible) echo "  pip install ansible" ;;
        kubectl) echo "  brew install kubectl" ;;
        kind) echo "  brew install kind" ;;
        docker) echo "  Install Docker Desktop" ;;
      esac
    done
    exit 1
  fi
}

# Initialize Terraform
init_terraform() {
  say "Initializing Terraform..."
  cd "$REPO_ROOT/infra/terraform"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would initialize Terraform"
    return 0
  fi
  
  if terraform init -backend=false > /dev/null 2>&1; then
    ok "Terraform initialized"
  else
    err "Terraform initialization failed"
    terraform init -backend=false
    exit 1
  fi
}

# Apply Terraform
apply_terraform() {
  say "Applying Terraform configuration..."
  cd "$REPO_ROOT/infra/terraform"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would apply Terraform"
    terraform plan -var="environment=$ENVIRONMENT" -var="namespace=$NAMESPACE"
    return 0
  fi
  
  if terraform apply -auto-approve \
    -var="environment=$ENVIRONMENT" \
    -var="namespace=$NAMESPACE" \
    -var="kubeconfig_path=~/.kube/config" \
    -var="kubeconfig_context=" > /dev/null 2>&1; then
    ok "Terraform applied successfully"
  else
    warn "Terraform apply had warnings (checking output)..."
    terraform apply -auto-approve \
      -var="environment=$ENVIRONMENT" \
      -var="namespace=$NAMESPACE" \
      -var="kubeconfig_path=~/.kube/config" \
      -var="kubeconfig_context=" || true
  fi
}

# Destroy Terraform
destroy_terraform() {
  say "Destroying Terraform resources..."
  cd "$REPO_ROOT/infra/terraform"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would destroy Terraform resources"
    terraform plan -destroy -var="environment=$ENVIRONMENT" -var="namespace=$NAMESPACE"
    return 0
  fi
  
  terraform destroy -auto-approve \
    -var="environment=$ENVIRONMENT" \
    -var="namespace=$NAMESPACE" \
    -var="kubeconfig_path=~/.kube/config" \
    -var="kubeconfig_context=" || true
}

# Install Ansible collections
install_ansible() {
  say "Installing Ansible collections..."
  cd "$REPO_ROOT/infra/ansible"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would install Ansible collections"
    return 0
  fi
  
  if ansible-galaxy collection install -r requirements.yml > /dev/null 2>&1; then
    ok "Ansible collections installed"
  else
    warn "Ansible collection installation had issues (continuing)..."
    ansible-galaxy collection install -r requirements.yml || true
  fi
}

# Deploy with Ansible
deploy_ansible() {
  say "Deploying services with Ansible..."
  cd "$REPO_ROOT/infra/ansible"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would deploy with Ansible"
    ansible-playbook playbooks/deploy-services.yml --check
    return 0
  fi
  
  ansible-playbook playbooks/deploy-services.yml \
    -e "namespace=$NAMESPACE" \
    -e "environment=$ENVIRONMENT" \
    -e "kind_cluster=$KIND_CLUSTER" || {
    warn "Ansible deployment had issues (checking logs)..."
    return 1
  }
  
  ok "Ansible deployment completed"
}

# Check Kind cluster
check_kind_cluster() {
  say "Checking Kind cluster..."
  
  if ! kind get clusters | grep -qx "$KIND_CLUSTER" 2>/dev/null; then
    if [[ "$DRY_RUN" == "true" ]]; then
      warn "DRY RUN: Would create Kind cluster: $KIND_CLUSTER"
      return 0
    fi
    
    warn "Kind cluster '$KIND_CLUSTER' not found"
    read -p "Create new cluster? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      say "Creating Kind cluster: $KIND_CLUSTER"
      kind create cluster --name "$KIND_CLUSTER" || {
        err "Failed to create Kind cluster"
        exit 1
      }
      ok "Kind cluster created"
    else
      err "Kind cluster required. Exiting."
      exit 1
    fi
  else
    ok "Kind cluster '$KIND_CLUSTER' exists"
  fi
  
  # Set kubectl context
  kubectl config use-context "kind-$KIND_CLUSTER" > /dev/null 2>&1 || true
}

# Build Docker images
build_images() {
  if [[ "$SKIP_BUILD" == "true" ]]; then
    warn "Skipping Docker image build (--skip-build)"
    return 0
  fi
  
  say "Building Docker images..."
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would build Docker images"
    return 0
  fi
  
  # Detect architecture
  KARCH="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || uname -m)"
  case "$KARCH" in
    aarch64|arm64) PLAT="linux/arm64" ;;
    x86_64|amd64)  PLAT="linux/amd64" ;;
    *)             PLAT="linux/arm64" ;;
  esac
  
  say "Building for platform: $PLAT"
  
  SERVICES=(
    "api-gateway"
    "auth-service"
    "records-service"
    "listings-service"
    "analytics-service"
    "social-service"
    "shopping-service"
    "python-ai-service"
  )
  
  for service in "${SERVICES[@]}"; do
    local df="services/${service}/Dockerfile"
    local ctx="."
    
    if [[ "$service" == "python-ai-service" ]]; then
      ctx="services/python-ai-service"
    fi
    
    if [[ -f "$df" ]]; then
      say "Building ${service}:dev"
      docker buildx build --platform="${PLAT}" -t "${service}:dev" -f "$df" "$ctx" || {
        warn "Failed to build ${service} (continuing...)"
      }
    else
      warn "Dockerfile missing: $df (skipping)"
    fi
  done
  
  # Load images into Kind
  say "Loading images into Kind cluster..."
  for service in "${SERVICES[@]}"; do
    if docker image inspect "${service}:dev" > /dev/null 2>&1; then
      kind load docker-image "${service}:dev" --name "$KIND_CLUSTER" || true
    fi
  done
  
  ok "Docker images built and loaded"
}

# Apply Kubernetes resources
apply_k8s() {
  say "Applying Kubernetes resources..."
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would apply Kubernetes resources"
    kubectl apply -k "$REPO_ROOT/infra/k8s/overlays/$ENVIRONMENT" --dry-run=client
    return 0
  fi
  
  # Create namespace if it doesn't exist
  kubectl create namespace "$NAMESPACE" 2>/dev/null || true
  
  # Apply base resources
  kubectl apply -k "$REPO_ROOT/infra/k8s/base" || {
    err "Failed to apply base Kubernetes resources"
    return 1
  }
  
  # Apply environment overlay
  if [[ -d "$REPO_ROOT/infra/k8s/overlays/$ENVIRONMENT" ]]; then
    kubectl apply -k "$REPO_ROOT/infra/k8s/overlays/$ENVIRONMENT" || {
      warn "Environment overlay had issues (continuing...)"
    }
  fi
  
  ok "Kubernetes resources applied"
}

# Wait for deployments
wait_for_deployments() {
  say "Waiting for deployments to be ready..."
  
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN: Would wait for deployments"
    return 0
  fi
  
  local deployments=(
    "api-gateway"
    "auth-service"
    "records-service"
    "listings-service"
    "analytics-service"
    "social-service"
    "shopping-service"
    "python-ai-service"
    "haproxy"
    "nginx"
  )
  
  for deploy in "${deployments[@]}"; do
    if kubectl -n "$NAMESPACE" get deployment "$deploy" > /dev/null 2>&1; then
      say "Waiting for $deploy..."
      kubectl -n "$NAMESPACE" rollout status "deployment/$deploy" --timeout=120s || {
        warn "$deploy rollout had issues (continuing...)"
      }
    fi
  done
  
  ok "Deployments ready"
}

# Show status
show_status() {
  say "Platform Status"
  echo "================"
  echo ""
  
  echo "Kubernetes Resources:"
  kubectl -n "$NAMESPACE" get deployments,services,pods -o wide || true
  echo ""
  
  echo "Port Forward Commands:"
  echo "  API Gateway:    kubectl -n $NAMESPACE port-forward svc/api-gateway 4000:4000"
  echo "  Auth Service:   kubectl -n $NAMESPACE port-forward svc/auth-service 4001:4001"
  echo "  Records:        kubectl -n $NAMESPACE port-forward svc/records-service 4002:4002"
  echo "  Nginx Edge:     kubectl -n $NAMESPACE port-forward svc/nginx 8080:8080"
  echo ""
}

# Main execution
main() {
  echo -e "${BLUE}"
  echo "╔════════════════════════════════════════╗"
  echo "║   Record Platform Bootstrap Script     ║"
  echo "╚════════════════════════════════════════╝"
  echo -e "${NC}"
  echo ""
  echo "Configuration:"
  echo "  Cluster:    $KIND_CLUSTER"
  echo "  Namespace:  $NAMESPACE"
  echo "  Environment: $ENVIRONMENT"
  echo "  Skip Build: $SKIP_BUILD"
  echo "  Dry Run:    $DRY_RUN"
  echo "  Destroy:    $DESTROY"
  echo ""
  
  if [[ "$DESTROY" == "true" ]]; then
    warn "DESTROY MODE: This will tear down infrastructure"
    read -p "Are you sure? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      say "Cancelled"
      exit 0
    fi
    
    destroy_terraform
    say "Destroy complete"
    exit 0
  fi
  
  check_prerequisites
  check_kind_cluster
  
  init_terraform
  apply_terraform
  
  install_ansible
  deploy_ansible
  
  build_images
  apply_k8s
  wait_for_deployments
  
  show_status
  
  ok "Bootstrap complete! 🎉"
  echo ""
  say "Next steps:"
  echo "  1. Verify services: kubectl -n $NAMESPACE get pods"
  echo "  2. Check logs: kubectl -n $NAMESPACE logs -f deployment/api-gateway"
  echo "  3. Run tests: ./scripts/test-microservices-http2-http3.sh"
  echo ""
}

# Run main
main "$@"

