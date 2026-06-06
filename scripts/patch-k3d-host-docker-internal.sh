#!/usr/bin/env bash
# Patch all record-platform app deployments so host.docker.internal resolves in pods.
# Required on k3d so pods can reach Redis, Postgres, Kafka on the host (Docker Compose).
# Run after: kubectl apply -k infra/k8s/base (apply overwrites hostAliases).
#
# Usage: ./scripts/patch-k3d-host-docker-internal.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APPS=( api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor )

# From k3d pods, the Docker host is the k3d network gateway (172.18.0.1). Use that so Redis/Postgres on host are reachable.
_host_ip="${HOST_DOCKER_INTERNAL_IP:-}"
if [[ -z "$_host_ip" ]]; then
  _gw=$(docker network inspect k3d-record-platform --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)
  if [[ -n "$_gw" ]]; then
    _host_ip="$_gw"
    echo "Using k3d network gateway as host: $_host_ip"
  fi
fi
if [[ -z "$_host_ip" ]]; then
  _host_ip=$(docker run --rm --add-host=host.docker.internal:host-gateway alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
fi
if [[ -z "$_host_ip" ]]; then
  _host_ip=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
fi
if [[ -z "$_host_ip" ]]; then
  echo "Could not resolve host. Set HOST_DOCKER_INTERNAL_IP (e.g. 172.18.0.1 for k3d gateway)."
  exit 1
fi

_patch_file="${TMPDIR:-/tmp}/k3d-hostalias-patch-$$.json"
trap 'rm -f "$_patch_file"' EXIT
echo "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\"]}]}}}}" > "$_patch_file"

echo "Patching host.docker.internal -> $_host_ip for ${#APPS[@]} deployments..."
for _d in "${APPS[@]}"; do
  if kubectl patch deployment "$_d" -n record-platform --type=merge --patch-file="$_patch_file" 2>/dev/null; then
    echo "  $_d"
  fi
done
echo "Done. Pods will roll out; Redis/Postgres at host.docker.internal:6379 and :5433-5440 should be reachable."
