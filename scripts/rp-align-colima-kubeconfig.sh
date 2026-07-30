#!/usr/bin/env bash
# Align host kubeconfig to Colima bridge IP (never 127.0.0.1 on macOS host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/colima-kubeconfig.sh
source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"

QUIET="${RP_KUBE_ALIGN_QUIET:-0}"

if ! command -v colima >/dev/null 2>&1; then
  echo "❌ colima not found" >&2
  exit 1
fi
if ! colima status >/dev/null 2>&1; then
  echo "❌ colima is not running" >&2
  exit 1
fi

export RP_COLIMA_KUBECONFIG_ALIGN_HOST_API="${RP_COLIMA_KUBECONFIG_ALIGN_HOST_API:-1}"
export RP_COLIMA_HOST_IP="${RP_COLIMA_HOST_IP:-${RP_COLIMA_HOST_IP:-}}"
export RP_COLIMA_HOST_IP_FALLBACK="${RP_COLIMA_HOST_IP_FALLBACK:-${RP_COLIMA_HOST_IP_FALLBACK:-192.168.64.7}}"

server="$(rp_colima_compute_host_api_server || true)"
if [[ -z "$server" ]]; then
  echo "❌ could not compute Colima bridge API server URL" >&2
  exit 1
fi

aligned=0
changed=0
for kcfg in \
  "${HOME}/.colima/default/kubernetes/kubeconfig" \
  "${HOME}/.colima/default/kubeconfig" \
  "${KUBECONFIG:-${HOME}/.kube/config}"; do
  [[ -s "$kcfg" ]] || continue
  cur="$(kubectl config view --minify --kubeconfig="$kcfg" -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
  if _rp_kubectl_set_cluster_server "$kcfg" "$server"; then
    aligned=1
    export KUBECONFIG="$kcfg"
    ctx="$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || true)"
    [[ -n "$ctx" ]] && kubectl config use-context "$ctx" >/dev/null 2>&1 || true
    [[ "$cur" != "$server" ]] && changed=1
  fi
done

if [[ "${aligned:-0}" != "1" ]]; then
  rp_export_colima_kubeconfig_prefer_reachable || true
  changed=1
fi

server="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
if [[ -z "$server" ]]; then
  echo "❌ no cluster server in kubeconfig" >&2
  exit 1
fi
if [[ "$server" == *127.0.0.1* || "$server" == *localhost* ]]; then
  echo "❌ host kubeconfig still points at loopback: $server" >&2
  exit 1
fi

if [[ "$QUIET" != "1" ]]; then
  echo "✅ Colima kubeconfig server: $server"
  kubectl get nodes -o wide --request-timeout=25s
elif [[ "$changed" == "1" ]]; then
  echo "ℹ️  kubeconfig aligned to $server"
fi
