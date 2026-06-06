#!/usr/bin/env bash
# Quick script to restart Colima Kubernetes when API server is unresponsive
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Restarting Colima Kubernetes ==="
colima kubernetes stop 2>&1 | tail -3
say "Waiting 5s..."
sleep 5
colima kubernetes start 2>&1 | tail -10
say "Waiting 60s for API server to be ready..."
sleep 60

if kubectl cluster-info >/dev/null 2>&1; then
  ok "API server is ready!"
  kubectl cluster-info | head -2
else
  warn "API server still not ready - may need full Colima restart"
  warn "Try: colima stop && colima start --kubernetes"
fi
