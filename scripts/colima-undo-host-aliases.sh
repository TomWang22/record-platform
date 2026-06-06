#!/usr/bin/env bash
# Undo the host-alias patch from colima-apply-host-aliases.sh by re-applying
# the kustomize overlay. Deployments will use hostAliases from repo (base YAML:
# host.docker.internal -> 192.168.5.2). Pods will roll out with the restored spec.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

cd "$REPO_ROOT"
OVERLAY="${1:-infra/k8s/overlays/dev}"
if [[ ! -d "$OVERLAY" ]]; then
  echo "Usage: $0 [overlay_dir]" >&2
  echo "  overlay_dir defaults to infra/k8s/overlays/dev" >&2
  exit 1
fi

say "Re-applying $OVERLAY to restore deployments from repo (undo host-alias patch)..."
kubectl apply -k "$OVERLAY"
ok "Deployments restored; hostAliases now from base YAML (192.168.5.2)."
info "Pods will roll out; wait for Ready with: kubectl get pods -n record-platform -w"
echo ""
info "If pods stay Init:0/1 or 0/1 Ready (analytics, auction-monitor, social, etc.), your Colima host gateway may not be 192.168.5.2. Run: ./scripts/colima-apply-host-aliases.sh"
