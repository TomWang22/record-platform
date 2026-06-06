#!/usr/bin/env bash
# Back-compat shim — canonical toolchain is rp-ensure-node-pnpm.sh.
SCRIPT_DIR_ET="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ensure-node-pnpm.sh
source "$SCRIPT_DIR_ET/rp-ensure-node-pnpm.sh"

rp_ensure_node_toolchain() {
  rp_ensure_node_pnpm "${1:-}"
}

rp_ensure_node_toolchain_require() {
  rp_ensure_node_pnpm "${1:-}"
}
