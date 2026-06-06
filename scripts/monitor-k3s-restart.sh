#!/usr/bin/env bash
# Monitor k3s restart progress and verify API server recovery

set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

say "=== Monitoring k3s Restart ==="

MAX_WAIT=${1:-120}  # Default 2 minutes
WAITED=0
INTERVAL=5

while [[ $WAITED -lt $MAX_WAIT ]]; do
  # Check if k3s service is active
  K3S_ACTIVE=$(colima ssh -- sh -c "systemctl is-active k3s 2>/dev/null || echo 'inactive'" 2>/dev/null || echo "unknown")
  
  # Check if k3s process is running
  K3S_PROCESS=$(colima ssh -- sh -c "ps aux | grep '[k]3s server' | wc -l" 2>/dev/null || echo "0")
  
  # Check if API server is accessible
  API_ACCESSIBLE=false
  if kubectl cluster-info >/dev/null 2>&1; then
    API_ACCESSIBLE=true
  fi
  
  echo "[$WAITED/$MAX_WAIT] k3s service: $K3S_ACTIVE | process: $K3S_PROCESS | API: $([ "$API_ACCESSIBLE" = true ] && echo "✅" || echo "❌")"
  
  if [[ "$API_ACCESSIBLE" == "true" ]]; then
    ok "k3s API server is accessible!"
    kubectl cluster-info | head -3
    echo ""
    say "=== Verifying Cluster Health ==="
    
    # Quick health checks
    echo "Checking nodes..."
    kubectl get nodes 2>/dev/null | head -3 || warn "Cannot get nodes"
    
    echo ""
    echo "Checking system pods..."
    kubectl get pods -n kube-system 2>/dev/null | grep -E "Running|Pending" | head -5 || warn "Cannot get system pods"
    
    echo ""
    echo "Checking for recent errors..."
    colima ssh -- sh -c "journalctl -u k3s -n 50 --no-pager 2>/dev/null | grep -iE 'error|fatal|slow sql' | tail -5" 2>/dev/null || true
    
    exit 0
  fi
  
  sleep $INTERVAL
  WAITED=$((WAITED + INTERVAL))
done

fail "k3s API server did not become accessible within $MAX_WAIT seconds"
say "Troubleshooting steps:"
say "  1. Check k3s logs: colima ssh -- journalctl -u k3s -n 100"
say "  2. Check k3s status: colima ssh -- systemctl status k3s"
say "  3. Try full Colima restart: colima stop && colima start"
exit 1
