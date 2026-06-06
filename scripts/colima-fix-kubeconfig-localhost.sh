#!/usr/bin/env bash
# Fix Colima kubeconfig: refresh server/port from Colima, then set host to 127.0.0.1 (Mac often can't route to VM IP).
# Usage: ./scripts/colima-fix-kubeconfig-localhost.sh  (refreshes port from Colima then fixes host)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Refresh from Colima first (port can change after restart). Uses colima kubeconfig --merge or Colima's kubeconfig file.
[[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"colima"* ]]; then
  exit 0
fi

cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
if [[ -z "$cluster" ]] || [[ -z "$server" ]]; then
  exit 0
fi

# Already localhost
if [[ "$server" == "https://127.0.0.1:"* ]]; then
  exit 0
fi

# Extract port (e.g. https://192.168.64.7:56906 -> 56906)
if [[ "$server" =~ ^https://[^:]+:([0-9]+)$ ]]; then
  port="${BASH_REMATCH[1]}"
  kubectl config set-cluster "$cluster" --server="https://127.0.0.1:${port}" >/dev/null 2>&1 || true
  echo "Colima kubeconfig: API server set to https://127.0.0.1:${port} (was ${server})"
fi
exit 0
