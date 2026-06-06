#!/usr/bin/env bash
# Robust pod check that works even if kubectl cluster-info fails

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Robust Pod Status Check ==="

# Try direct kubectl first
if kubectl get pods -n record-platform >/dev/null 2>&1; then
  say "Using kubectl directly..."
  kubectl get pods -n record-platform --no-headers 2>/dev/null | awk '{printf "  %-40s %-15s %s\n", $1, $3, $2}'
elif command -v docker >/dev/null 2>&1 && docker ps --filter "name=h3-control-plane" --format "{{.Names}}" | grep -q "h3-control-plane"; then
  say "Using docker exec (kubectl cluster-info failed)..."
  docker exec h3-control-plane kubectl get pods -n record-platform --no-headers 2>/dev/null | awk '{printf "  %-40s %-15s %s\n", $1, $3, $2}' || warn "Cannot access via docker exec"
else
  warn "Cannot check pods - no access method available"
fi
