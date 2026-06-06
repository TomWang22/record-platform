#!/usr/bin/env bash
# On k3d: patch all app deployments so host.docker.internal resolves to the host (Mac)
# where Postgres/Redis/Kafka run. Fixes 502 on listings/analytics and "Cannot reach records DB".
# Run from repo root. Override IP: HOST_GATEWAY_IP=172.20.0.1 ./scripts/apply-k3d-host-aliases.sh
# See: docs/COLIMA_POD_STABILITY_AND_HOST_ALIASES.md, diagnose-502-and-analytics.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="record-platform"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"k3d"* ]]; then
  say "Context is not k3d ($ctx). This script sets host.docker.internal for k3d pods only."
  info "For Colima use: ./scripts/colima-apply-host-aliases.sh"
  exit 1
fi

_host_ip="${HOST_GATEWAY_IP:-}"
if [[ -z "$_host_ip" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    _host_ip=$(docker network inspect k3d-record-platform --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)
    [[ -z "$_host_ip" ]] && _host_ip="172.20.0.1"
    [[ "$_host_ip" == "<no value>" ]] && _host_ip="172.20.0.1"
    _pod=$(kubectl get pods -n "$NS" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [[ -n "$_pod" ]]; then
      _resolved=$(kubectl exec -n "$NS" "$_pod" -- getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
      if [[ -n "$_resolved" ]] && [[ "$_resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        _host_ip="$_resolved"
        info "Resolved host.docker.internal from pod: $_host_ip"
      fi
    fi
  else
    _host_ip=$(docker run --rm --network k3d-record-platform 2>/dev/null alpine getent hosts host.k3d.internal 2>/dev/null | awk '{print $1}' || true)
    [[ -z "$_host_ip" ]] && _host_ip=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
    _host_ip="${_host_ip:-172.20.0.1}"
  fi
fi

say "Patching host.docker.internal -> $_host_ip for app deployments (k3d)..."
for _d in auth-service api-gateway records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service; do
  if kubectl get deployment "$_d" -n "$NS" --request-timeout=5s >/dev/null 2>&1; then
    kubectl patch deployment "$_d" -n "$NS" --type=merge \
      -p "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\",\"host.lima.internal\"]}]}}}}" \
      --request-timeout=10s 2>/dev/null && info "  $_d patched" || warn "  $_d patch failed"
  fi
done
ok "host.docker.internal -> $_host_ip (ensure Postgres/Redis on host: docker compose up -d)"
info "If 502 or logged:false persist, run: ./scripts/diagnose-502-and-analytics.sh or set HOST_GATEWAY_IP=<ip> and re-run"
