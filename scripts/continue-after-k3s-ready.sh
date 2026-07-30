#!/usr/bin/env bash
# Continue diagnosis and fixes after k3s API server is ready
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
kubectl config use-context colima >/dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== CONTINUING AFTER k3s READY ==="
echo ""

# Wait for k3s API server with diagnostics
say "Waiting for k3s API server..."
MAX_ATTEMPTS=40  # 200 seconds total
READY=false

for i in $(seq 1 $MAX_ATTEMPTS); do
  # Try kubectl get nodes
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "k3s API server is ready"
    READY=true
    break
  fi
  
  # Try via colima ssh (sometimes local kubectl fails but colima ssh works)
  if colima ssh -- kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "k3s API server is ready (via colima ssh)"
    warn "Local kubectl is failing - checking kubeconfig..."
    # Fix kubeconfig
    KUBECONFIG_PATH="$HOME/.colima/default/kubeconfig"
    if [[ -f "$KUBECONFIG_PATH" ]]; then
      export KUBECONFIG="$KUBECONFIG_PATH"
      kubectl config use-context colima >/dev/null 2>&1 || true
      ok "Kubeconfig fixed"
    fi
    READY=true
    break
  fi
  
  # Every 10 attempts, check k3s service status and provide diagnostics
  if [[ $((i % 10)) -eq 0 ]]; then
    say "  Attempt $i/$MAX_ATTEMPTS: Checking k3s service status..."
    
    # Check k3s service status
    K3S_STATUS=$(colima ssh -- sudo systemctl is-active k3s 2>/dev/null || echo "unknown")
    if [[ "$K3S_STATUS" != "active" ]]; then
      warn "  k3s service is not active (status: $K3S_STATUS)"
      say "  Attempting to start k3s..."
      colima ssh -- sudo systemctl start k3s 2>&1 || true
      sleep 5
    else
      say "  k3s service is active, but API server not responding yet..."
    fi
    
    # Check if port 6443 is listening inside Colima
    PORT_CHECK=$(colima ssh -- sudo netstat -tlnp 2>/dev/null | grep ":6443" || colima ssh -- sudo ss -tlnp 2>/dev/null | grep ":6443" || echo "")
    if [[ -z "$PORT_CHECK" ]]; then
      warn "  Port 6443 not listening inside Colima"
    else
      say "  Port 6443 is listening inside Colima"
    fi
  else
    echo "  Attempt $i/$MAX_ATTEMPTS: waiting..."
  fi
  
  sleep 5
done

if [[ "$READY" != "true" ]]; then
  warn "k3s API server not ready after $((MAX_ATTEMPTS * 5))s"
  say "Running diagnostics..."
  
  # Run comprehensive diagnostics
  if [[ -f "$SCRIPT_DIR/ensure-colima-k3s-ready.sh" ]]; then
    say "Running comprehensive k3s diagnostics..."
    "$SCRIPT_DIR/ensure-colima-k3s-ready.sh" || true
  else
    say "Manual diagnostics:"
    echo "  1. Check k3s service: colima ssh -- sudo systemctl status k3s"
    echo "  2. Check k3s logs: colima ssh -- sudo journalctl -u k3s -n 50"
    echo "  3. Check k3s process: colima ssh -- ps aux | grep k3s"
    echo "  4. Restart k3s: colima ssh -- sudo systemctl restart k3s"
  fi
  
  exit 1
fi
echo ""

# Scale all services to 1
say "Scaling all services to 1 replica..."
SERVICES=("auth-service" "records-service" "listings-service" "messaging-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")

for service in "${SERVICES[@]}"; do
  if kubectl scale deployment "$service" -n record-platform --replicas=1 >/dev/null 2>&1; then
    ok "$service scaled to 1"
  else
    warn "$service scale failed"
  fi
done
echo ""

# Clean up old ReplicaSets
say "Cleaning up old ReplicaSets..."
kubectl get rs -n record-platform -o json 2>/dev/null | \
  jq -r '.items[] | select(.spec.replicas == 0) | .metadata.name' 2>/dev/null | \
  while read -r rs; do
    if [[ -n "$rs" ]]; then
      kubectl delete rs "$rs" -n record-platform --ignore-not-found=true >/dev/null 2>&1 && echo "  Deleted: $rs"
    fi
  done
echo ""

# Check pod status
say "Current pod status:"
kubectl get pods -n record-platform -l 'app in (auth-service,records-service,listings-service,messaging-service,shopping-service,analytics-service,auction-monitor,python-ai-service)' \
  -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount 2>&1 | head -12
echo ""

# Verify strict TLS
say "Verifying strict TLS configuration..."
for service in auth-service records-service; do
  pod=$(kubectl get pods -n record-platform -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$pod" ]] && kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; then
    env_val=$(kubectl exec -n record-platform "$pod" -- env 2>/dev/null | grep "GRPC_REQUIRE_CLIENT_CERT" || echo "")
    if echo "$env_val" | grep -q "true"; then
      ok "$service: GRPC_REQUIRE_CLIENT_CERT=true"
    else
      warn "$service: GRPC_REQUIRE_CLIENT_CERT not set correctly"
    fi
  fi
done
echo ""

say "=== READY FOR TESTING ==="
echo ""
echo "Next: Run test suite"
echo "  RUN_REISSUE=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee /tmp/pipeline-$(date +%Y%m%d-%H%M%S).log"
