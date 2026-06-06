#!/usr/bin/env bash
# Deep cluster health check for Colima/k3s
# Checks for zombie pods, resource issues, operational hygiene, and root causes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/kubectl-helper.sh" 2>/dev/null || true

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

say "=== Deep Cluster Health Check (Colima/k3s) ==="

# Check cluster accessibility
if ! kctl cluster-info >/dev/null 2>&1; then
  fail "Kubernetes cluster is not accessible"
  say "Attempting to check Colima status..."
  colima status 2>&1 || true
  exit 1
fi

ok "Cluster is accessible"

say "=== 1. Cluster Infrastructure ==="
info "Checking Colima/k3s status..."
colima status 2>&1 | head -10 || warn "Cannot get Colima status"

say "=== 2. Zombie Pods and Unhealthy Resources ==="
ZOMBIE_COUNT=0
CRASH_COUNT=0
PENDING_COUNT=0

# Count unhealthy pods
ZOMBIE_COUNT=$(kctl get pods -A --field-selector=status.phase!=Running 2>/dev/null | grep -v "NAME" | wc -l | tr -d ' ' || echo "0")
CRASH_COUNT=$(kctl get pods -A 2>/dev/null | grep -c "CrashLoopBackOff\|Error" || echo "0")
PENDING_COUNT=$(kctl get pods -A 2>/dev/null | grep -c "Pending\|ImagePullBackOff" || echo "0")

info "Non-Running pods: $ZOMBIE_COUNT"
info "CrashLoopBackOff/Error pods: $CRASH_COUNT"
info "Pending/ImagePullBackOff pods: $PENDING_COUNT"

if [[ "$ZOMBIE_COUNT" -gt 10 ]]; then
  warn "High number of non-running pods ($ZOMBIE_COUNT) - possible operational hygiene issue"
  kctl get pods -A --field-selector=status.phase!=Running 2>/dev/null | head -20
fi

if [[ "$CRASH_COUNT" -gt 0 ]]; then
  warn "Pods in crash state:"
  kctl get pods -A | grep -E "CrashLoopBackOff|Error" | head -10
fi

say "=== 3. Resource Usage ==="
if kctl top nodes >/dev/null 2>&1; then
  info "Node resource usage:"
  kctl top nodes 2>/dev/null | head -5
  echo ""
  info "Top resource-consuming pods:"
  kctl top pods -A 2>/dev/null | head -15
else
  warn "Metrics server not available - cannot check resource usage"
fi

say "=== 4. Operational Hygiene ==="
# Check for old completed jobs
COMPLETED_JOBS=$(kctl get jobs -A --field-selector=status.successful=1 2>/dev/null | grep -v "NAME" | wc -l | tr -d ' ' || echo "0")
info "Completed jobs: $COMPLETED_JOBS"
if [[ "$COMPLETED_JOBS" -gt 50 ]]; then
  warn "Many completed jobs ($COMPLETED_JOBS) - consider cleanup"
fi

# Check for orphaned ReplicaSets
ORPHANED_RS=$(kctl get rs -A 2>/dev/null | grep -E "0.*0.*0" | wc -l | tr -d ' ' || echo "0")
info "Orphaned ReplicaSets (0 desired, 0 current): $ORPHANED_RS"

# Check services without endpoints
SVC_NO_ENDPOINTS=$(kctl get svc -A -o json 2>/dev/null | jq -r '.items[] | select(.spec.clusterIP != "None" and .spec.clusterIP != "") | select((.status.loadBalancer.ingress // [] | length) == 0) | select((.status.conditions // [] | length) == 0) | "\(.metadata.namespace)/\(.metadata.name)"' 2>/dev/null | wc -l | tr -d ' ' || echo "0")
info "Services potentially without endpoints: $SVC_NO_ENDPOINTS"

say "=== 5. Critical Service Health (auth-service, api-gateway) ==="
# Auth service
AUTH_DEPLOYMENT=$(kctl get deployment auth-service -n record-platform 2>/dev/null || echo "")
if [[ -n "$AUTH_DEPLOYMENT" ]]; then
  AUTH_READY=$(kctl get deployment auth-service -n record-platform -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  AUTH_DESIRED=$(kctl get deployment auth-service -n record-platform -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$AUTH_READY" == "$AUTH_DESIRED" ]] && [[ "$AUTH_READY" -gt 0 ]]; then
    ok "auth-service: $AUTH_READY/$AUTH_DESIRED replicas ready"
  else
    warn "auth-service: $AUTH_READY/$AUTH_DESIRED replicas ready (expected $AUTH_DESIRED)"
  fi
  
  # Check endpoints
  AUTH_ENDPOINTS=$(kctl get endpoints auth-service -n record-platform -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
  if [[ -n "$AUTH_ENDPOINTS" ]]; then
    ok "auth-service endpoints: $AUTH_ENDPOINTS"
  else
    fail "auth-service has NO endpoints (pods not ready or service misconfigured)"
  fi
  
  # Check if port 50051 is configured
  AUTH_PORT_50051=$(kctl get svc auth-service -n record-platform -o jsonpath='{.spec.ports[?(@.port==50051)].port}' 2>/dev/null || echo "")
  if [[ -n "$AUTH_PORT_50051" ]]; then
    ok "auth-service port 50051 is configured"
  else
    warn "auth-service port 50051 is NOT configured in service"
  fi
else
  fail "auth-service deployment not found"
fi

# API Gateway
API_GW_DEPLOYMENT=$(kctl get deployment api-gateway -n record-platform 2>/dev/null || echo "")
if [[ -n "$API_GW_DEPLOYMENT" ]]; then
  API_GW_READY=$(kctl get deployment api-gateway -n record-platform -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  API_GW_DESIRED=$(kctl get deployment api-gateway -n record-platform -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$API_GW_READY" == "$API_GW_DESIRED" ]] && [[ "$API_GW_READY" -gt 0 ]]; then
    ok "api-gateway: $API_GW_READY/$API_GW_DESIRED replicas ready"
  else
    warn "api-gateway: $API_GW_READY/$API_GW_DESIRED replicas ready (expected $API_GW_DESIRED)"
  fi
else
  warn "api-gateway deployment not found"
fi

say "=== 6. gRPC Port Verification ==="
AUTH_POD=$(kctl get pods -n record-platform -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$AUTH_POD" ]]; then
  info "Checking pod $AUTH_POD for port 50051..."
  if kctl exec -n record-platform "$AUTH_POD" -- sh -c "netstat -tuln 2>/dev/null | grep 50051 || ss -tuln 2>/dev/null | grep 50051" >/dev/null 2>&1; then
    ok "Pod $AUTH_POD is listening on port 50051"
  else
    fail "Pod $AUTH_POD is NOT listening on port 50051"
    info "Checking pod logs for gRPC server startup..."
    kctl logs -n record-platform "$AUTH_POD" --tail=50 2>/dev/null | grep -iE "grpc|50051|listening|error|fatal" | tail -10 || info "No relevant log entries"
  fi
else
  fail "No auth-service pod found"
fi

say "=== 7. Network Connectivity Test ==="
if [[ -n "$AUTH_POD" ]] && [[ -n "$AUTH_ENDPOINTS" ]]; then
  AUTH_CLUSTERIP=$(kctl get svc auth-service -n record-platform -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [[ -n "$AUTH_CLUSTERIP" ]]; then
    API_GW_POD=$(kctl get pods -n record-platform -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$API_GW_POD" ]]; then
      info "Testing connectivity from $API_GW_POD to $AUTH_CLUSTERIP:50051..."
      if kctl exec -n record-platform "$API_GW_POD" -- sh -c "timeout 2 bash -c '</dev/tcp/$AUTH_CLUSTERIP/50051' 2>&1 || nc -zv $AUTH_CLUSTERIP 50051 2>&1" >/dev/null 2>&1; then
        ok "Connection successful"
      else
        fail "Connection FAILED - this is the root cause of ECONNREFUSED"
        info "Possible causes:"
        info "  1. auth-service pod not listening on port 50051"
        info "  2. Network policy blocking traffic"
        info "  3. Service endpoints not properly configured"
      fi
    fi
  fi
fi

say "=== 8. System Pods Health ==="
KUBE_SYSTEM_PODS=$(kctl get pods -n kube-system 2>/dev/null | grep -v "Running" | grep -v "NAME" | wc -l | tr -d ' ' || echo "0")
if [[ "$KUBE_SYSTEM_PODS" -gt 0 ]]; then
  warn "Non-running pods in kube-system: $KUBE_SYSTEM_PODS"
  kctl get pods -n kube-system 2>/dev/null | grep -v "Running" | head -10
else
  ok "All kube-system pods are running"
fi

say "=== Summary ==="
echo "Zombie pods: $ZOMBIE_COUNT"
echo "CrashLoopBackOff pods: $CRASH_COUNT"
echo "Pending pods: $PENDING_COUNT"
echo "Completed jobs: $COMPLETED_JOBS"
echo "Orphaned ReplicaSets: $ORPHANED_RS"
echo ""
if [[ "$ZOMBIE_COUNT" -gt 10 ]] || [[ "$CRASH_COUNT" -gt 0 ]]; then
  warn "Operational hygiene issues detected - consider cleanup"
fi
