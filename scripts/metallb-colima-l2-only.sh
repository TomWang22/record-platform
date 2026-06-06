#!/usr/bin/env bash
# Switch Colima MetalLB to L2-only (single-node stable profile). Removes BGP so the same IP is not advertised twice.
# Use when: QUIC is unstable after speaker restart (ERR_HANDSHAKE_TIMEOUT); single-node Colima; no need for BGP.
#
# Keeps: IPAddressPool, L2Advertisement (ARP only).
# Removes: BGPAdvertisement, BGPPeer (FRR remains running but MetalLB no longer advertises via BGP).
#
# Usage: ./scripts/metallb-colima-l2-only.sh
#   DRY_RUN=1   print what would be deleted, do not delete
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${METALLB_NS:-metallb-system}"
DRY_RUN="${DRY_RUN:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
info(){ echo "ℹ️  $*"; }

say "MetalLB Colima: switch to L2-only (single-node stable)"
info "This removes BGP advertisement so the LB IP is advertised only via ARP. QUIC stays stable after speaker churn."

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[DRY RUN] Would delete:"
  kubectl -n "$NS" get bgpadvertisement -o name 2>/dev/null || true
  kubectl -n "$NS" get bgppeer -o name 2>/dev/null || true
  echo "[DRY RUN] Pool and L2Advertisement are unchanged. Exit."
  exit 0
fi

_deleted=0
for o in $(kubectl -n "$NS" get bgpadvertisement -o name 2>/dev/null); do
  kubectl -n "$NS" delete "$o" --ignore-not-found --timeout=10s 2>/dev/null && { ok "Deleted $o"; _deleted=1; } || true
done
for o in $(kubectl -n "$NS" get bgppeer -o name 2>/dev/null); do
  kubectl -n "$NS" delete "$o" --ignore-not-found --timeout=10s 2>/dev/null && { ok "Deleted $o"; _deleted=1; } || true
done

if [[ "$_deleted" -eq 1 ]]; then
  ok "L2-only mode: BGP advertisement removed. LB IP is now advertised only via L2 (ARP)."
  info "FRR pod may still be running; MetalLB speaker simply no longer peers. To remove FRR: kubectl -n $NS delete deploy frr (optional)."
  info "To re-enable BGP later: ./scripts/install-metallb-frr-bgp.sh"
else
  info "No BGP resources found (already L2-only) or delete failed. Check: kubectl -n $NS get bgpadvertisement,bgppeer"
fi

echo ""
info "Verify: ./scripts/verify-metallb-and-traffic-policy.sh   (HTTP/3 should stay stable after speaker restart)"
