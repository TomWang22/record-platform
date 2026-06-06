#!/usr/bin/env bash
# Back-compat shim — canonical toolchain is rp-ensure-node-pnpm.sh.
SCRIPT_DIR_EP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ensure-node-pnpm.sh
source "$SCRIPT_DIR_EP/rp-ensure-node-pnpm.sh"

rp_ensure_pnpm_corepack() {
  rp_ensure_node_pnpm "${1:-}"
}
