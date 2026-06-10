#!/usr/bin/env bash
# Preflight diagnostic report: API, namespaces, env check, key files, and summary for AI.
# Run and pipe to a file or AI: ./scripts/preflight-diagnostic-report.sh | tee preflight-report-$(date +%Y%m%d-%H%M%S).txt
# See: PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md, METALLB_AND_API_503_REPORT.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
[[ -s "$HOME/.colima/default/kubernetes/kubeconfig" ]] && export KUBECONFIG="$HOME/.colima/default/kubernetes/kubeconfig"

echo "=============================================="
echo "PREFLIGHT DIAGNOSTIC REPORT"
echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Repo: $REPO_ROOT"
echo "=============================================="
echo ""

# 1. Environment check (includes tunnel attempt and all namespaces)
"$SCRIPT_DIR/preflight-environment-check.sh"
echo ""

# 2. Raw namespace list (again, in case env check had no API)
echo "=== All namespaces (raw) ==="
if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
  kubectl get ns 2>/dev/null || echo "(kubectl get ns failed)"
else
  echo "API not reachable — cannot list namespaces."
  echo "Ensure Colima is running and tunnel is up: colima start --with-kubernetes; ./scripts/colima-forward-6443.sh"
fi
echo ""

# 3. Key files (paths) for preflight/MetalLB/API issues — so an AI can open them
echo "=== Key files (paths) for preflight, MetalLB, API, observability ==="
key_files=(
  "scripts/run-preflight-scale-and-all-suites.sh"
  "scripts/preflight-environment-check.sh"
  "scripts/preflight-diagnostic-report.sh"
  "scripts/apply-metallb-pool-and-caddy-service.sh"
  "scripts/install-metallb.sh"
  "scripts/reissue-ca-and-leaf-load-all-services.sh"
  "scripts/colima-forward-6443.sh"
  "scripts/ensure-api-server-ready.sh"
  "scripts/wait-for-k3s-ready.sh"
  "scripts/colima-api-status.sh"
  "PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md"
  "METALLB_AND_API_503_REPORT.md"
  "docs/Runbook.md"
  "infra/k8s/base/kustomization.yaml"
  "infra/k8s/caddy-h3-service.yaml"
  "infra/k8s/caddy-h3-deploy.yaml"
  "infra/k8s/metallb/ipaddresspool.yaml"
  "infra/k8s/metallb/l2advertisement.yaml"
)
for f in "${key_files[@]}"; do
  if [[ -f "$REPO_ROOT/$f" ]]; then
    echo "  $f"
  else
    echo "  $f (missing)"
  fi
done
echo ""

# 4. Summary for AI
echo "=== Summary for AI ==="
echo "Context: Preflight (run-preflight-scale-and-all-suites.sh) used to run successfully (see preflight-full-20260206-215733.log)."
echo "Now: API often not reachable from env check; or API reachable but MetalLB webhook has no endpoints; or 503 during apply."
echo "Cluster: Colima + k3s only (no Kind). Docker runs Postgres, Kafka, Zookeeper, Redis."
echo "Goals: (1) Understand why API is unreachable or overloaded. (2) Fix preflight so it completes. (3) MetalLB pool + Caddy LoadBalancer when controller is ready."
echo "Key docs: PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md (why it worked, checklist), METALLB_AND_API_503_REPORT.md (503/webhook, scripts)."
echo "Run: ./scripts/preflight-diagnostic-report.sh | tee preflight-report-\$(date +%Y%m%d-%H%M%S).txt"
echo "=============================================="
