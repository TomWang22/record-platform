#!/usr/bin/env bash
# Dev Colima: clamp Ollama HPA to 1 replica and delete Pending ollama pods from over-scale.
set -euo pipefail

NS="${HOUSING_NS:-record-platform}"

if ! kubectl get hpa ollama -n "$NS" >/dev/null 2>&1; then
  exit 0
fi

maxr="$(kubectl get hpa ollama -n "$NS" -o jsonpath='{.spec.maxReplicas}' 2>/dev/null || echo 0)"
if [[ "${maxr:-0}" -gt 1 ]]; then
  kubectl patch hpa ollama -n "$NS" --type=merge \
    -p '{"spec":{"minReplicas":1,"maxReplicas":1}}' >/dev/null
  echo "ℹ️  patched hpa/ollama maxReplicas=1 (dev Colima)"
fi

kubectl scale deployment/ollama -n "$NS" --replicas=1 >/dev/null 2>&1 || true

while read -r pod; do
  [[ -z "$pod" ]] && continue
  phase="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  if [[ "$phase" == "Pending" ]]; then
    kubectl delete pod "$pod" -n "$NS" --wait=false >/dev/null 2>&1 || true
    echo "ℹ️  deleted Pending ollama pod $pod"
  fi
done < <(kubectl get pods -n "$NS" -l app=ollama -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
