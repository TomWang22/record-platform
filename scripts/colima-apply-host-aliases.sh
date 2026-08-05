#!/usr/bin/env bash
# EMERGENCY_POST_COLIMA_RECOVERY_WORKAROUND only.
# Durable routing = selectorless Services + EndpointSlices (see reconcile-external-endpoints.sh).
#
# Requires explicit plane for Colima container deps (default) OR emergency macOS gateway:
#   TARGET_EXECUTION_PLANE=COLIMA_DEFAULT_DOCKER_CONTAINER  → hostAliases → Colima VM IP
#   TARGET_EXECUTION_PLANE=MACOS_FORWARDED_PORT              → hostAliases → host.lima.internal
#   HOST_GATEWAY_IP=x.x.x.x                                 → explicit override (still plane-checked)
#
# Never silently falls back between 192.168.64.x and 192.168.5.x.
# Undo: ./scripts/colima-undo-host-aliases.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="record-platform"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }
bad() { echo "❌ $*" >&2; }

# shellcheck source=lib/rp-resolve-external-dependency-endpoint.sh
source "$SCRIPT_DIR/lib/rp-resolve-external-dependency-endpoint.sh"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"colima"* ]]; then
  say "Context is not Colima ($ctx). This emergency script patches hostAliases for Colima pods only."
  exit 1
fi

if [[ "${RP_ALLOW_EMERGENCY_HOSTALIASES:-0}" != "1" ]]; then
  bad "Refusing deployment-wide hostAliases without RP_ALLOW_EMERGENCY_HOSTALIASES=1"
  bad "Durable path: scripts/reconcile-external-endpoints.sh (Services + EndpointSlices)"
  exit 1
fi

plane="${TARGET_EXECUTION_PLANE:-}"
if [[ -z "$plane" ]]; then
  bad "TARGET_EXECUTION_PLANE is required (COLIMA_DEFAULT_DOCKER_CONTAINER or MACOS_FORWARDED_PORT)"
  exit 1
fi

export TARGET_SERVICE="${TARGET_SERVICE:-compose-external}"
export TARGET_PORT="${TARGET_PORT:-0}"
export TARGET_PROTOCOL="${TARGET_PROTOCOL:-tcp}"
export COLIMA_PROFILE="${COLIMA_PROFILE:-default}"
if [[ -n "${HOST_GATEWAY_IP:-}" ]]; then
  export RP_EXTERNAL_ENDPOINT_IP="$HOST_GATEWAY_IP"
fi

_host_ip="$(TARGET_EXECUTION_PLANE="$plane" rp_resolve_external_dependency_endpoint)" || exit 1
_host_ip="$(echo "$_host_ip" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [[ -z "$_host_ip" ]]; then
  bad "resolver returned empty IP (fail closed)"
  exit 1
fi

say "EMERGENCY hostAliases → $_host_ip (plane=$plane). Not durable design."
for _d in auth-service api-gateway records-service listings-service shopping-service messaging-service trust-service analytics-service media-service notification-service python-ai-service auction-monitor; do
  if kubectl get deployment "$_d" -n "$NS" --request-timeout=5s >/dev/null 2>&1; then
    kubectl patch deployment "$_d" -n "$NS" --type=merge \
      -p "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\",\"host.lima.internal\"]}]}}}}" \
      --request-timeout=10s 2>/dev/null && info "  $_d patched" || true
  fi
done
ok "emergency hostAliases → $_host_ip (plane=$plane)"
info "Replace with External EndpointSlices before treating routing as durable"
