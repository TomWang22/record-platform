#!/usr/bin/env bash
# RP Colima bridge kubeconfig API health — kubectl-native, no localhost:6443 tunnel.
#
# Usage: bash scripts/rp-kube-api-health.sh
#
# Env:
#   RP_KUBE_API_BRIDGE_PREFIX — required server prefix (default https://192.168.64.)
#   RP_KUBE_API_REQUEST_TIMEOUT — kubectl timeout (default 10s)
#   RP_KUBE_API_QUIET=1 — suppress success line (rp-ensure-kube-api.sh prints one line)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

TIMEOUT="${RP_KUBE_API_REQUEST_TIMEOUT:-10s}"
BRIDGE_PREFIX="${RP_KUBE_API_BRIDGE_PREFIX:-https://192.168.64.}"
QUIET="${RP_KUBE_API_QUIET:-0}"

command -v kubectl >/dev/null 2>&1 || {
  echo "❌ kubectl required" >&2
  exit 1
}

server="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
if [[ -z "$server" ]]; then
  echo "❌ no cluster server in current kubeconfig (minify context)" >&2
  echo "Recovery: re-run make cold-bootstrap (kubeconfig align is automatic)." >&2
  exit 1
fi

if [[ "$server" == *127.0.0.1* || "$server" == *localhost* ]]; then
  echo "❌ forbidden loopback Kubernetes API server: $server" >&2
  echo "Recovery: re-run make cold-bootstrap (kubeconfig align is automatic)." >&2
  exit 1
fi

if [[ "$server" == *:6443* ]]; then
  echo "❌ forbidden static :6443 API server (use Colima bridge port): $server" >&2
  echo "Recovery: re-run make cold-bootstrap (kubeconfig align is automatic)." >&2
  exit 1
fi

if [[ "$server" != "${BRIDGE_PREFIX}"* ]]; then
  echo "❌ kubeconfig API server must use Colima bridge (${BRIDGE_PREFIX}*): $server" >&2
  echo "Recovery: re-run make cold-bootstrap (kubeconfig align is automatic)." >&2
  exit 1
fi

if ! kubectl --request-timeout="$TIMEOUT" get --raw=/version >/dev/null 2>&1; then
  echo "❌ kubectl cannot reach API at $server" >&2
  echo "Recovery: re-run make cold-bootstrap (kubeconfig align is automatic)." >&2
  exit 1
fi

if [[ "$QUIET" != "1" ]]; then
  echo "✅ Kubernetes API healthy ($server)"
fi

# Export for rp-ensure-kube-api.sh final line
printf '%s\n' "$server"
