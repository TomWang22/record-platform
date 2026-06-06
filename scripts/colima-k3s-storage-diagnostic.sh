#!/usr/bin/env bash
# Colima + k3s storage and resource diagnostic: why k3s might "not like it" (disk, memory, etcd).
# Run when API is flaky or after preflight failures to see storage pressure and VM state.
#
# Usage: ./scripts/colima-k3s-storage-diagnostic.sh [ > storage-diagnostic-$(date +%Y%m%d-%H%M%S).txt ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Colima + k3s storage diagnostic — $TS"
echo ""

# --- 1. Colima status and profile ---
say "1. Colima status and profile"
if command -v colima >/dev/null 2>&1; then
  colima status 2>&1 || true
  if colima status 2>&1 | grep -qi running; then
    info "Colima VM is running; checking in-VM disk and k3s..."
  else
    warn "Colima is not running; in-VM checks will be skipped."
  fi
else
  warn "colima not found"
fi
echo ""

# --- 2. In-VM disk usage (root, k3s, etcd) ---
say "2. In-VM disk usage (Colima VM)"
if colima status 2>&1 | grep -qi running; then
  info "df -h (VM filesystems)"
  colima ssh -- df -h 2>/dev/null || warn "colima ssh df failed"
  echo ""
  info "k3s/etcd data dir size (often /var/lib/rancher/k3s or server/db)"
  colima ssh -- sh -c 'du -sh /var/lib/rancher/k3s 2>/dev/null || true; du -sh /var/lib/rancher/k3s/server/db 2>/dev/null || true' 2>/dev/null || warn "colima ssh du k3s failed"
  echo ""
  info "Docker/containerd data (if present)"
  colima ssh -- sh -c 'du -sh /var/lib/docker 2>/dev/null || true; du -sh /var/lib/containerd 2>/dev/null || true' 2>/dev/null || true
else
  echo "  (Colima not running; skip in-VM disk)"
fi
echo ""

# --- 3. Host Docker/Colima disk (if Docker context is colima) ---
say "3. Host Docker disk (docker system df)"
if command -v docker >/dev/null 2>&1; then
  docker context show 2>/dev/null || true
  docker system df 2>/dev/null || warn "docker system df failed"
else
  echo "  (docker not in PATH)"
fi
echo ""

# --- 4. Kubernetes node allocatable / capacity ---
say "4. Kubernetes node resources (allocatable, capacity)"
if kubectl get nodes -o wide 2>/dev/null; then
  echo ""
  kubectl get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1].type,CAPACITY_CPU:.status.capacity.cpu,CAPACITY_MEM:.status.capacity.memory,ALLOCATABLE_CPU:.status.allocatable.cpu,ALLOCATABLE_MEM:.status.allocatable.memory 2>/dev/null || true
else
  warn "kubectl get nodes failed (API down or unreachable)"
fi
echo ""

# --- 5. Why k3s might "not like it" (short checklist) ---
say "5. Why Colima k3s might be unhappy (checklist)"
echo "  • Disk full or near full (etcd needs headroom; check section 2 df -h)"
echo "  • etcd quota or compaction (section 2: server/db size; see docs/ETCD_WRITE_BUDGET_PLAN.md)"
echo "  • Memory pressure (section 4: allocatable; VM may need more RAM)"
echo "  • Write burst (too many API writes; health gate + abort in reissue, see docs/COLIMA_K3S_FORENSIC_AND_TUNING.md)"
echo "  • Tunnel vs in-VM (use REISSUE_STEP2_VIA_SSH=1 or colima ssh for kubectl when 6443 is flaky)"
echo "  • Reclaim: see docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md; run scripts/colima-k3s-reclaim-safe.sh --dry-run"
echo "  • Full checklist: docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md"
echo "  • Analyze every layer (1–12): docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md"
echo ""

say "End of storage diagnostic"
