#!/usr/bin/env bash
# Align host kubeconfig to Colima bridge IP + live k3s port (no 127.0.0.1 tunnel).
# shellcheck source=lib/colima-kubeconfig.sh
set -euo pipefail

rp_bootstrap_align_host_kubeconfig() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=colima-kubeconfig.sh
  source "$script_dir/colima-kubeconfig.sh"

  command -v colima >/dev/null 2>&1 || { echo "❌ colima not found" >&2; return 1; }
  colima status >/dev/null 2>&1 || { echo "❌ colima is not running" >&2; return 1; }

  export RP_COLIMA_KUBECONFIG_ALIGN_HOST_API="${RP_COLIMA_KUBECONFIG_ALIGN_HOST_API:-1}"
  export RP_COLIMA_HOST_IP_FALLBACK="${RP_COLIMA_HOST_IP_FALLBACK:-192.168.64.7}"

  local server
  server="$(rp_colima_compute_host_api_server || true)"
  if [[ -z "$server" ]]; then
    echo "❌ could not compute Colima bridge API server URL" >&2
    return 1
  fi
  if [[ "$server" == *127.0.0.1* || "$server" == *localhost* ]]; then
    echo "❌ kubeconfig still on loopback: $server" >&2
    return 1
  fi

  rp_align_colima_kubeconfig_host_api || true
  rp_export_colima_kubeconfig_prefer_reachable || true

  server="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
  if [[ -z "$server" ]]; then
    echo "❌ no cluster server in kubeconfig" >&2
    return 1
  fi
  if [[ "$server" == *127.0.0.1* || "$server" == *localhost* ]]; then
    echo "❌ host kubeconfig still on loopback after align: $server" >&2
    return 1
  fi

  echo "✅ Colima kubeconfig server: $server"
  kubectl get nodes -o wide --request-timeout=25s 2>/dev/null || true
  return 0
}
