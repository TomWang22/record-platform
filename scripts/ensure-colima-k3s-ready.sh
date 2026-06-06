#!/usr/bin/env bash
# Ensure Colima and k3s are ready - comprehensive diagnostics and fixes
# 
# This script:
# 1. Verifies Colima is running
# 2. Checks k3s service status inside Colima
# 3. Diagnoses k3s startup issues
# 4. Waits for k3s API server to be ready
# 5. Provides actionable fixes if k3s isn't starting
#
# Usage:
#   ./scripts/ensure-colima-k3s-ready.sh
#   MAX_WAIT=300 ./scripts/ensure-colima-k3s-ready.sh  # Wait up to 5 minutes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

MAX_WAIT="${MAX_WAIT:-300}"  # Default 5 minutes
CHECK_INTERVAL="${CHECK_INTERVAL:-5}"  # Check every 5 seconds

# Step 1: Verify Colima is running
say "=== Step 1: Verifying Colima Status ==="

if ! command -v colima >/dev/null 2>&1; then
  fail "Colima not found. Install: brew install colima"
fi

COLIMA_STATUS=$(colima status 2>&1 || echo "not running")
if echo "$COLIMA_STATUS" | grep -q "running"; then
  ok "Colima is running"
  echo "$COLIMA_STATUS" | head -5
else
  warn "Colima is not running"
  say "Starting Colima..."
  if colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes 2>&1; then
    ok "Colima started"
    sleep 10  # Give it time to initialize
  else
    fail "Failed to start Colima. Check: colima status"
  fi
fi

# Step 2: Verify Colima context
say "=== Step 2: Verifying Kubernetes Context ==="

ctx=$(kubectl config current-context 2>/dev/null || echo "")
colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")

if [[ -n "$colima_ctx" ]]; then
  kubectl config use-context "$colima_ctx" 2>/dev/null && ctx="$colima_ctx" || true
  ok "Using Colima context: $ctx"
else
  warn "Colima context not found. Creating..."
  # Colima should have created the context, but let's check kubeconfig location
  KUBECONFIG_PATH="$HOME/.colima/default/kubeconfig"
  if [[ -f "$KUBECONFIG_PATH" ]]; then
    export KUBECONFIG="$KUBECONFIG_PATH"
    ok "Using kubeconfig: $KUBECONFIG_PATH"
  else
    warn "kubeconfig not found at $KUBECONFIG_PATH"
    say "Trying to get kubeconfig from Colima..."
    colima kubectl config view 2>&1 | head -10 || warn "Could not get kubeconfig"
  fi
fi

# Step 3: Check k3s service status inside Colima
say "=== Step 3: Checking k3s Service Status ==="

K3S_STATUS=""
K3S_ACTIVE=""
K3S_ERRORS=""

# Try to get k3s service status via colima ssh
if colima ssh -- sudo systemctl is-active k3s 2>/dev/null | grep -q "active"; then
  K3S_ACTIVE="active"
  ok "k3s service is active"
elif colima ssh -- sudo systemctl is-active k3s 2>/dev/null | grep -q "inactive"; then
  K3S_ACTIVE="inactive"
  warn "k3s service is inactive"
else
  # Try alternative method - check if k3s process is running
  if colima ssh -- ps aux | grep -q "[k]3s server"; then
    K3S_ACTIVE="running"
    ok "k3s process is running (detected via ps)"
  else
    K3S_ACTIVE="not_running"
    warn "k3s process not found"
  fi
fi

# Get detailed k3s service status
say "k3s service details:"
K3S_STATUS_OUTPUT=$(colima ssh -- sudo systemctl status k3s --no-pager -l 2>&1 || echo "status check failed")
echo "$K3S_STATUS_OUTPUT" | head -20

# Check for common k3s errors
if echo "$K3S_STATUS_OUTPUT" | grep -qi "failed\|error\|dead"; then
  K3S_ERRORS=$(echo "$K3S_STATUS_OUTPUT" | grep -i "failed\|error" | head -5)
  warn "k3s service has errors:"
  echo "$K3S_ERRORS"
fi

# Step 4: Check k3s logs for startup issues
say "=== Step 4: Checking k3s Logs ==="

K3S_LOGS=$(colima ssh -- sudo journalctl -u k3s --no-pager -n 50 2>&1 || echo "log check failed")

# Check for specific error patterns
if echo "$K3S_LOGS" | grep -qi "failed to start\|cannot bind\|address already in use\|port.*in use"; then
  warn "k3s startup errors detected:"
  echo "$K3S_LOGS" | grep -i "failed\|error\|cannot\|bind\|port" | tail -10
fi

# Check for successful startup
if echo "$K3S_LOGS" | grep -qi "k3s is up and running\|server is ready"; then
  ok "k3s appears to have started successfully (from logs)"
else
  warn "No clear startup success message in logs"
fi

# Step 5: Check if k3s is listening on port 6443
say "=== Step 5: Checking k3s API Server Port ==="

# Check inside Colima VM
K3S_PORT_CHECK=$(colima ssh -- sudo netstat -tlnp 2>/dev/null | grep ":6443" || colima ssh -- sudo ss -tlnp 2>/dev/null | grep ":6443" || echo "")
if [[ -n "$K3S_PORT_CHECK" ]]; then
  ok "k3s is listening on port 6443 inside Colima"
  echo "$K3S_PORT_CHECK"
else
  warn "k3s is NOT listening on port 6443 inside Colima"
fi

# Check from host (should be forwarded)
if nc -z 127.0.0.1 6443 2>/dev/null; then
  ok "Port 6443 is accessible from host (127.0.0.1:6443)"
else
  warn "Port 6443 is NOT accessible from host"
  say "This might be normal if k3s just started - port forwarding may take a moment"
fi

# Step 6: Attempt to restart k3s if needed
if [[ "$K3S_ACTIVE" != "active" ]] && [[ "$K3S_ACTIVE" != "running" ]]; then
  say "=== Step 6: Attempting to Start k3s ==="
  
  warn "k3s is not running. Attempting to start..."
  
  # Try to start k3s service
  if colima ssh -- sudo systemctl start k3s 2>&1; then
    ok "k3s service start command executed"
    sleep 5
    
    # Check if it started
    if colima ssh -- sudo systemctl is-active k3s 2>/dev/null | grep -q "active"; then
      ok "k3s service started successfully"
    else
      warn "k3s service start command executed but service is still not active"
      say "Checking k3s logs for startup errors..."
      colima ssh -- sudo journalctl -u k3s --no-pager -n 30 2>&1 | tail -20
    fi
  else
    warn "Failed to start k3s service via systemctl"
    say "Trying alternative: Check if k3s binary exists and can run..."
    
    # Check if k3s binary exists
    if colima ssh -- test -f /usr/local/bin/k3s 2>/dev/null; then
      ok "k3s binary exists at /usr/local/bin/k3s"
    else
      warn "k3s binary not found at /usr/local/bin/k3s"
      say "k3s may need to be reinstalled. Try: colima stop && colima start --with-kubernetes"
    fi
  fi
fi

# Step 7: Wait for k3s API server to be ready
say "=== Step 7: Waiting for k3s API Server to be Ready ==="

ELAPSED=0
READY=false

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  # Try multiple methods to check if API server is ready
  
  # Method 1: kubectl get nodes (most reliable)
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "k3s API server is ready! (kubectl get nodes succeeded)"
    READY=true
    break
  fi
  
  # Method 2: Check via colima ssh kubectl (if local kubectl fails)
  if colima ssh -- kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "k3s API server is ready! (colima ssh kubectl succeeded)"
    warn "But local kubectl is failing - checking kubeconfig..."
    READY=true
    break
  fi
  
  # Method 3: Check if port is accessible
  if nc -z 127.0.0.1 6443 2>/dev/null; then
    say "  Port 6443 is open, but API server not responding yet... (${ELAPSED}s/${MAX_WAIT}s)"
  else
    say "  Port 6443 not accessible yet... (${ELAPSED}s/${MAX_WAIT}s)"
  fi
  
  # Every 30 seconds, check k3s service status
  if [[ $((ELAPSED % 30)) -eq 0 ]] && [[ $ELAPSED -gt 0 ]]; then
    K3S_CURRENT_STATUS=$(colima ssh -- sudo systemctl is-active k3s 2>/dev/null || echo "unknown")
    say "  k3s service status: $K3S_CURRENT_STATUS (${ELAPSED}s elapsed)"
    
    # If k3s is not active, try to restart it
    if [[ "$K3S_CURRENT_STATUS" != "active" ]]; then
      warn "  k3s service is not active, attempting restart..."
      colima ssh -- sudo systemctl restart k3s 2>&1 || true
      sleep 5
    fi
  fi
  
  sleep $CHECK_INTERVAL
  ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

# Step 8: Final verification and diagnostics
if [[ "$READY" == "true" ]]; then
  say "=== Step 8: Final Verification ==="
  
  # Verify we can get nodes
  NODES=$(kubectl get nodes --request-timeout=10s 2>&1 || colima ssh -- kubectl get nodes --request-timeout=10s 2>&1)
  if echo "$NODES" | grep -q "NAME"; then
    ok "k3s cluster is operational"
    echo "$NODES"
    
    # Check node status
    NODE_READY=$(echo "$NODES" | grep -v "NAME" | awk '{print $2}' | head -1 || echo "")
    if [[ "$NODE_READY" == "Ready" ]]; then
      ok "Node is Ready"
    else
      warn "Node status: $NODE_READY (may still be initializing)"
    fi
  else
    warn "Could not get nodes list"
    echo "$NODES"
  fi
  
  # Verify API server version
  API_VERSION=$(kubectl version --client=false --request-timeout=10s 2>&1 | grep "Server Version" || echo "")
  if [[ -n "$API_VERSION" ]]; then
    ok "API server version: $API_VERSION"
  fi
  
  say "=== k3s is Ready! ==="
  ok "You can now run: ./scripts/continue-after-k3s-ready.sh"
  exit 0
  
else
  say "=== k3s API Server Not Ready After ${MAX_WAIT}s ==="
  fail "k3s API server did not become ready. Diagnostics:"
  
  say "Current k3s service status:"
  colima ssh -- sudo systemctl status k3s --no-pager -l 2>&1 | head -30 || true
  
  say "Recent k3s logs:"
  colima ssh -- sudo journalctl -u k3s --no-pager -n 50 2>&1 | tail -30 || true
  
  say "k3s process check:"
  colima ssh -- ps aux | grep k3s | head -5 || true
  
  say "Port 6443 check:"
  colima ssh -- sudo netstat -tlnp 2>/dev/null | grep 6443 || colima ssh -- sudo ss -tlnp 2>/dev/null | grep 6443 || echo "Port 6443 not found"
  
  say ""
  say "Troubleshooting steps:"
  say "1. Check Colima resources: colima status"
  say "2. Restart Colima: colima stop && colima start --cpu 12 --memory 12 --disk 256 --with-kubernetes"
  say "3. Check k3s logs: colima ssh -- sudo journalctl -u k3s -n 100"
  say "4. Manually start k3s: colima ssh -- sudo systemctl start k3s"
  say "5. Check for port conflicts: lsof -i :6443"
  
  exit 1
fi
