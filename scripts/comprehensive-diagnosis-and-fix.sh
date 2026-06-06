#!/usr/bin/env bash
# Comprehensive diagnosis and fix for all test failures with Colima k3s
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1 || true
kubectl config use-context colima >/dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG_FILE="/tmp/comprehensive-fix-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== COMPREHENSIVE DIAGNOSIS AND FIX ==="
echo "Log: $LOG_FILE"
echo ""

# Step 1: Check Colima and k3s
say "Step 1: Checking Colima and k3s status..."
if colima status >/dev/null 2>&1; then
  ok "Colima is running"
else
  fail "Colima is not running"
  exit 1
fi

if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  ok "k3s API server is reachable"
else
  warn "k3s API server not reachable - checking k3s status..."
  colima ssh "sudo systemctl status k3s --no-pager -n 10" 2>&1 | head -20
  warn "May need to restart k3s: colima ssh 'sudo systemctl restart k3s'"
fi
echo ""

# Step 2: Scale all services to 1 replica and clean up old pods
say "Step 2: Scaling all services to 1 replica and cleaning up old pods..."
SERVICES=(
  "auth-service"
  "records-service"
  "listings-service"
  "social-service"
  "shopping-service"
  "analytics-service"
  "auction-monitor"
  "python-ai-service"
  "api-gateway"
)

for service in "${SERVICES[@]}"; do
  # Scale to 1
  kubectl scale deployment "$service" -n record-platform --replicas=1 >/dev/null 2>&1 && ok "Scaled $service to 1" || warn "Failed to scale $service"
  
  # Delete old ReplicaSets
  kubectl get rs -n record-platform -l app="$service" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n' | while read -r rs; do
    if [[ -n "$rs" ]]; then
      desired=$(kubectl get rs "$rs" -n record-platform -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
      if [[ "$desired" == "0" ]]; then
        kubectl delete rs "$rs" -n record-platform --ignore-not-found=true >/dev/null 2>&1 && echo "  Deleted old ReplicaSet: $rs"
      fi
    fi
  done
done

# Force delete any pods that are not Ready and older than 5 minutes
kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' -o json 2>/dev/null | \
  jq -r '.items[] | select(.status.containerStatuses[0].ready != true) | select((.metadata.creationTimestamp | fromdateiso8601) < (now - 300)) | .metadata.name' 2>/dev/null | \
  while read -r pod; do
    if [[ -n "$pod" ]]; then
      kubectl delete pod "$pod" -n record-platform --force --grace-period=0 >/dev/null 2>&1 && echo "  Force deleted stuck pod: $pod"
    fi
  done

echo ""

# Step 3: Check pod status and logs for failures
say "Step 3: Checking pod status and diagnosing failures..."
for service in "${SERVICES[@]}"; do
  pod=$(kubectl get pods -n record-platform -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$pod" ]]; then
    warn "$service: No pod found"
    continue
  fi
  
  ready=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
  status=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
  restarts=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "0")
  
  if [[ "$ready" == "true" ]]; then
    ok "$service: Ready ($status, $restarts restarts)"
  else
    warn "$service: Not Ready ($status, $restarts restarts)"
    
    # Check for common issues
    if [[ "$status" == "CrashLoopBackOff" ]] || [[ "$status" == "Error" ]]; then
      echo "  Recent logs:"
      kubectl logs "$pod" -n record-platform --tail=20 2>&1 | grep -iE "error|failed|fatal|panic" | head -5 | sed 's/^/    /' || echo "    (no errors in recent logs)"
    fi
    
    # Check if it's waiting for something
    waiting=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
    if [[ -n "$waiting" ]]; then
      echo "  Waiting reason: $waiting"
    fi
  fi
done
echo ""

# Step 4: Verify strict TLS configuration
say "Step 4: Verifying strict TLS configuration..."
for service in "${SERVICES[@]}"; do
  pod=$(kubectl get pods -n record-platform -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]] && kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    env_val=$(kubectl exec -n record-platform "$pod" -- env 2>/dev/null | grep "GRPC_REQUIRE_CLIENT_CERT" || echo "")
    if echo "$env_val" | grep -q "true"; then
      ok "$service: GRPC_REQUIRE_CLIENT_CERT=true"
    else
      warn "$service: GRPC_REQUIRE_CLIENT_CERT not set to true"
    fi
  fi
done
echo ""

# Step 5: Check database connectivity
say "Step 5: Checking database connectivity..."
# Check if Docker Compose databases are running
if docker ps --format '{{.Names}}' | grep -qE "postgres|redis|kafka|zookeeper"; then
  ok "External databases (Docker Compose) are running"
else
  warn "External databases may not be running"
fi

# Check database connections from a test pod
test_pod=$(kubectl get pods -n record-platform -l app=auth-service --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$test_pod" ]] && kubectl get pod "$test_pod" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
  echo "  Testing database connection from $test_pod..."
  if kubectl exec -n record-platform "$test_pod" -- sh -c "nc -zv host.docker.internal 5437 2>&1" >/dev/null 2>&1; then
    ok "  Can reach PostgreSQL auth (5437)"
  else
    warn "  Cannot reach PostgreSQL auth (5437)"
  fi
  
  if kubectl exec -n record-platform "$test_pod" -- sh -c "nc -zv host.docker.internal 6379 2>&1" >/dev/null 2>&1; then
    ok "  Can reach Redis (6379)"
  else
    warn "  Cannot reach Redis (6379)"
  fi
fi
echo ""

# Step 6: Check for build issues
say "Step 6: Checking Docker images..."
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "(auth-service|records-service|listings-service|social-service|shopping-service|analytics-service|auction-monitor|python-ai-service):dev" | head -8 | while read -r image; do
  if [[ -n "$image" ]]; then
    ok "Image exists: $image"
  fi
done
echo ""

# Step 7: Summary and next steps
say "=== DIAGNOSIS SUMMARY ==="
echo ""
echo "Next steps:"
echo "1. Review pod logs for services that are not Ready"
echo "2. Check if images need to be rebuilt"
echo "3. Verify database connections"
echo "4. Test gRPC health with client cert verification"
echo "5. Run test suite: RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh"
echo ""
echo "Log file: $LOG_FILE"
