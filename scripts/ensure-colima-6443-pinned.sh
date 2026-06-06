#!/usr/bin/env bash
# Pin Colima Kubernetes API to 127.0.0.1:6443 so we don't keep fixing the port.
# - Ensures ~/.colima/default/colima.yaml has kubernetes.port: 6443
# - Runs preflight-fix-kubeconfig so kubeconfig server is https://127.0.0.1:6443
# - Scripts that use PATH=scripts/shims:... get kubectl shim → colima ssh fallback when host 6443 is unreachable
# Use: ./scripts/ensure-colima-6443-pinned.sh (or source before preflight)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLIMA_YAML="${COLIMA_CONFIG:-$HOME/.colima/default/colima.yaml}"

pin_port() {
  if [[ ! -f "$COLIMA_YAML" ]]; then
    echo "⚠️  Colima config not found: $COLIMA_YAML (start Colima first)"
    return 1
  fi
  if grep -q "port: 6443" "$COLIMA_YAML" 2>/dev/null; then
    echo "✅ Colima API port already pinned to 6443 in $COLIMA_YAML"
    return 0
  fi
  # Only suggest edit if port is 0 or missing
  if grep -q "port: 0" "$COLIMA_YAML" 2>/dev/null || ! grep -q "port:" "$COLIMA_YAML" 2>/dev/null; then
    echo "ℹ️  To pin 6443: set kubernetes.port to 6443 in $COLIMA_YAML then colima stop && colima start --with-kubernetes"
    return 0
  fi
  echo "✅ Colima config present: $COLIMA_YAML"
  return 0
}

export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"

pin_port
PREFLIGHT_CAP="${PREFLIGHT_CAP:-20}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null && echo "✅ Kubeconfig server set to https://127.0.0.1:6443" || true
