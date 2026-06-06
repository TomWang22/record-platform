#!/usr/bin/env bash
# Fix k3s API server connection issues in Colima
# This script diagnoses and fixes common k3s connectivity problems

set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Fixing k3s API Server Connection (Colima) ==="

# Check Colima status
if ! colima status >/dev/null 2>&1; then
  fail "Colima is not running"
  say "Starting Colima..."
  colima start
  exit 0
fi

ok "Colima is running"

# Check if Kubernetes is enabled
K8S_ENABLED=$(colima status 2>&1 | grep -i "kubernetes" || echo "")
if [[ -z "$K8S_ENABLED" ]]; then
  warn "Kubernetes may not be enabled in Colima"
  say "Enabling Kubernetes..."
  colima kubernetes start
  sleep 5
fi

# Check kubeconfig
KUBECONFIG_COLIMA="$HOME/.colima/default/kubeconfig"
if [[ -f "$KUBECONFIG_COLIMA" ]]; then
  ok "Found Colima kubeconfig at $KUBECONFIG_COLIMA"
  export KUBECONFIG="$KUBECONFIG_COLIMA"
else
  warn "Colima kubeconfig not found at $KUBECONFIG_COLIMA"
fi

# Test connection
if kubectl cluster-info >/dev/null 2>&1; then
  ok "k3s API server is accessible"
  kubectl cluster-info | head -3
  exit 0
fi

warn "k3s API server is not accessible, attempting fixes..."

# Fix 1: Restart k3s
say "Fix 1: Restarting k3s..."
colima kubernetes stop 2>&1 || true
sleep 3
colima kubernetes start 2>&1 || true
sleep 10

# Test again
if kubectl cluster-info >/dev/null 2>&1; then
  ok "k3s API server is now accessible after restart"
  kubectl cluster-info | head -3
  exit 0
fi

# Fix 2: Check k3s server process
say "Fix 2: Checking k3s server process..."
if colima ssh -- sh -c "ps aux | grep '[k]3s server'" >/dev/null 2>&1; then
  ok "k3s server process is running"
else
  warn "k3s server process not found, restarting Colima..."
  colima stop
  sleep 2
  colima start
  sleep 10
fi

# Final test
if kubectl cluster-info >/dev/null 2>&1; then
  ok "k3s API server is now accessible"
  kubectl cluster-info | head -3
else
  fail "k3s API server is still not accessible"
  say "Manual steps:"
  say "  1. Check: colima status"
  say "  2. Restart: colima stop && colima start"
  say "  3. Check kubeconfig: export KUBECONFIG=~/.colima/default/kubeconfig"
  exit 1
fi
