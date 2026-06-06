#!/usr/bin/env bash
# Build all service Docker images
# This script builds all services and optionally loads them into the kind cluster

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Configuration
KIND_CLUSTER="${KIND_CLUSTER:-h3}"
LOAD_INTO_KIND="${LOAD_INTO_KIND:-true}"
BUILD_PLATFORM="${BUILD_PLATFORM:-linux/amd64}"
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

# Service list (in build order - dependencies first)
SERVICES=(
  "common"          # Must build common first (dependency for all)
  "api-gateway"
  "auth-service"
  "analytics-service"
  "social-service"
  "listings-service"
  "shopping-service"
  "auction-monitor"
  "python-ai-service"
  "cron-jobs"
)

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

# Check prerequisites
check_prereqs() {
  log_info "Checking prerequisites..."
  
  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
  fi
  
  if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running"
    exit 1
  fi
  
  if [ "$LOAD_INTO_KIND" = "true" ]; then
    if ! command -v kind &> /dev/null; then
      log_error "kind is not installed or not in PATH"
      exit 1
    fi
    
    if ! kind get clusters | grep -q "^${KIND_CLUSTER}$"; then
      log_error "Kind cluster '${KIND_CLUSTER}' does not exist"
      exit 1
    fi
  fi
  
  log_info "Prerequisites check passed"
}

# Build a service
build_service() {
  local service=$1
  local image_name="record-platform/${service}"
  local dockerfile_path="services/${service}/Dockerfile"
  
  if [ ! -f "$dockerfile_path" ]; then
    log_warn "Dockerfile not found for ${service}, skipping..."
    return 0
  fi
  
  log_info "Building ${service}..."
  
  # Special handling for common (it's not a service, but may need to be built)
  if [ "$service" = "common" ]; then
    log_info "Skipping common (it's built as part of each service)"
    return 0
  fi
  
  # Build context is root directory (for workspace access)
  DOCKER_BUILDKIT=$DOCKER_BUILDKIT docker build \
    --platform "$BUILD_PLATFORM" \
    --tag "${image_name}:latest" \
    --tag "${image_name}:$(date +%Y%m%d-%H%M%S)" \
    --file "$dockerfile_path" \
    --progress=plain \
    .
  
  if [ $? -eq 0 ]; then
    log_info "✓ ${service} built successfully"
    
    # Load into kind if requested
    if [ "$LOAD_INTO_KIND" = "true" ]; then
      log_info "Loading ${service} into kind cluster ${KIND_CLUSTER}..."
      kind load docker-image "${image_name}:latest" --name "$KIND_CLUSTER"
      if [ $? -eq 0 ]; then
        log_info "✓ ${service} loaded into kind cluster"
      else
        log_warn "Failed to load ${service} into kind cluster"
      fi
    fi
  else
    log_error "Failed to build ${service}"
    return 1
  fi
}

# Build webapp separately (standalone, not in k8s)
build_webapp() {
  log_info "Building webapp (standalone)..."
  
  local image_name="record-platform/webapp"
  local dockerfile_path="webapp/Dockerfile"
  
  DOCKER_BUILDKIT=$DOCKER_BUILDKIT docker build \
    --platform "$BUILD_PLATFORM" \
    --tag "${image_name}:latest" \
    --tag "${image_name}:$(date +%Y%m%d-%H%M%S)" \
    --file "$dockerfile_path" \
    --progress=plain \
    .
  
  if [ $? -eq 0 ]; then
    log_info "✓ webapp built successfully"
    log_info "Note: webapp is standalone and not loaded into kind cluster"
  else
    log_error "Failed to build webapp"
    return 1
  fi
}

# Main execution
main() {
  log_info "Starting build process..."
  log_info "Kind cluster: ${KIND_CLUSTER}"
  log_info "Load into kind: ${LOAD_INTO_KIND}"
  log_info "Platform: ${BUILD_PLATFORM}"
  
  check_prereqs
  
  local failed_services=()
  local start_time=$(date +%s)
  
  # Build all services
  for service in "${SERVICES[@]}"; do
    if ! build_service "$service"; then
      failed_services+=("$service")
    fi
  done
  
  # Build webapp
  if ! build_webapp; then
    failed_services+=("webapp")
  fi
  
  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  
  # Summary
  echo ""
  log_info "Build completed in ${duration} seconds"
  
  if [ ${#failed_services[@]} -eq 0 ]; then
    log_info "✓ All services built successfully!"
  else
    log_error "Failed services: ${failed_services[*]}"
    exit 1
  fi
  
  # Show images
  echo ""
  log_info "Built images:"
  docker images | grep "record-platform/" | head -20
}

# Run main function
main "$@"
