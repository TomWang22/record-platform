#!/usr/bin/env bash
# Scale deployment/ollama and wait Ready when full ML trust is effective.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-ollama-gate-policy.sh
source "$SCRIPT_DIR/lib/rp-ollama-gate-policy.sh"

NS="${HOUSING_NS:-${NAMESPACE:-record-platform}}"
OLLAMA_TIMEOUT="${OLLAMA_TIMEOUT:-${WAIT_OLLAMA_TIMEOUT:-600s}}"

rp_ollama_policy_resolve

if [[ "${RP_ENABLE_OLLAMA_EFFECTIVE}" != "1" ]]; then
  echo "ensure-rp-ollama-enabled: skip — core-only bootstrap (RP_ENABLE_OLLAMA_EFFECTIVE=0)"
  exit 0
fi

rp_ollama_env_validate || exit 1

command -v kubectl >/dev/null 2>&1 || {
  echo "❌ ensure-rp-ollama-enabled: kubectl required" >&2
  exit 1
}

if ! kubectl get deployment ollama -n "$NS" >/dev/null 2>&1; then
  echo "❌ ensure-rp-ollama-enabled: deployment/ollama missing in ns=$NS (apply dev overlay / deploy-dev first)" >&2
  exit 1
fi

reps="$(kubectl get deployment ollama -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
echo "ensure-rp-ollama-enabled (ns=$NS replicas=${reps:-?} → 1 timeout=${OLLAMA_TIMEOUT})"
rp_ollama_policy_print_effective

if [[ "${reps:-0}" -lt 1 ]]; then
  echo "  ▶ scaling deployment/ollama to replicas=1"
  kubectl -n "$NS" scale deployment/ollama --replicas=1
fi

echo "  ▶ rollout status deployment/ollama (${OLLAMA_TIMEOUT})"
kubectl -n "$NS" rollout status deployment/ollama --timeout="${OLLAMA_TIMEOUT}"

echo "  ▶ wait pod -l app=ollama --for=condition=Ready (${OLLAMA_TIMEOUT})"
kubectl -n "$NS" wait pod -l app=ollama --for=condition=Ready --timeout="${OLLAMA_TIMEOUT}"

echo "✅ ensure-rp-ollama-enabled: deployment/ollama ready"
