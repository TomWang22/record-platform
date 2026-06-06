#!/usr/bin/env bash
# Refresh kubeconfig from Colima so the API server URL (and port) is current.
# Colima can assign a new random API port after each restart; without refresh, kubectl points at a dead port.
# Usage: ./scripts/colima-refresh-kubeconfig.sh  (then run colima-fix-kubeconfig-localhost.sh to fix VM IP → 127.0.0.1)
# Try 1: colima kubeconfig --merge (newer Colima). Try 2: copy server from Colima's kubeconfig file (older Colima).
set -euo pipefail

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"colima"* ]]; then
  exit 0
fi

# Newer Colima: use built-in merge if available
if command -v colima &>/dev/null; then
  if colima kubeconfig --merge 2>/dev/null; then
    exit 0
  fi
fi

# Fallback: read server from Colima's kubeconfig file and update current config
COLIMA_KUBE="${COLIMA_KUBE:-$HOME/.colima/default/kubernetes/kubeconfig}"
if [[ ! -f "$COLIMA_KUBE" ]]; then
  exit 0
fi

current_cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
colima_server=$(kubectl config view --kubeconfig="$COLIMA_KUBE" --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
if [[ -z "$current_cluster" ]] || [[ -z "$colima_server" ]]; then
  exit 0
fi

kubeconfig_file="${KUBECONFIG:-$HOME/.kube/config}"
if [[ -f "$kubeconfig_file" ]]; then
  kubectl config set-cluster "$current_cluster" --server="$colima_server" --kubeconfig="$kubeconfig_file" >/dev/null 2>&1 || true
fi
exit 0
