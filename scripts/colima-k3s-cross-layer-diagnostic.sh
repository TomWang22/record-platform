#!/usr/bin/env bash
# Cross-layer diagnostic: API reachability (host + in-VM), k3s process, API in-flight, nodes, pods, controllers/reconcilers, MetalLB, storage summary.
# Use when you need to see "what is going on" across layers. See docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md for every layer.
# Usage: ./scripts/colima-k3s-cross-layer-diagnostic.sh [ > cross-layer-$(date +%Y%m%d-%H%M%S).txt ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Colima k3s cross-layer diagnostic — $TS"

# Root issue: when API is ServiceUnavailable or k3s keeps activating, control-plane stability is the root cause (51820 crash-loop or startup race).
# Fix: full Colima restart, then re-forward 6443. See docs/COLIMA_K3S_CRASH_LOOP_51820.md

# --- 1. Colima and API reachability (host vs in-VM) ---
say "1. Colima and API reachability"
if ! command -v colima >/dev/null 2>&1; then
  warn "colima not found"
else
  colima status 2>&1 | head -10
  if colima status 2>&1 | grep -qi running; then
    info "Cluster identity (which one you're talking to — there is only one Colima node):"
    echo "   context: $(kubectl config current-context 2>/dev/null || echo '?')"
    echo "   server:  $(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo '?')"
    echo "   node(s): $(kubectl get nodes -o wide --no-headers 2>/dev/null | head -3 || echo '?')"
    info "Checking API from host (127.0.0.1:6443)..."
    if kubectl get nodes --request-timeout=5s 2>/dev/null; then
      ok "Host kubectl: API reachable"
    else
      warn "Host kubectl: API unreachable (tunnel/6443 or API down; ServiceUnavailable = root cause: k3s stability)"
      info "Fix: ./scripts/ensure-k8s-api.sh  (auto retries + re-forward 6443)"
    fi
    info "Checking API from inside VM (bypasses tunnel)..."
    if colima ssh -- kubectl get nodes --request-timeout=5s 2>/dev/null; then
      ok "In-VM kubectl: API reachable"
    else
      warn "In-VM kubectl: API unreachable (control plane down or starting)"
      info "Root cause: k3s stability (ServiceUnavailable / activating). Fix: ./scripts/colima-k3s-recover-from-crash-loop.sh then ./scripts/colima-forward-6443.sh"
    fi
  fi
fi

# --- 2. k3s process (restart time, service state) ---
say "2. k3s process (layer 3)"
if colima status 2>&1 | grep -qi running; then
  info "k3s service status (in-VM):"
  colima ssh -- systemctl show k3s --property=ActiveState,ActiveEnterTimestamp,SubState 2>/dev/null || warn "systemctl show k3s failed"
  info "k3s recent log lines:"
  colima ssh -- sudo journalctl -u k3s -n 8 --no-pager 2>/dev/null || true
  # Detect crash-loop: SubState=auto-restart and log shows 51820 / connection refused (CRD registration)
  if colima ssh -- bash -c 's=$(systemctl show k3s -p SubState --value 2>/dev/null); j=$(sudo journalctl -u k3s -n 25 --no-pager 2>/dev/null); [[ "$s" == *auto-restart* ]] && echo "$j" | grep -qE "51820|connection refused.*crd|failed to create crd"' 2>/dev/null; then
    warn "k3s is CRASH-LOOPING (CRD registration to 127.0.0.1:51820 refused). API may work briefly then drop."
    echo "   Fix: full Colima restart to clear internal state. See docs/COLIMA_K3S_CRASH_LOOP_51820.md"
    echo "   Run: colima stop && colima start --with-kubernetes && sleep 90 && ./scripts/colima-forward-6443.sh"
  fi
fi

# --- 3. API in-flight / etcd (when API up; layer 4) ---
say "3. API in-flight and etcd pressure (layer 4)"
if colima status 2>&1 | grep -qi running; then
  if colima ssh -- kubectl get --raw /metrics --request-timeout=5s 2>/dev/null | grep -E '^apiserver_current_inflight|^etcd_request_duration' | head -20; then
    ok "API metrics sampled"
  else
    warn "Could not fetch /metrics (API down or timeout)"
  fi
fi

# --- 4. Nodes and allocatable ---
say "4. Nodes and allocatable (layer 5)"
if colima status 2>&1 | grep -qi running; then
  info "Nodes (in-VM kubectl):"
  colima ssh -- kubectl get nodes -o wide 2>/dev/null || warn "kubectl get nodes failed"
  info "Node allocatable/capacity (if API up):"
  colima ssh -- kubectl get nodes -o custom-columns=NAME:.metadata.name,ALLOCATABLE:.status.allocatable.memory,CAPACITY:.status.capacity.memory 2>/dev/null || true
fi

# --- 5. Pods: not ready, and key namespaces (layer 6) ---
say "5. Pods (not ready + record-platform, ingress-nginx, metallb)"
if colima status 2>&1 | grep -qi running; then
  info "Pods not Ready (all namespaces):"
  colima ssh -- kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded 2>/dev/null | head -30 || true
  info "record-platform pods:"
  colima ssh -- kubectl get pods -n record-platform 2>/dev/null | head -25 || true
  info "ingress-nginx pods:"
  colima ssh -- kubectl get pods -n ingress-nginx 2>/dev/null | head -15 || true
  if colima ssh -- kubectl get ns metallb-system --request-timeout=3s 2>/dev/null; then
    info "metallb-system pods:"
    colima ssh -- kubectl get pods -n metallb-system 2>/dev/null
    info "metallb-system webhook endpoints:"
    colima ssh -- kubectl get ep -n metallb-system webhook-service 2>/dev/null || true
  fi
fi

# --- 6. Controllers / reconcilers (layer 7) ---
say "6. Controllers (deployments, statefulsets, daemonsets)"
# Capture MetalLB controller ready state for section 7 (1=ready, 0=not ready, empty=unknown)
METALLB_CONTROLLER_READY=""
if colima status 2>&1 | grep -qi running; then
  info "Deployments (desired vs ready; 0/1 = not ready):"
  colima ssh -- kubectl get deploy -A --no-headers 2>/dev/null | awk '$3!=$4 || $4!=$5 {print}' | head -20 || true
  _ml=$(colima ssh -- kubectl get deploy -n metallb-system controller --no-headers 2>/dev/null | awk 'NF>=2 {print ($2=="1/1")?"1":"0"; exit}')
  [[ -n "$_ml" ]] && METALLB_CONTROLLER_READY="$_ml"
  info "StatefulSets:"
  colima ssh -- kubectl get sts -A 2>/dev/null | head -15 || true
  info "DaemonSets:"
  colima ssh -- kubectl get ds -A 2>/dev/null | head -15 || true
fi

# --- 7. MetalLB (pool, L2, LoadBalancer services; layer 8) ---
say "7. MetalLB (if installed)"
if colima status 2>&1 | grep -qi running; then
  if colima ssh -- kubectl get ns metallb-system --request-timeout=3s 2>/dev/null; then
    info "IPAddressPools:"
    colima ssh -- kubectl get ipaddresspool -n metallb-system 2>/dev/null || true
    info "L2Advertisements:"
    colima ssh -- kubectl get l2advertisement -n metallb-system 2>/dev/null || true
    info "Services type=LoadBalancer (EXTERNAL-IP):"
    colima ssh -- kubectl get svc -A -o wide 2>/dev/null | grep -E 'LoadBalancer|NAME' || true
    if [[ "$METALLB_CONTROLLER_READY" == "0" ]]; then
      warn "MetalLB controller is 0/1 (not ready). Root cause: k3s stability. Fix: stabilize API then re-apply MetalLB or scale controller."
    fi
  else
    if [[ "$METALLB_CONTROLLER_READY" == "0" ]]; then
      warn "MetalLB namespace exists but API unreachable now. Section 6 showed metallb-system controller 0/1 — MetalLB not working until k3s is stable."
    else
      info "MetalLB: could not verify (API down or connection refused). Install with ./scripts/install-metallb.sh when API is stable."
    fi
  fi
fi

# --- 8. Storage summary (Docker; layer 9) ---
say "8. Storage summary (Docker)"
if docker info >/dev/null 2>&1; then
  docker system df 2>/dev/null || true
else
  warn "Docker not reachable"
fi

# --- 9. Observability (to add/verify) ---
say "9. Observability (to add / verify)"
info "Stack to add or verify (not yet in this diagnostic): Splunk, New Relic, Istio. Add when defined."
if colima status 2>&1 | grep -qi running; then
  colima ssh -- kubectl get pods -n istio-system 2>/dev/null | head -10 || true
  colima ssh -- kubectl get ns 2>/dev/null | grep -E 'istio|splunk|newrelic|observability' || true
fi

say "End of cross-layer diagnostic"
echo ""
info "Root issues and fixes: docs/COLIMA_K3S_ISSUES_AND_FIXES.md. Fix: ./scripts/colima-fix-control-plane-for-good.sh (teardown + 180s boot + AGGRESSIVE tune)."
info "Full flow (stabilize + MetalLB + this diagnostic): ./scripts/colima-stabilize-metallb-and-diagnose.sh (run when API is stable; use SKIP_TUNE=1 if already tuned)."
info "Analyze every layer: docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md | Resource dissection: ./scripts/colima-k3s-resource-dissection.sh"
info "MetalLB: when stable → ./scripts/install-metallb-when-stable.sh | flaky API → ./scripts/install-metallb-chunked.sh | direct → ./scripts/install-metallb.sh. Runbook #52."
info "Next: docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md — colima-k3s-storage-diagnostic.sh — colima-k3s-reclaim-safe.sh --dry-run"
