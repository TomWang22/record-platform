#!/usr/bin/env bash
# Dissect Colima/k3s resources: profile (CPU/RAM), VM view, node allocatable, k3s process.
# Use to see if more CPU/RAM could help; 12 CPU is the typical max for Colima on Mac.
#
# Usage: ./scripts/colima-k3s-resource-dissection.sh [ > resource-dissection-$(date +%Y%m%d-%H%M%S).txt ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Colima k3s resource dissection — $TS"

# --- 1. Colima profile (CPU, RAM, disk) ---
say "1. Colima profile (VM limits)"
if command -v colima >/dev/null 2>&1; then
  if colima status 2>&1 | grep -qi running; then
    info "colima profile (CPU, RAM, disk):"
    (colima status --extended 2>/dev/null || colima status -e 2>/dev/null) | grep -E 'cpu:|mem:|disk:' || colima status 2>&1 | grep -E 'cpu:|mem:|disk:' || echo "  (run: colima status -e)"
  else
    warn "Colima not running; start with: colima start --with-kubernetes --cpu 12 --memory 12"
  fi
else
  warn "colima not found"
fi

# --- 2. In-VM view (nproc, free) ---
say "2. In-VM view (CPUs visible, memory)"
if colima status 2>&1 | grep -qi running; then
  info "nproc (CPUs visible in VM):"
  colima ssh -- nproc 2>/dev/null || warn "nproc failed"
  info "free -h (VM memory):"
  colima ssh -- free -h 2>/dev/null || warn "free failed"
else
  echo "  (Colima not running)"
fi

# --- 3. Node capacity / allocatable (when API up) ---
say "3. Node capacity and allocatable (Kubernetes view)"
if kubectl get nodes -o wide 2>/dev/null; then
  info "Node resources:"
  kubectl get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1].type,CAPACITY_CPU:.status.capacity.cpu,CAPACITY_MEM:.status.capacity.memory,ALLOCATABLE_CPU:.status.allocatable.cpu,ALLOCATABLE_MEM:.status.allocatable.memory 2>/dev/null || true
  if kubectl top node 2>/dev/null; then
    ok "kubectl top node (live usage)"
  else
    info "kubectl top node not available (metrics-server not installed or API slow)"
  fi
else
  warn "kubectl get nodes failed (API down or unreachable)"
fi

# --- 4. k3s process (RSS, CPU when running) ---
say "4. k3s process (RSS, CPU)"
if colima status 2>&1 | grep -qi running; then
  info "k3s server process (RSS in KB, %CPU):"
  colima ssh -- bash -c 'pid=$(pgrep -f "k3s server" 2>/dev/null); if [[ -n "$pid" ]]; then ps -o rss=,pcpu= -p "$pid" 2>/dev/null | xargs printf "  RSS: %s KB  CPU: %s%%\n"; else echo "  (k3s server not running or not found)"; fi' 2>/dev/null || warn "ps k3s failed"
  info "systemctl k3s state:"
  colima ssh -- systemctl show k3s --property=ActiveState,SubState,ActiveEnterTimestamp 2>/dev/null || true
else
  echo "  (Colima not running)"
fi

# --- 5. Recommendation (max 12 CPU) ---
say "5. Recommendation (max 12 CPU)"
echo "  • Colima profile: use --cpu 12 --memory 12 (or higher memory, e.g. 16) when starting."
echo "  • 12 CPU is the typical max; the 51820 crash-loop is usually startup order / internal API not ready, not CPU starvation."
echo "  • Fix: full Colima restart. If still crash-looping: colima stop && colima start --with-kubernetes --cpu 12 --memory 12"
echo "  • If you have headroom: more RAM (e.g. 16GiB) can help etcd and apiserver under load; CPU beyond 12 is not used by Colima default."
echo "  • See: docs/COLIMA_K3S_CRASH_LOOP_51820.md — scripts/colima-k3s-recover-from-crash-loop.sh"
echo ""

say "End of resource dissection"
