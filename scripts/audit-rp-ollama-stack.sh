#!/usr/bin/env bash
# Audit Ollama ML stack when RP_ENABLE_OLLAMA=1; skip cleanly when disabled.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

NS="${HOUSING_NS:-record-platform}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }
info() { echo "  ℹ️  $*"; }

rp_ollama_policy_resolve

if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]; then
  info "RP_ENABLE_OLLAMA_EFFECTIVE!=1 — stack audit skipped (core dev mode)"
  exit 0
fi

rp_ollama_env_validate || exit 1
command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

echo "audit-rp-ollama-stack (ns=$NS RP_ENABLE_OLLAMA_EFFECTIVE=1)"

for dep in ollama ollama-gateway ollama-worker; do
  if ! kubectl get deployment "$dep" -n "$NS" >/dev/null 2>&1; then
    bad "missing deployment/$dep (apply k8s/ollama* or deploy-dev)"
    continue
  fi
  reps="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
  if [[ "$reps" == "0" ]]; then
    bad "deployment/$dep replicas=0 but RP_ENABLE_OLLAMA_EFFECTIVE=1"
    continue
  fi
  ready="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
  available="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo 0)"
  [[ "${ready:-0}" -ge 1 ]] && ok "deployment/$dep ready (${ready}/${reps})" \
    || bad "deployment/$dep not ready (${ready}/${reps})"
  if [[ "$dep" == "ollama" ]]; then
    pending="$(kubectl get pods -n "$NS" -l app=ollama --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${pending:-0}" -gt 0 ]]; then
      bad "ollama has ${pending} Pending pod(s) — clamp HPA maxReplicas=1 for dev Colima"
    fi
    if [[ "${available:-0}" != "${reps}" ]]; then
      bad "ollama availableReplicas=${available} != spec.replicas=${reps}"
    fi
    if kubectl get hpa ollama -n "$NS" >/dev/null 2>&1; then
      maxr="$(kubectl get hpa ollama -n "$NS" -o jsonpath='{.spec.maxReplicas}' 2>/dev/null || echo 0)"
      if [[ "${maxr:-0}" -gt 1 ]]; then
        bad "hpa/ollama maxReplicas=${maxr} (dev cold-bootstrap requires maxReplicas=1)"
      else
        ok "hpa/ollama maxReplicas=${maxr}"
      fi
    fi
  fi
done

if kubectl get svc ollama -n "$NS" >/dev/null 2>&1; then
  eps="$(kubectl get endpoints ollama -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
  [[ "${eps:-0}" -ge 1 ]] && ok "service/ollama has ready endpoints" \
    || bad "service/ollama has no ready endpoints"
else
  bad "missing service/ollama"
fi

if kubectl get configmap ollama-gateway-config -n "$NS" >/dev/null 2>&1 \
  || kubectl get configmap ollama-worker-config -n "$NS" >/dev/null 2>&1; then
  ok "ollama gateway/worker configmaps present"
else
  info "ollama gateway/worker configmaps not found (may use k8s/ root manifests)"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "Run: bash scripts/diagnose-rp-ollama.sh"
  bash "$SCRIPT_DIR/diagnose-rp-ollama.sh" 2>/dev/null || true
  exit 1
fi
echo "✅ audit-rp-ollama-stack passed"
exit 0
