#!/usr/bin/env bash
# Colima + k3s: ensure API server is reachable at 127.0.0.1:6443.
# Use when context is Colima so tests (baseline, enhanced, etc.) don't hang.
# See COLIMA-K8S-FIX.md and API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"colima"* ]]; then
  say "Context is not Colima ($ctx); skipping Colima-specific setup."
  exit 0
fi

say "=== Colima + k3s: ensure API server reachable ==="

# 1. Ensure server is 127.0.0.1:6443 (not VM IP)
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
if [[ "$server" != *"127.0.0.1:6443"* ]] && [[ -n "$server" ]]; then
  warn "Kubeconfig server is $server; switching to 127.0.0.1:6443"
  cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
  kubectl config set-cluster "$cluster" --server="https://127.0.0.1:6443" 2>/dev/null || true
  ok "Set server to https://127.0.0.1:6443"
fi

# 2. Quick check: kubectl from host
if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
  ok "API server reachable (kubectl get nodes)"
  exit 0
fi

# 3. Fallback: verify from inside VM
if colima ssh -- kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  ok "API server reachable inside VM (colima ssh -- kubectl get nodes)"
  warn "Host kubectl still failing. Use: colima start --with-kubernetes (no --network-address), or: ssh -L 6443:127.0.0.1:6443 colima"
  exit 1
fi

warn "API server not reachable. Ensure Colima is running: colima status"
warn "Start with: colima start --with-kubernetes (no --network-address)."
warn "If using --network-address, run: ssh -L 6443:127.0.0.1:6443 colima"
exit 1
