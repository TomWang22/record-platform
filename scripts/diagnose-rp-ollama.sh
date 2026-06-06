#!/usr/bin/env bash
# Diagnostics when Ollama stack fails under RP_ENABLE_OLLAMA=1.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

NS="${HOUSING_NS:-record-platform}"

rp_ollama_policy_resolve
if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]; then
  echo "ℹ️  RP_ENABLE_OLLAMA_EFFECTIVE!=1 — Ollama diagnostics not applicable"
  exit 0
fi

echo "━━━ diagnose-rp-ollama (ns=$NS) ━━━"
echo ""

if command -v colima >/dev/null 2>&1; then
  colima status 2>/dev/null | head -5 || true
  echo ""
fi

echo "--- deploy / pod / svc / endpoints (ollama*) ---"
kubectl get deploy,pod,svc,endpoints -n "$NS" 2>/dev/null | grep -i ollama || echo "(no ollama resources)"

for dep in ollama ollama-gateway ollama-worker; do
  echo ""
  echo "--- describe deployment/$dep ---"
  kubectl describe deployment "$dep" -n "$NS" 2>/dev/null | tail -40 || echo "missing deployment/$dep"
  _pod="$(kubectl get pods -n "$NS" -l "app=$dep" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$_pod" ]]; then
    _pod="$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | awk -v d="$dep" '$1 ~ d {print $1; exit}')"
  fi
  if [[ -n "$_pod" ]]; then
    echo ""
    echo "--- logs $dep ($_pod) tail ---"
    kubectl logs "$_pod" -n "$NS" --tail=40 2>/dev/null || true
  fi
done

echo ""
echo "--- app-config Ollama keys ---"
kubectl get configmap app-config -n "$NS" -o yaml 2>/dev/null \
  | grep -E 'OLLAMA|ollama' || echo "(no OLLAMA keys in app-config)"

echo ""
echo "Recovery: scale ollama replicas≥1; BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=0; bash scripts/apply-ollama-gateway-stack.sh"
echo "Core-only (skip ML): RP_CORE_ONLY_BOOTSTRAP=1 or RP_ENABLE_OLLAMA=0 OLLAMA_REQUIRED=0"
