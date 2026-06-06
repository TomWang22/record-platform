#!/usr/bin/env bash
# Automatic script to apply ConfigMap, verify, and re-run enhanced test
# This handles cluster connection, ConfigMap application, service restart, and test execution

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== ConfigMap Application and Test Script ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check cluster accessibility
check_cluster() {
  echo "Step 1: Checking cluster accessibility..."
  if kubectl cluster-info &>/dev/null; then
    echo -e "${GREEN}✅ Cluster is accessible${NC}"
    kubectl cluster-info | head -3
    return 0
  else
    echo -e "${YELLOW}⚠️  Cluster not accessible${NC}"
    echo "Attempting to detect cluster issue..."
    
    # Check current context
    local current_ctx=$(kubectl config current-context 2>/dev/null || echo "")
    echo "Current context: $current_ctx"
    
    # Check if Colima Kubernetes needs to be enabled
    if [[ "$current_ctx" == "colima" ]] && command -v colima >/dev/null 2>&1; then
      echo "Colima context detected. Checking Kubernetes status..."
      local k8s_status=$(colima kubernetes status default 2>&1 || echo "")
      if echo "$k8s_status" | grep -qi "not enabled\|disabled\|not running"; then
        echo "Colima Kubernetes not enabled. Attempting to enable..."
        if colima kubernetes start default 2>&1; then
          echo -e "${GREEN}✅ Colima Kubernetes started${NC}"
          sleep 3
          # Test connection
          if kubectl cluster-info &>/dev/null; then
            echo -e "${GREEN}✅ Cluster is now accessible${NC}"
            return 0
          fi
        fi
      fi
    fi
    
    # Try switching to kind-h3 context if available
    if kubectl config get-contexts -o name 2>/dev/null | grep -q "kind-h3"; then
      echo "Trying kind-h3 context..."
      kubectl config use-context kind-h3 >/dev/null 2>&1
      if kubectl cluster-info &>/dev/null; then
        echo -e "${GREEN}✅ Using kind-h3 context - cluster is accessible${NC}"
        return 0
      fi
    fi
    
    # Check if kind clusters exist
    if command -v kind >/dev/null 2>&1; then
      local clusters=$(kind get clusters 2>/dev/null)
      if [[ -n "$clusters" ]]; then
        echo "Found Kind clusters: $clusters"
        echo "You may need to start the cluster or check the kubeconfig"
      else
        echo "No Kind clusters found"
      fi
    fi
    
    # Check Docker containers
    if command -v docker >/dev/null 2>&1; then
      local containers=$(docker ps --format "{{.Names}}" | grep -E "kind|control|worker" | head -3)
      if [[ -n "$containers" ]]; then
        echo "Found K8s node containers:"
        echo "$containers"
      fi
    fi
    
    return 1
  fi
}

# Function to wait for cluster
wait_for_cluster() {
  echo ""
  echo "Waiting for cluster to become accessible..."
  local max_attempts=30
  local attempt=1
  
  while [[ $attempt -le $max_attempts ]]; do
    if kubectl cluster-info &>/dev/null; then
      echo -e "${GREEN}✅ Cluster is now accessible!${NC}"
      return 0
    fi
    echo "Attempt $attempt/$max_attempts: Cluster not ready yet, waiting 2s..."
    sleep 2
    ((attempt++))
  done
  
  echo -e "${RED}❌ Cluster did not become accessible after $max_attempts attempts${NC}"
  return 1
}

# Function to apply ConfigMap
apply_configmap() {
  echo ""
  echo "Step 2: Applying ConfigMap changes..."
  
  local configmap_file="infra/k8s/base/config/app-config.yaml"
  if [[ ! -f "$configmap_file" ]]; then
    echo -e "${RED}❌ ConfigMap file not found: $configmap_file${NC}"
    return 1
  fi
  
  if kubectl apply -f "$configmap_file" 2>&1; then
    echo -e "${GREEN}✅ ConfigMap applied successfully${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  ConfigMap apply failed, trying with --validate=false${NC}"
    if kubectl apply -f "$configmap_file" --validate=false 2>&1; then
      echo -e "${GREEN}✅ ConfigMap applied successfully (validation skipped)${NC}"
      return 0
    else
      echo -e "${RED}❌ Failed to apply ConfigMap${NC}"
      return 1
    fi
  fi
}

# Function to restart auth-service
restart_auth_service() {
  echo ""
  echo "Step 3: Restarting auth-service..."
  
  if kubectl rollout restart deployment auth-service -n record-platform 2>&1; then
    echo -e "${GREEN}✅ Auth-service restart initiated${NC}"
    return 0
  else
    echo -e "${RED}❌ Failed to restart auth-service${NC}"
    return 1
  fi
}

# Function to wait for auth-service rollout
wait_for_auth_rollout() {
  echo ""
  echo "Step 4: Waiting for auth-service rollout to complete..."
  
  if kubectl rollout status deployment auth-service -n record-platform --timeout=120s 2>&1; then
    echo -e "${GREEN}✅ Auth-service rollout completed${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  Auth-service rollout may still be in progress${NC}"
    return 1
  fi
}

# Function to verify auth-service configuration
verify_auth_config() {
  echo ""
  echo "Step 5: Verifying auth-service configuration..."
  
  local auth_pod=$(kubectl -n record-platform get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -z "$auth_pod" ]]; then
    echo -e "${YELLOW}⚠️  Auth-service pod not found${NC}"
    return 1
  fi
  
  echo "Auth-service pod: $auth_pod"
  echo "Checking POSTGRES_URL_AUTH environment variable:"
  
  local db_url=$(kubectl -n record-platform exec "$auth_pod" -- env 2>/dev/null | grep POSTGRES_URL_AUTH || echo "")
  if [[ -n "$db_url" ]]; then
    echo "  $db_url"
    if echo "$db_url" | grep -q "/records"; then
      echo -e "${GREEN}✅ Auth-service is using 'records' database${NC}"
      return 0
    else
      echo -e "${YELLOW}⚠️  Auth-service may still be using old database config${NC}"
      return 1
    fi
  else
    echo -e "${YELLOW}⚠️  Could not read POSTGRES_URL_AUTH from pod${NC}"
    return 1
  fi
}

# Function to wait for services to be ready
wait_for_services() {
  echo ""
  echo "Step 6: Waiting for services to be ready..."
  
  local services=("auth-service" "records-service" "api-gateway")
  local all_ready=true
  
  for svc in "${services[@]}"; do
    echo -n "  Checking $svc... "
    if kubectl -n record-platform wait --for=condition=ready pod -l app=$svc --timeout=60s &>/dev/null; then
      echo -e "${GREEN}✅${NC}"
    else
      echo -e "${YELLOW}⚠️  (may still be starting)${NC}"
      all_ready=false
    fi
  done
  
  if [[ "$all_ready" == "true" ]]; then
    return 0
  else
    return 1
  fi
}

# Function to run enhanced test
run_enhanced_test() {
  echo ""
  echo "Step 7: Running enhanced test..."
  echo ""
  
  local test_script="scripts/test-microservices-http2-http3-enhanced.sh"
  if [[ ! -f "$test_script" ]]; then
    echo -e "${RED}❌ Test script not found: $test_script${NC}"
    return 1
  fi
  
  local log_file="/tmp/enhanced-test-final-$(date +%Y%m%d-%H%M%S).log"
  echo "Test output will be saved to: $log_file"
  echo ""
  
  bash "$test_script" 2>&1 | tee "$log_file"
  local test_exit_code=${PIPESTATUS[0]}
  
  echo ""
  echo "=== Test Summary ==="
  echo "Log file: $log_file"
  
  if [[ $test_exit_code -eq 0 ]]; then
    echo -e "${GREEN}✅ Test completed with exit code 0${NC}"
  else
    echo -e "${YELLOW}⚠️  Test completed with exit code $test_exit_code${NC}"
  fi
  
  # Show key results
  echo ""
  echo "Key test results:"
  grep -E "✅|⚠️|❌|Test [0-9]|Adversarial Test|Database Verification" "$log_file" | tail -30
  
  return $test_exit_code
}

# Main execution
main() {
  # Check cluster first
  if ! check_cluster; then
    echo ""
    echo "Attempting to detect and start cluster..."
    
    # Check for Colima
    if command -v colima >/dev/null 2>&1; then
      local colima_status=$(colima status default 2>&1 || echo "not running")
      if echo "$colima_status" | grep -q "not running\|not found"; then
        echo "Colima default instance not running. Attempting to start..."
        if colima start default 2>&1; then
          echo -e "${GREEN}✅ Colima started${NC}"
          sleep 5
        else
          echo -e "${YELLOW}⚠️  Failed to start Colima automatically${NC}"
        fi
      fi
    fi
    
    # Wait for cluster
    if ! wait_for_cluster; then
      echo -e "${YELLOW}⚠️  Cannot apply ConfigMap without cluster access${NC}"
      echo -e "${YELLOW}⚠️  Running test with current configuration${NC}"
      echo ""
      run_enhanced_test
      exit $?
    fi
  fi
  
  # Apply ConfigMap
  if ! apply_configmap; then
    echo -e "${RED}❌ Failed to apply ConfigMap. Continuing anyway...${NC}"
  fi
  
  # Restart auth-service
  if ! restart_auth_service; then
    echo -e "${YELLOW}⚠️  Failed to restart auth-service. Continuing anyway...${NC}"
  fi
  
  # Wait for rollout
  wait_for_auth_rollout || true
  
  # Verify configuration
  verify_auth_config || true
  
  # Wait for services
  wait_for_services || true
  
  # Run test
  echo ""
  echo "=== Starting Enhanced Test ==="
  echo ""
  run_enhanced_test
  exit $?
}

# Run main function
main "$@"
