#!/usr/bin/env bash
# RP bootstrap: delegate to bridge kubeconfig health (no 127.0.0.1:6443 tunnel).
# Legacy OCH host-tunnel helpers are not used on RP cold-bootstrap (bridge kubeconfig only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/rp-ensure-kube-api.sh"
