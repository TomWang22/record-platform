#!/usr/bin/env bash
# See what's going on when the Kubernetes API is unreachable from the host.
# Uses only colima status and colima ssh (no kubectl from host). Use before or instead of full cross-layer diagnostic.
#
# Usage: ./scripts/colima-diagnose-when-api-down.sh [ > diagnose-api-down-$(date +%Y%m%d-%H%M%S).txt ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Colima diagnose when API down — $TS"
info "No host kubectl used; all data from colima status + colima ssh."

# --- 1. Colima profile and status ---
say "1. Colima profile and status"
if ! command -v colima >/dev/null 2>&1; then
  warn "colima not found"
else
  colima list 2>&1
  echo ""
  colima status 2>&1 | head -15
  if colima status 2>&1 | grep -qi running; then
    ok "Colima VM is running"
  else
    warn "Colima is not running. Start with: ./scripts/colima-fix-control-plane-for-good.sh"
    exit 0
  fi
fi

# --- 2. VM resources (in-VM: CPUs, memory) ---
say "2. VM resources (in-VM)"
if colima status 2>&1 | grep -qi running; then
  info "CPUs (nproc):"
  colima ssh -- nproc 2>/dev/null || warn "nproc failed"
  info "Memory (free -h):"
  colima ssh -- free -h 2>/dev/null || warn "free failed"
  info "Disk (df -h /):"
  colima ssh -- df -h / 2>/dev/null | head -5 || true
else
  echo "  (Colima not running)"
fi

# --- 3. k3s process state (the key when API is down) ---
say "3. k3s process state"
if colima status 2>&1 | grep -qi running; then
  info "systemctl k3s:"
  colima ssh -- systemctl show k3s --property=ActiveState,SubState,ActiveEnterTimestamp 2>/dev/null || warn "systemctl failed"
  _state=$(colima ssh -- systemctl show k3s -p SubState --value 2>/dev/null || echo "")
  if [[ "$_state" == "auto-restart" ]]; then
    warn "k3s is CRASH-LOOPING (SubState=auto-restart). Fix: ./scripts/colima-fix-control-plane-for-good.sh"
  elif [[ "$_state" == "start" ]] || [[ "$_state" == "exited" ]]; then
    warn "k3s is still starting or not running (SubState=$_state). Wait 2–3 min or run full fix: ./scripts/colima-fix-control-plane-for-good.sh"
  elif [[ "$_state" == "running" ]]; then
    ok "k3s is running (SubState=running). If host API still fails, re-forward: ./scripts/colima-forward-6443.sh"
  fi
  info "k3s recent log (last 12 lines):"
  colima ssh -- sudo journalctl -u k3s -n 12 --no-pager 2>/dev/null || true
else
  echo "  (Colima not running)"
fi

# --- 4. API from inside VM (bypasses tunnel) ---
say "4. API from inside VM (bypasses host tunnel)"
if colima status 2>&1 | grep -qi running; then
  if colima ssh -- kubectl get nodes --request-timeout=8s 2>/dev/null; then
    ok "In-VM kubectl: API reachable (problem is likely host tunnel or kubeconfig)"
    info "Fix: ./scripts/colima-forward-6443.sh && kubectl get nodes"
  else
    warn "In-VM kubectl: API unreachable (k3s not ready or down)"
    info "Fix: wait for k3s to finish starting, or run: ./scripts/colima-fix-control-plane-for-good.sh"
  fi
fi

# --- 5. Recommendation ---
say "5. Recommendation"
echo "  • Profile should be 12 CPU / 16 GiB RAM / 256 GiB disk for stable control plane."
echo "  • If k3s is activating or crash-looping: run ./scripts/colima-fix-control-plane-for-good.sh (full teardown + start + tune)."
echo "  • If k3s is running but host kubectl fails: run ./scripts/colima-forward-6443.sh then kubectl get nodes."
echo "  • Full cross-layer diagnostic (when API up): ./scripts/colima-k3s-cross-layer-diagnostic.sh"
echo ""

say "End of diagnose-when-api-down"
