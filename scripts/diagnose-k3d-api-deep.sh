#!/usr/bin/env bash
# Deep diagnostic when k3d API server check fails: cluster state, Docker, kubeconfig port, and next steps.
# Run after "API server check capped or failed" to see what is actually going on.
#
# Usage: ./scripts/diagnose-k3d-api-deep.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf "\n\033[1m--- %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"k3d"* ]]; then
  warn "Context is not k3d ($ctx). This script is for k3d clusters."
  exit 0
fi

say "1. k3d cluster list"
if ! command -v k3d >/dev/null 2>&1; then
  warn "k3d not in PATH."
else
  k3d cluster list 2>&1 | sed 's/^/  /'
  _running=$(k3d cluster list 2>/dev/null | grep -c "record-platform.*1/1" || true)
  if [[ "${_running:-0}" -eq 0 ]]; then
    warn "Cluster record-platform is not running (or not 1/1 servers)."
    info "Start it: k3d cluster start record-platform"
    info "Then wait 30–60s and run: k3d kubeconfig merge record-platform --kubeconfig-merge-default"
    info "Then retry preflight or: kubectl get nodes"
  fi
fi

say "2. Docker: k3d containers"
if command -v docker >/dev/null 2>&1; then
  docker ps -a --filter "name=k3d" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | sed 's/^/  /' || info "  (docker ps failed)"
else
  warn "docker not in PATH."
fi

say "3. Kubeconfig: API server URL and port"
_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
if [[ -z "$_server" ]]; then
  warn "No cluster server in kubeconfig (minify)."
else
  info "  Server: $_server"
  if [[ "$_server" =~ :([0-9]+) ]]; then
    _port="${BASH_REMATCH[1]}"
    if ( nc -z -w 2 127.0.0.1 "$_port" 2>/dev/null || nc -z -G 2 127.0.0.1 "$_port" 2>/dev/null ); then
      ok "  Port $_port is open (something is listening)."
    else
      warn "  Port $_port is NOT open (connection refused or nothing listening)."
      info "  If the cluster was just started, wait 30–60s and run: k3d kubeconfig merge record-platform --kubeconfig-merge-default"
      info "  If the cluster is stopped: k3d cluster start record-platform"
    fi
  fi
fi

say "4. Next steps"
echo "  If cluster was stopped:"
echo "    k3d cluster start record-platform"
echo "  Then refresh kubeconfig (get current API port):"
echo "    k3d kubeconfig merge record-platform --kubeconfig-merge-default"
echo "  Wait for API (30–60s), then:"
echo "    kubectl get nodes"
echo "  Then re-run preflight."
echo ""
