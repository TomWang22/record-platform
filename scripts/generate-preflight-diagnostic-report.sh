#!/usr/bin/env bash
# Generate a single diagnostic report for preflight/API/MetalLB/reset issues.
# Pipe to a file and hand to an AI or use for debugging.
# Usage: ./scripts/generate-preflight-diagnostic-report.sh [ > preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt ]
#   RUN_DIAGNOSE=1  — also run diagnose-reset-by-peer.sh (DEEP=1, no DIAG_GATHER to avoid nested tee)
#   RUN_DIAGNOSE=0  — skip diagnose (faster; default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RUN_DIAGNOSE="${RUN_DIAGNOSE:-0}"

echo "=============================================="
echo "PREFLIGHT DIAGNOSTIC REPORT"
echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""

# 1. Environment check (includes context, API, namespaces, pods -A, Docker, MetalLB, Caddy, observability)
echo "--- 1. Preflight environment check ---"
"$SCRIPT_DIR/preflight-environment-check.sh" 2>&1
echo ""

# 2. Connection reset / API diagnostic (optional)
if [[ "${RUN_DIAGNOSE}" == "1" ]] && [[ -f "$SCRIPT_DIR/diagnose-reset-by-peer.sh" ]]; then
  echo "--- 2. Connection reset diagnostic (DEEP=1) ---"
  DEEP=1 DIAG_GATHER=0 "$SCRIPT_DIR/diagnose-reset-by-peer.sh" 6443 2>&1 || true
  echo ""
fi

# 3. Extra: namespaces and pods again (in case API became reachable during diagnose)
echo "--- 3. Namespaces and pods (current) ---"
if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  echo "Namespaces:"
  kubectl get ns -o wide 2>/dev/null | sed 's/^/  /'
  echo ""
  echo "Pods (all namespaces):"
  kubectl get pods -A -o wide 2>/dev/null | sed 's/^/  /'
else
  echo "  API not reachable (kubectl get nodes failed)"
fi
echo ""

# 4. List of relevant files for this report (so an AI can open them)
echo "--- 4. Relevant files (paths for AI or human) ---"
for f in \
  "scripts/run-preflight-scale-and-all-suites.sh" \
  "scripts/diagnose-reset-by-peer.sh" \
  "scripts/preflight-environment-check.sh" \
  "scripts/apply-k3s-etcd-tuning.sh" \
  "scripts/generate-preflight-failure-report.sh" \
  "scripts/apply-metallb-pool-and-caddy-service.sh" \
  "scripts/install-metallb.sh" \
  "scripts/colima-forward-6443.sh" \
  "scripts/ensure-api-server-ready.sh" \
  "scripts/reissue-ca-and-leaf-load-all-services.sh" \
  "docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md" \
  "docs/COLIMA_K3S_TUNING.md" \
  "PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md" \
  "METALLB_AND_API_503_REPORT.md" \
  "Runbook.md" \
  "scripts/CONNECTION-RESET-PLAYBOOK.md" \
  "infra/k8s/caddy-h3-service.yaml" \
  "infra/k8s/caddy-h3-service-nodeport.yaml" \
  "infra/k8s/metallb/ipaddresspool.yaml" \
  "infra/k8s/metallb/l2advertisement.yaml" \
  ; do
  if [[ -f "$REPO_ROOT/$f" ]]; then
    echo "  $f"
  else
    echo "  $f (missing)"
  fi
done
echo ""

# 5. How to run preflight and diagnose again
echo "--- 5. How to run preflight and diagnose again ---"
echo "  Full preflight (Colima + k3s):"
echo "    RUN_FULL_LOAD=0 KILL_STALE_FIRST=1 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee preflight-\$(date +%Y%m%d-%H%M%S).log"
echo ""
echo "  Connection reset / API diagnostic (5-layer playbook):"
echo "    ./scripts/diagnose-reset-by-peer.sh 6443"
echo "    DEEP=1 ./scripts/diagnose-reset-by-peer.sh 6443"
echo "    DEEP=1 DIAG_GATHER=1 ./scripts/diagnose-reset-by-peer.sh 6443   # also writes scripts/diag-reset-*.log"
echo ""
echo "  Environment check only:"
echo "    ./scripts/preflight-environment-check.sh"
echo ""
echo "  MetalLB pool + Caddy apply (when API and webhook ready):"
echo "    ./scripts/apply-metallb-pool-and-caddy-service.sh"
echo ""
echo "  Re-generate this report (with diagnose):"
echo "    RUN_DIAGNOSE=1 ./scripts/generate-preflight-diagnostic-report.sh > preflight-diagnostic-\$(date +%Y%m%d-%H%M%S).txt"
echo ""
echo "  Preflight failure report (what failed and why):"
echo "    ./scripts/generate-preflight-failure-report.sh preflight-full-*.log"
echo ""
echo "  Apply k3s/etcd tuning (reduce API stalls):"
echo "    ./scripts/apply-k3s-etcd-tuning.sh"
echo ""

echo "=============================================="
echo "END REPORT"
echo "=============================================="
